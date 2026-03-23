import { useLocalSearchParams, useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import React, { useEffect, useMemo, useState } from "react";
import {
  BackHandler,
  Dimensions,
  FlatList,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";
import { useBle } from "./ble-context";

export default function Index() {
  const router = useRouter();
  const params = useLocalSearchParams<{ videoId?: string }>();
  const [videoId, setVideoId] = useState("dQw4w9WgXcQ");

  useEffect(() => {
    if (params.videoId) setVideoId(params.videoId);
  }, [params.videoId]);

  const {
    devices,
    scanning,
    connectingId,
    connectedId,
    connectedName,
    autoReconnect,
    telemetry,
    activeServices,
    logs,
    startScan,
    connect,
    disconnect,
    setAutoReconnect,
    formatPace,
  } = useBle();

  const [view, setView] = useState<"list" | "video">("list");

  useEffect(() => {
    if (!connectedId && view === "video") {
      setView("list");
    }
  }, [connectedId, view]);

  useEffect(() => {
    if (view !== "video") {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
      return;
    }

    const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
      setView("list");
      return true;
    });

    ScreenOrientation.unlockAsync();

    return () => {
      backHandler.remove();
    };
  }, [view]);

  const isConnected = !!connectedId;

  const renderItem = ({ item }: { item: any }) => {
    const isItemConnected = item.id === connectedId;
    const isConnecting = item.id === connectingId;

    return (
      <TouchableOpacity
        style={[styles.deviceRow, isItemConnected && styles.deviceRowConnected]}
        onPress={() => connect(item)}
        disabled={isConnecting || (!scanning && isConnected)}
      >
        <View>
          <Text style={styles.deviceName}>{item.name ?? "Unknown"}</Text>
          <Text style={styles.deviceId}>{item.id}</Text>
        </View>
        <Text style={styles.deviceStatus}>
          {isItemConnected ? "✅ Connected" : isConnecting ? "…" : "Connect"}
        </Text>
      </TouchableOpacity>
    );
  };

  const scanButtonLabel = useMemo(() => {
    if (scanning) return "Scanning…";
    if (isConnected) return "Scan again";
    return "Start scan";
  }, [scanning, isConnected]);

  if (view === "video") {
    const windowHeight = Dimensions.get("window").height;

    return (
      <View style={styles.videoContainer}>
        <YoutubePlayer
          height={windowHeight}
          play={true}
          videoId={videoId}
          webViewStyle={styles.webview}
          webViewProps={{
            allowsInlineMediaPlayback: true,
            mediaPlaybackRequiresUserAction: false,
          }}
        />

        <View style={styles.overlay} pointerEvents="box-none">
          <TouchableOpacity style={styles.backButton} onPress={() => setView("list")}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.liveOverlay}>
            <Text style={styles.liveOverlayText}>
              {connectedName ?? "Connected"} • {activeServices.join(", ") || "No services"}
            </Text>
            <Text style={styles.liveOverlayText}>
              {telemetry.speed != null ? `${telemetry.speed.toFixed(2)} m/s` : "–"} • {formatPace(telemetry.speed)}
            </Text>
            <Text style={styles.liveOverlayText}>
              Incline {telemetry.incline != null ? `${telemetry.incline.toFixed(2)}%` : "–"} • Dist {telemetry.distance != null ? `${telemetry.distance.toFixed(1)}m` : "–"}
            </Text>
            <Text style={styles.liveOverlayText}>
              HR {telemetry.heartRate != null ? `${telemetry.heartRate} bpm` : "–"} • HRV {telemetry.rmssd != null ? `${telemetry.rmssd.toFixed(0)} ms` : "–"}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        <Text style={styles.title}>🩺 BLE Scanner yo</Text>
        <Text style={styles.subtitle}>
        Scanning for sensors.
      </Text>

      <TouchableOpacity style={styles.scanButton} onPress={startScan}>
        <Text style={styles.scanButtonText}>{scanButtonLabel}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.scanButton, autoReconnect ? styles.toggleOn : styles.toggleOff]}
        onPress={() => setAutoReconnect((v) => !v)}
      >
        <Text style={styles.scanButtonText}>Auto-reconnect: {autoReconnect ? "On" : "Off"}</Text>
      </TouchableOpacity>

      {isConnected ? (
        <TouchableOpacity style={styles.disconnectButton} onPress={() => disconnect(true)}>
          <Text style={styles.disconnectButtonText}>Disconnect</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.telemetryContainer}>
        <Text style={styles.telemetryTitle}>Live data</Text>

        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Connected</Text>
          <Text style={styles.telemetryValue}>{connectedName ?? "—"}</Text>
        </View>

        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Active services</Text>
          <Text style={styles.telemetryValue}>{activeServices.length > 0 ? activeServices.join(", ") : "—"}</Text>
        </View>

        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Speed</Text>
          <Text style={styles.telemetryValue}>{telemetry.speed != null ? `${telemetry.speed.toFixed(2)} m/s` : "–"}</Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Pace</Text>
          <Text style={styles.telemetryValue}>{formatPace(telemetry.speed)}</Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Cadence</Text>
          <Text style={styles.telemetryValue}>{telemetry.cadence != null ? `${telemetry.cadence} rpm` : "–"}</Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Power</Text>
          <Text style={styles.telemetryValue}>{telemetry.power != null ? `${telemetry.power} W` : "–"}</Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Heart rate</Text>
          <Text style={styles.telemetryValue}>{telemetry.heartRate != null ? `${telemetry.heartRate} bpm` : "–"}</Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>HRV (RMSSD)</Text>
          <Text style={styles.telemetryValue}>{telemetry.rmssd != null ? `${telemetry.rmssd.toFixed(0)} ms` : "–"}</Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Incline</Text>
          <Text style={styles.telemetryValue}>{telemetry.incline != null ? `${telemetry.incline.toFixed(2)} %` : "–"}</Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Distance</Text>
          <Text style={styles.telemetryValue}>{telemetry.distance != null ? `${telemetry.distance.toFixed(1)} m` : "–"}</Text>
        </View>
      </View>

      <View style={styles.logContainer}>
        <Text style={styles.logTitle}>Log</Text>
        <FlatList
          data={logs}
          keyExtractor={(item, index) => `${item}-${index}`}
          renderItem={({ item }) => <Text style={styles.logLine}>{item}</Text>}
          style={styles.logList}
          inverted
          ListEmptyComponent={<Text style={styles.logEmpty}>No logs yet.</Text>}
        />
      </View>

      </ScrollView>

      <FlatList
        style={styles.list}
        data={devices}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {scanning ? "Scanning… hold tight." : "No devices found yet. Start a scan."}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fff",
  },
  contentContainer: {
    padding: 16,
    backgroundColor: "#fff",
  },
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#444",
    marginBottom: 16,
  },
  scanButton: {
    backgroundColor: "#007aff",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 16,
  },
  scanButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  disconnectButton: {
    backgroundColor: "#ff3b30",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 16,
  },
  disconnectButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  toggleOn: {
    borderColor: "#28a745",
    borderWidth: 1,
  },
  toggleOff: {
    borderColor: "#ccc",
    borderWidth: 1,
  },
  logContainer: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    backgroundColor: "#fafafa",
    maxHeight: 180,
  },
  logTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8,
  },
  logList: {
    flex: 1,
  },
  logLine: {
    fontSize: 12,
    color: "#333",
    marginBottom: 4,
  },
  logEmpty: {
    color: "#666",
    fontSize: 12,
  },
  list: {
    flex: 1,
  },
  emptyText: {
    textAlign: "center",
    marginTop: 48,
    color: "#666",
  },
  deviceRow: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#f9f9f9",
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  deviceRowConnected: {
    borderColor: "#34c759",
    borderWidth: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: "600",
  },
  deviceId: {
    fontSize: 12,
    color: "#666",
  },
  deviceStatus: {
    fontSize: 14,
    fontWeight: "700",
    color: "#007aff",
  },
  telemetryContainer: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    backgroundColor: "#fafafa",
  },
  telemetryTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8,
  },
  telemetryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  telemetryLabel: {
    color: "#333",
    fontWeight: "600",
  },
  telemetryValue: {
    color: "#111",
    fontWeight: "700",
  },
  videoContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  webview: {
    flex: 1,
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "space-between",
  },
  backButton: {
    margin: 20,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  backButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  liveOverlay: {
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  liveOverlayText: {
    color: "#fff",
    fontSize: 12,
  },
});
