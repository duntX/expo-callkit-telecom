import AVFoundation
import CallKit
import os

extension CallManager: CXProviderDelegate {

  /// Timeout for waiting for the call to connect after answering.
  private static let answerCallTimeout: Duration = {
    let seconds =
      Bundle.main.object(
        forInfoDictionaryKey: "ExpoCallKitTelecomFulfillAnswerCallTimeout"
      ) as? Int ?? 30
    return .seconds(seconds)
  }()

  /// Timeout for waiting for JS to acknowledge a call end (e.g. finish
  /// sending a SIP BYE/486) before CXEndCallAction is fulfilled. Short by
  /// design - unlike answering, ending/declining should feel instant to the
  /// user, and the call ends regardless of whether JS acknowledges in time.
  private static let callEndedTimeout: Duration = {
    let seconds =
      Bundle.main.object(
        forInfoDictionaryKey: "ExpoCallKitTelecomFulfillCallEndedTimeout"
      ) as? Int ?? 3
    return .seconds(seconds)
  }()

  // MARK: - providerDidReset

  func providerDidReset(_ provider: CXProvider) {
    Log.call.debug("Provider did reset - removing all sessions")
    DialtonePlayer.shared.stop()
    cancelAllCallTimeouts()
    Task {
      await FulfillRequestManager.shared.cancelAll()
      await store.removeAll()
    }
  }

  // MARK: - CXStartCallAction

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    Log.call.debug("CXStartCallAction - id: \(action.callUUID), isVideo: \(action.isVideo)")
    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())

    // Start timeout timer for outgoing call
    startCallTimeout(for: action.callUUID, timeout: Self.outgoingCallTimeout)

    Task {
      if let session = await store.session(for: action.callUUID),
        let participant = session.remoteParticipants.first
      {
        let update = CXCallUpdate()
        setLocalizedCallerNameIfNeeded(for: participant, on: update)
        provider.reportCall(with: action.callUUID, updated: update)
      }

      await store.updateStatus(for: action.callUUID, status: .connecting)

      await MainActor.run {
        CallEventEmitter.shared.send(OutgoingCallStartedEvent(id: action.callUUID))
      }
    }

    action.fulfill()
  }

  // MARK: - CXAnswerCallAction

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    Log.call.debug("CXAnswerCallAction - id: \(action.callUUID)")

    // Cancel the incoming call timeout since user answered
    cancelCallTimeout(for: action.callUUID)

    Task {
      await store.updateStatus(for: action.callUUID, status: .connecting)

      // Create pending fulfill request with associated call ID
      let (requestId, resultTask) = await FulfillRequestManager.shared.createRequest(
        callId: action.callUUID,
        timeout: Self.answerCallTimeout
      )

      // Send event with request ID
      await MainActor.run {
        CallEventEmitter.shared.send(
          CallAnsweredEvent(id: action.callUUID, requestId: requestId)
        )
      }

      // Wait for fulfill or timeout
      let result = await resultTask.value

      switch result {
      case .fulfilled:
        Log.call.debug("CXAnswerCallAction fulfilled - id: \(action.callUUID)")
        action.fulfill()
      case .cancelled:
        Log.call.debug("CXAnswerCallAction failed - cancelled - id: \(action.callUUID)")
        action.fail()
      case .timedOut:
        Log.call.debug("CXAnswerCallAction failed - timeout - id: \(action.callUUID)")
        action.fail()
      }
    }
  }

  // MARK: - CXEndCallAction

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    Log.call.debug("CXEndCallAction - id: \(action.callUUID)")

    // Stop dialtone and cancel timeout
    DialtonePlayer.shared.stop()
    cancelCallTimeout(for: action.callUUID)

    Task {
      // Snapshot the session as ended so the embedded session reflects the terminal state.
      if var session = await store.session(for: action.callUUID) {
        let reason = session.status == .ringing ? "declined" : "hungUp"
        session.status = .ended

        let (requestId, resultTask) = await FulfillRequestManager.shared.createRequest(
          callId: action.callUUID,
          timeout: Self.callEndedTimeout
        )

        await MainActor.run {
          CallEventEmitter.shared.send(
            CallEndedEvent(
              id: action.callUUID, session: session, reason: reason, requestId: requestId))
        }

        // Give JS a short window to finish its own cleanup (e.g. SIP BYE/486)
        // before fulfilling. The call ends either way - this only sequences
        // JS's work ahead of native cleanup, it never blocks the call from ending.
        switch await resultTask.value {
        case .fulfilled:
          Log.call.debug("CXEndCallAction acknowledged by JS - id: \(action.callUUID)")
        case .cancelled:
          Log.call.debug("CXEndCallAction JS ack cancelled - id: \(action.callUUID)")
        case .timedOut:
          Log.call.debug("CXEndCallAction JS ack timed out - id: \(action.callUUID)")
        }
      }

      await store.remove(for: action.callUUID)
      action.fulfill()
    }
  }

  // MARK: - CXSetMutedCallAction

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    Log.call.debug("CXSetMutedCallAction - id: \(action.callUUID), isMuted: \(action.isMuted)")

    Task {
      await store.updateMuted(for: action.callUUID, isMuted: action.isMuted)

      await MainActor.run {
        CallEventEmitter.shared.send(
          SetMutedActionEvent(id: action.callUUID, isMuted: action.isMuted))
      }
    }

    action.fulfill()
  }

  // MARK: - CXSetHeldCallAction

  func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
    Log.call.debug("CXSetHeldCallAction - id: \(action.callUUID), isOnHold: \(action.isOnHold)")

    Task {
      await store.updateHeld(for: action.callUUID, isOnHold: action.isOnHold)

      await MainActor.run {
        CallEventEmitter.shared.send(
          SetHeldActionEvent(id: action.callUUID, isOnHold: action.isOnHold))
      }
    }

    action.fulfill()
  }

  // MARK: - CXPlayDTMFCallAction

  func provider(_ provider: CXProvider, perform action: CXPlayDTMFCallAction) {
    Log.call.debug("CXPlayDTMFCallAction - id: \(action.callUUID), length: \(action.digits.count)")

    Task {
      await MainActor.run {
        CallEventEmitter.shared.send(DTMFEvent(id: action.callUUID, digits: action.digits))
      }
    }

    action.fulfill()
  }

  // MARK: - AVAudioSession didActivate

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    Log.call.debug("CallKit audio session activated")

    Task {
      let sessions = await store.allSessions
      AudioManager.shared.onAVAudioSessionActivated(calls: sessions)

      // Play dialtone if any outgoing call is still connecting (not just the
      // first-added session - a second call may be the one connecting while
      // the first is on hold).
      let hasConnectingOutgoingCall = sessions.contains { session in
        (session.origin == .outgoingApp || session.origin == .outgoingSystem)
          && session.status == .connecting
      }
      if hasConnectingOutgoingCall {
        DialtonePlayer.shared.play()
      }
    }
  }

  // MARK: - AVAudioSession didDeactivate

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    Log.call.debug("CallKit audio session deactivated")
    DialtonePlayer.shared.stop()

    Task {
      let sessions = await store.allSessions
      AudioManager.shared.onAVAudioSessionDeactivated(calls: sessions)
    }
  }
}
