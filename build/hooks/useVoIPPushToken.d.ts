import type { VoIPPushToken } from "../Calls.types";
/**
 * Hook that returns the current VoIP push token and subscribes to updates.
 *
 * Reads the initial token synchronously and re-renders whenever the native
 * `onVoIPPushTokenUpdated` event fires (e.g. when the OS provides a new token
 * or invalidates the existing one).
 *
 * On iOS this returns an APNs VoIP token; on Android it returns an FCM token.
 *
 * @returns The current token, or `null` if not yet available.
 *
 * @see {@link registerVoIPPush} — must be called once before any token will be available.
 * @see {@link getVoIPPushToken} — non-hook accessor for the same token.
 * @see {@link addVoIPPushTokenUpdatedListener} — the underlying subscription.
 *
 * @category Hooks
 */
export declare function useVoIPPushToken(): VoIPPushToken | null;
//# sourceMappingURL=useVoIPPushToken.d.ts.map