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

  /// Timeout for waiting for JS cleanup after ending/declining a call.
  private static let endCallTimeout: Duration = {
    let seconds =
      Bundle.main.object(
        forInfoDictionaryKey: "ExpoCallKitTelecomFulfillEndCallTimeout"
      ) as? Int ?? 5
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
        update.supportsHolding = supportsHolding
        update.supportsGrouping = supportsGrouping
        update.supportsUngrouping = supportsUngrouping
        update.supportsDTMF = supportsDTMF
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
        let reason = callEndedReason(for: session)
        session.status = .ended

        let (requestId, resultTask) = await FulfillRequestManager.shared.createRequest(
          callId: action.callUUID,
          timeout: Self.endCallTimeout
        )

        let deliveredToJS = await MainActor.run {
          CallEventEmitter.shared.send(
            CallEndedEvent(
              id: action.callUUID,
              reason: reason,
              requestId: requestId,
              session: session
            ))
        }

        if deliveredToJS {
          let result = await resultTask.value
          switch result {
          case .fulfilled:
            Log.call.debug("CXEndCallAction JS cleanup fulfilled - id: \(action.callUUID)")
          case .cancelled:
            Log.call.debug("CXEndCallAction JS cleanup cancelled - id: \(action.callUUID)")
          case .timedOut:
            Log.call.debug("CXEndCallAction JS cleanup timed out - id: \(action.callUUID)")
          }
        } else {
          await FulfillRequestManager.shared.cancel(requestId: requestId)
        }
      }

      await store.remove(for: action.callUUID)
      action.fulfill()
    }
  }

  private func callEndedReason(for session: CallSession) -> CallEndedEvent.Reason {
    if session.origin == .incoming, session.status == .ringing {
      return .declined
    }

    switch session.status {
    case .connecting, .connected:
      return .localEnded
    case .requesting, .ringing, .ended:
      return .systemEnded
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
      if !action.isOnHold && await store.hasOtherNonHeldSession(action.callUUID) {
        Log.call.warning(
          "CXSetHeldCallAction rejected - another session is already not held: \(action.callUUID)")
        action.fail()
        return
      }

      await store.updateHeld(for: action.callUUID, isOnHold: action.isOnHold)

      await MainActor.run {
        CallEventEmitter.shared.send(
          SetHeldActionEvent(id: action.callUUID, isOnHold: action.isOnHold))
      }

      action.fulfill()
    }
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

      // Play dialtone for outgoing calls that are still connecting
      if let session = sessions.first(where: { !$0.isOnHold }),
        session.origin == .outgoingApp || session.origin == .outgoingSystem,
        session.status == .connecting
      {
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
