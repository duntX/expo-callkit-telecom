import {
  type AudioSession,
  type CallSession,
  reportIncomingCall,
  setAudioSessionPortOverride,
  startOutgoingCall,
} from "expo-callkit-telecom";
import { randomUUID } from "expo-crypto";
import { Alert, StyleSheet, View } from "react-native";

import { ActionButton } from "./ActionButton";
import { Card } from "./Card";

interface ActionsCardProps {
  activeSession: CallSession | null;
  sessions: CallSession[];
  audio: AudioSession;
  canConnect: boolean;
  onConnect: () => void;
  onFailConnect: () => void;
  onError: (message: string) => void;
}

export function ActionsCard({
  activeSession,
  sessions,
  audio,
  canConnect,
  onConnect,
  onFailConnect,
  onError,
}: ActionsCardProps) {
  const simulateIncoming = (hasVideo: boolean) =>
    reportIncomingCall({
      eventId: randomUUID(),
      serverCallId: `local-${Date.now()}`,
      hasVideo,
      startedAt: new Date().toISOString(),
      caller: {
        id: "demo-caller",
        displayName: hasVideo ? "Demo Video Caller" : "Demo Audio Caller",
      },
    }).catch((e) => onError(`simulate error: ${e}`));

  const startOutgoing = (hasVideo: boolean) =>
    startOutgoingCall(
      {
        id: "demo-recipient",
        displayName: hasVideo ? "Demo Video Recipient" : "Demo Audio Recipient",
      },
      { hasVideo },
    ).catch((e) => onError(`outgoing error: ${e}`));

  const onSpeaker = audio.currentRoute.outputs.some(
    (o) => o.portType === "builtInSpeaker",
  );
  const hasVideo = activeSession?.options.hasVideo ?? false;
  const canStartAnotherCall =
    sessions.length < 2 && sessions.every((session) => session.isOnHold);

  return (
    <Card title="Actions">
      <ActionButton
        title="Start outgoing call"
        disabled={!canStartAnotherCall}
        onPress={() => promptCallKind("Start outgoing call", startOutgoing)}
      />
      <View style={styles.spacer} />
      <ActionButton
        title="Simulate incoming call"
        disabled={!canStartAnotherCall}
        onPress={() =>
          promptCallKind("Simulate incoming call", simulateIncoming)
        }
      />
      <View style={styles.divider} />
      <ActionButton
        title="Connect Call"
        disabled={!canConnect}
        onPress={onConnect}
      />
      <View style={styles.spacer} />
      <ActionButton
        title="Fail Connection"
        variant="destructive"
        disabled={!canConnect}
        onPress={onFailConnect}
      />
      <View style={styles.divider} />
      <ActionButton
        title={onSpeaker ? "Switch to Earpiece" : "Switch to Speaker"}
        disabled={!activeSession || hasVideo}
        onPress={() => setAudioSessionPortOverride(!onSpeaker)}
      />
    </Card>
  );
}

function promptCallKind(title: string, choose: (hasVideo: boolean) => void) {
  Alert.alert(title, undefined, [
    { text: "Cancel", style: "cancel" },
    { text: "Audio", onPress: () => choose(false) },
    { text: "Video", onPress: () => choose(true) },
  ]);
}

const styles = StyleSheet.create({
  spacer: { height: 8 },
  divider: {
    height: 1,
    backgroundColor: "#eee",
    marginVertical: 12,
  },
});
