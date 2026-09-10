package expo.modules.callkittelecom.managers

import android.content.Context
import android.os.PowerManager
import expo.modules.callkittelecom.utils.CallKitTelecomLog

/**
 * Dims/locks the screen via the proximity sensor while a call is connected,
 * mirroring the OS-driven behavior CallKit provides for free on iOS.
 *
 * Core-Telecom self-managed calls have no system call screen on Android, so
 * this has to be done explicitly with a PROXIMITY_SCREEN_OFF_WAKE_LOCK.
 */
object ProximityManager {
    private const val TAG = "ExpoCallKitTelecom.Proximity"
    private const val WAKE_LOCK_TAG = "ExpoCallKitTelecom:Proximity"

    private var wakeLock: PowerManager.WakeLock? = null

    /** Acquires the proximity wake lock if not already held. Safe to call repeatedly. */
    fun acquire(context: Context) {
        val lock = wakeLock ?: createWakeLock(context) ?: return
        if (!lock.isHeld) {
            lock.acquire()
            CallKitTelecomLog.d(TAG) { "Proximity wake lock acquired" }
        }
    }

    /** Releases the proximity wake lock if held. Safe to call repeatedly. */
    fun release() {
        val lock = wakeLock ?: return
        if (lock.isHeld) {
            lock.release()
            CallKitTelecomLog.d(TAG) { "Proximity wake lock released" }
        }
    }

    private fun createWakeLock(context: Context): PowerManager.WakeLock? {
        val powerManager =
            context.applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (powerManager?.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK) != true) {
            CallKitTelecomLog.d(TAG) { "Proximity wake lock not supported on this device" }
            return null
        }
        return powerManager
            .newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, WAKE_LOCK_TAG)
            .also { it.setReferenceCounted(false) }
            .also { wakeLock = it }
    }
}
