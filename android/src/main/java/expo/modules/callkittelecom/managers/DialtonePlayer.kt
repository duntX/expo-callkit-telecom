package expo.modules.callkittelecom.managers

import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import expo.modules.callkittelecom.utils.CallKitTelecomLog
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Plays the dialtone sound during outgoing call connection.
 *
 * Reads the dialtone resource name from AndroidManifest metadata
 * (`ExpoCallKitTelecomDefaultDialtone`) and plays it in a loop with a fade-in until stopped.
 *
 * Only one dialtone is audible at a time (there's one earpiece/speaker), but with 2
 * concurrent call sessions, both calls can independently request/stop it. [play] and [stop]
 * are keyed by call id: stopping call A never stops call B's dialtone, and if call A's
 * dialtone finishes first, call B's still-pending request (if any) starts automatically.
 */
object DialtonePlayer {
    private const val TAG = "ExpoCallKitTelecom.Dialtone"
    private const val KEY_DEFAULT_DIALTONE = "ExpoCallKitTelecomDefaultDialtone"

    /** Delay before starting playback to let audio session settle (in ms). */
    private const val START_DELAY_MS = 50L

    /** Duration of volume fade-in (in ms). */
    private const val FADE_IN_DURATION_MS = 100L
    private const val FADE_STEPS = 10

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val mutex = Mutex()

    private var player: MediaPlayer? = null
    private var playingCallId: UUID? = null
    private var fadeJob: Job? = null
    private var rawResourceId: Int = 0
    private var isInitialized = false

    /** Calls that requested a dialtone while another call's was already playing. */
    private val pendingCallIds = linkedSetOf<UUID>()

    /** Whether a dialtone resource is configured in the manifest. */
    val hasDialtone: Boolean
        get() = rawResourceId != 0

    /** Reads dialtone config from AndroidManifest metadata. Safe to call repeatedly. */
    fun initialize(context: Context) {
        if (isInitialized) return

        val appContext = context.applicationContext
        val dialtoneFilename =
            try {
                val appInfo =
                    appContext.packageManager.getApplicationInfo(
                        appContext.packageName,
                        PackageManager.GET_META_DATA,
                    )
                appInfo.metaData?.getString(KEY_DEFAULT_DIALTONE)
            } catch (_: Throwable) {
                null
            }

        if (dialtoneFilename == null) {
            CallKitTelecomLog.d(TAG) { "No dialtone configured in manifest" }
            isInitialized = true
            return
        }

        // The plugin writes the sanitized resource name into the manifest,
        // so we can use it directly for the resource lookup.
        rawResourceId =
            appContext.resources.getIdentifier(dialtoneFilename, "raw", appContext.packageName)
        if (rawResourceId == 0) {
            CallKitTelecomLog.e(TAG) { "Dialtone raw resource not found: $dialtoneFilename" }
        } else {
            CallKitTelecomLog.d(TAG) {
                "Initialized dialtone: $dialtoneFilename (resId=$rawResourceId)"
            }
        }

        isInitialized = true
    }

    /**
     * Starts playing the dialtone for [callId] in a loop with fade-in, or queues it if another
     * call's dialtone is already playing - it starts as soon as that call's [stop] is called.
     */
    fun play(context: Context, callId: UUID) {
        if (!hasDialtone) {
            CallKitTelecomLog.d(TAG) { "No dialtone configured, skipping playback" }
            return
        }

        if (!CallAudioManager.isActive) {
            CallKitTelecomLog.d(TAG) { "Audio session not active, skipping dialtone" }
            return
        }

        scope.launch {
            mutex.withLock {
                if (player != null) {
                    if (playingCallId != callId) {
                        pendingCallIds.add(callId)
                        CallKitTelecomLog.d(TAG) {
                            "Dialtone already playing for another call, queuing - callId: $callId"
                        }
                    }
                    return@withLock
                }

                startPlayback(context, callId)
            }
        }
    }

    /** Actually creates and starts the MediaPlayer for [callId]. Must be called under [mutex]. */
    private suspend fun startPlayback(context: Context, callId: UUID) {
        try {
            val mp = MediaPlayer()
            mp.setAudioAttributes(
                AudioAttributes.Builder()
                    // Routes into the active call's audio path instead of the
                    // media stream, which many devices mute while a call is
                    // active (AudioManager.MODE_IN_COMMUNICATION).
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            context.applicationContext.resources
                .openRawResourceFd(rawResourceId)
                .use { afd ->
                    mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                }
            mp.prepare()

            mp.isLooping = true
            mp.setVolume(0f, 0f)
            player = mp
            playingCallId = callId
            pendingCallIds.remove(callId)

            // Brief delay to let audio session settle
            delay(START_DELAY_MS)

            if (player == mp) {
                mp.start()
                fadeIn()
                CallKitTelecomLog.d(TAG) { "Started playing dialtone - callId: $callId" }
            }
        } catch (e: Throwable) {
            CallKitTelecomLog.e(TAG) { "Failed to play dialtone: ${e.localizedMessage}" }
            player?.release()
            player = null
            playingCallId = null
        }
    }

    /** Fades in the volume from 0 to 1 over FADE_IN_DURATION_MS. */
    private fun fadeIn() {
        fadeJob?.cancel()
        val stepDuration = FADE_IN_DURATION_MS / FADE_STEPS
        val volumeStep = 1.0f / FADE_STEPS

        fadeJob =
            scope.launch {
                for (step in 1..FADE_STEPS) {
                    delay(stepDuration)
                    val volume = volumeStep * step
                    player?.setVolume(volume, volume)
                }
                fadeJob = null
            }
    }

    /**
     * Stops [callId]'s dialtone if it's the one currently playing, and promotes the next
     * queued call (if any) to take over playback. A no-op if [callId] isn't the active or a
     * queued call - so one call ending/timing out never silences another's dialtone.
     */
    fun stop(context: Context, callId: UUID) {
        scope.launch {
            mutex.withLock {
                if (playingCallId != callId) {
                    pendingCallIds.remove(callId)
                    return@withLock
                }

                stopActivePlayback()

                val next = pendingCallIds.firstOrNull()
                if (next != null) {
                    startPlayback(context, next)
                }
            }
        }
    }

    /** Stops every call's dialtone/queue. For teardown when no calls remain. */
    fun stopAll() {
        scope.launch {
            mutex.withLock {
                pendingCallIds.clear()
                stopActivePlayback()
            }
        }
    }

    /** Releases the current MediaPlayer, if any. Must be called under [mutex]. */
    private fun stopActivePlayback() {
        fadeJob?.cancel()
        fadeJob = null

        val mp = player ?: return
        player = null
        playingCallId = null

        try {
            if (mp.isPlaying) {
                mp.stop()
            }
            mp.release()
            CallKitTelecomLog.d(TAG) { "Stopped playing dialtone" }
        } catch (e: Throwable) {
            CallKitTelecomLog.e(TAG) { "Error stopping dialtone: ${e.localizedMessage}" }
        }
    }

    /** Whether the dialtone is currently playing. */
    val isPlaying: Boolean
        get() = player?.isPlaying == true
}
