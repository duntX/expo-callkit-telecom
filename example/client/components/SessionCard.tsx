import {
  type CallSession,
  type CallSessionStatus,
  endCall,
  reportCallEnded,
  reportVideo,
  setHeld,
  setMuted,
} from "expo-callkit-telecom";
import { StyleSheet, Text, View } from "react-native";

import { ActionButton } from "./ActionButton";
import { Card } from "./Card";

interface SessionCardProps {
  sessions: CallSession[];
  onError: (message: string) => void;
}

export function SessionCard({ sessions, onError }: SessionCardProps) {
  const activeSession = sessions.find((session) => !session.isOnHold) ?? null;

  return (
    <Card title="Call Sessions">
      <View style={styles.row}>
        <Pill
          label={`${sessions.length}/2 Sessions`}
          color={sessions.length ? "green" : "gray"}
        />
        <Pill
          label={`${sessions.filter((session) => !session.isOnHold).length}/1 Non-held`}
          color={activeSession ? "green" : "gray"}
        />
      </View>

      {sessions.length === 0 ? (
        <Text style={styles.empty}>No active native call sessions.</Text>
      ) : (
        sessions.map((session, index) => (
          <SessionRow
            key={session.id}
            session={session}
            label={String.fromCharCode(65 + index)}
            canResume={!activeSession || activeSession.id === session.id}
            onError={onError}
          />
        ))
      )}
    </Card>
  );
}

type PillColor =
  | "green"
  | "gray"
  | "blue"
  | "purple"
  | "orange"
  | "yellow"
  | "red";

const STATUS_COLOR: Record<CallSessionStatus, PillColor> = {
  requesting: "yellow",
  connecting: "yellow",
  ringing: "yellow",
  connected: "green",
  ended: "red",
};

const PALETTE: Record<PillColor, { bg: string; fg: string; dot: string }> = {
  green: { bg: "#d1f5d3", fg: "#1a6b2c", dot: "#2ea043" },
  gray: { bg: "#f1f1f1", fg: "#5f6368", dot: "#9aa0a6" },
  blue: { bg: "#d8e8ff", fg: "#1a4b8c", dot: "#2670d9" },
  purple: { bg: "#ead8ff", fg: "#5a1d9c", dot: "#8b3edc" },
  orange: { bg: "#ffe1c4", fg: "#8a4a10", dot: "#e07a1f" },
  yellow: { bg: "#fff3c4", fg: "#7a5d10", dot: "#d9a91f" },
  red: { bg: "#fdd6d6", fg: "#8a1c1c", dot: "#d93636" },
};

function Pill({ label, color }: { label: string; color: PillColor }) {
  const c = PALETTE[color];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <View style={[styles.dot, { backgroundColor: c.dot }]} />
      <Text style={[styles.label, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

function SessionRow({
  session,
  label,
  canResume,
  onError,
}: {
  session: CallSession;
  label: string;
  canResume: boolean;
  onError: (message: string) => void;
}) {
  const name = session.remoteParticipants[0]?.displayName ?? "Unknown";
  const hasVideo = session.options.hasVideo;
  const shortId = session.id.slice(0, 8);

  return (
    <View style={styles.session}>
      <View style={styles.sessionHeader}>
        <Text style={styles.sessionTitle}>
          Call {label} · {name}
        </Text>
        <Text style={styles.sessionId}>{shortId}</Text>
      </View>
      <View style={styles.row}>
        <Pill
          label={session.status[0].toUpperCase() + session.status.slice(1)}
          color={STATUS_COLOR[session.status]}
        />
        <Pill
          label={session.isOnHold ? "Held" : "Non-held"}
          color={session.isOnHold ? "yellow" : "green"}
        />
        <Pill
          label={hasVideo ? "Video" : "Audio"}
          color={hasVideo ? "purple" : "blue"}
        />
        <Pill
          label={session.isMuted ? "Muted" : "Unmuted"}
          color={session.isMuted ? "orange" : "gray"}
        />
      </View>
      <View style={styles.actions}>
        <ActionButton
          title={session.isOnHold ? "Resume" : "Hold"}
          disabled={session.isOnHold && !canResume}
          onPress={() =>
            setHeld(session.id, !session.isOnHold).catch((e) =>
              onError(`hold error: ${e}`),
            )
          }
        />
        <ActionButton
          title={session.isMuted ? "Unmute" : "Mute"}
          onPress={() =>
            setMuted(session.id, !session.isMuted).catch((e) =>
              onError(`mute error: ${e}`),
            )
          }
        />
        <ActionButton
          title={hasVideo ? "Disable Video" : "Enable Video"}
          onPress={() =>
            reportVideo(session.id, !hasVideo).catch((e) =>
              onError(`video error: ${e}`),
            )
          }
        />
        <ActionButton
          title="End"
          variant="destructive"
          onPress={() =>
            endCall(session.id).catch((e) => onError(`end error: ${e}`))
          }
        />
        <ActionButton
          title="Remote Ended"
          variant="destructive"
          onPress={() =>
            reportCallEnded(session.id, "remoteEnded").catch((e) =>
              onError(`remote end error: ${e}`),
            )
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  empty: { color: "#5f6368", fontSize: 14, marginTop: 8 },
  session: {
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 12,
    marginTop: 12,
  },
  sessionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  sessionTitle: { flex: 1, fontSize: 15, fontWeight: "600" },
  sessionId: { color: "#5f6368", fontSize: 12 },
  actions: { gap: 8, marginTop: 10 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  label: { fontSize: 12, fontWeight: "600" },
});
