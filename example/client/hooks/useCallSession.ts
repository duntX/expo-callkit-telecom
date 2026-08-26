import {
  addCallSessionAddedListener,
  addCallSessionRemovedListener,
  addCallSessionUpdatedListener,
  type CallSession,
  getActiveCallSession,
} from "expo-callkit-telecom";
import { useEffect, useState } from "react";

/**
 * Tracks current call sessions. Hydrates once from
 * {@link getActiveCallSession} (in case the JS layer started after a call
 * was already in progress), then keeps state in sync via the lib's
 * session lifecycle listeners.
 */
export function useCallSessions(): CallSession[] {
  const [sessions, setSessions] = useState<CallSession[]>([]);

  useEffect(() => {
    getActiveCallSession().then((session) => {
      if (session) setSessions([session]);
    });
    const subs = [
      addCallSessionAddedListener((e) =>
        setSessions((current) => upsertSession(current, e.session)),
      ),
      addCallSessionUpdatedListener((e) =>
        setSessions((current) => upsertSession(current, e.session)),
      ),
      addCallSessionRemovedListener((e) =>
        setSessions((current) =>
          current.filter((session) => session.id !== e.id),
        ),
      ),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return sessions;
}

export function useCallSession(): CallSession | null {
  const sessions = useCallSessions();
  return sessions.find((session) => !session.isOnHold) ?? sessions[0] ?? null;
}

function upsertSession(
  sessions: CallSession[],
  nextSession: CallSession,
): CallSession[] {
  const index = sessions.findIndex((session) => session.id === nextSession.id);
  if (index === -1) {
    return [...sessions, nextSession];
  }

  const nextSessions = [...sessions];
  nextSessions[index] = nextSession;
  return nextSessions;
}
