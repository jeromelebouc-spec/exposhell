import * as ScreenOrientation from "expo-screen-orientation";
import React, { useEffect, useMemo, useState } from "react";
import {
  BackHandler,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Device } from "react-native-ble-plx";
import YoutubePlayer from "react-native-youtube-iframe";
import { useBle } from "./ble-context";



export default function Index() {
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

  // keep showing video only when user explicitly switches; always go back to
  // list when disconnected
  useEffect(() => {
    if (!connectedId && view === "video") {
      setView("list");
    }
  }, [connectedId, view]);

  useEffect(() => {
    if (view !== "video") {
      // Use portrait for the main BLE list view.
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
      return;
    }

    const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
      setView("list");
      return true;
    });

    // allow orientation changes while in video view
    ScreenOrientation.unlockAsync();

    return () => {
      backHandler.remove();
    };
  }, [view]);



  const renderItem = ({ item }: { item: Device }) => {
    const isConnected = item.id === connectedId;
    const isConnecting = item.id === connectingId;

    return (
      <TouchableOpacity
        style={[
          styles.deviceRow,
          isConnected && styles.deviceRowConnected,
        ]}
        onPress={() => connect(item)}
        disabled={isConnecting || !scanning && !!connectedId}
      >
        <View>
          <Text style={styles.deviceName}>{item.name ?? "Unknown"}</Text>
          <Text style={styles.deviceId}>{item.id}</Text>
        </View>
        <Text style={styles.deviceStatus}>
          {isConnected ? "✅ Connected" : isConnecting ? "…" : "Connect"}
        </Text>
      </TouchableOpacity>
    );
  };

  const scanButtonLabel = useMemo(() => {
    if (scanning) return "Scanning…";
    if (connectedId) return "Scan again";
    return "Start scan";
  }, [scanning, connectedId]);

  if (view === "video") {
    const windowHeight = Dimensions.get("window").height;

    return (
      <View style={styles.videoContainer}>
        <YoutubePlayer
          height={windowHeight}
          play={true}
          videoId="dQw4w9WgXcQ"
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
    <View style={styles.container}>
      <Text style={styles.title}>🩺 BLE Scanner yop</Text>
      <Text style={styles.subtitle}>
        Scanning for cycling/running speed & cadence sensors, power meters, heart rate monitors, and FTMS treadmills (10s scan).
      </Text>

      <TouchableOpacity style={styles.scanButton} onPress={startScan}>
        <Text style={styles.scanButtonText}>{scanButtonLabel}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.scanButton,
          autoReconnect ? styles.toggleOn : styles.toggleOff,
        ]}
        onPress={() => setAutoReconnect((v) => !v)}
      >
        <Text style={styles.scanButtonText}>
          Auto-reconnect: {autoReconnect ? "On" : "Off"}
        </Text>
      </TouchableOpacity>

      {/* button to manually reveal the video player */}
      {/** precompute because TS sometimes narrows view in JSX */}
      {(() => {
        const showVideoButton = connectedId != null && view === "list";
        return showVideoButton ? (
          <TouchableOpacity style={styles.scanButton} onPress={() => setView("video")}>
            <Text style={styles.scanButtonText}>Show video</Text>
          </TouchableOpacity>
        ) : null;
      })()}

      {connectedId ? (
        <TouchableOpacity style={styles.disconnectButton} onPress={() => disconnect(true)}>
          <Text style={styles.disconnectButtonText}>Disconnect</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.telemetryContainer}>
        <Text style={styles.telemetryTitle}>Live data</Text>

        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Connected</Text>
          <Text style={styles.telemetryValue}>
            {connectedName ?? "—"}
          </Text>
        </View>

        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Active services</Text>
          <Text style={styles.telemetryValue}>
            {activeServices.length > 0 ? activeServices.join(", ") : "—"}
          </Text>
        </View>

        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Speed</Text>
          <Text style={styles.telemetryValue}>
            {telemetry.speed != null ? `${telemetry.speed.toFixed(2)} m/s` : "–"}
          </Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Pace</Text>
          <Text style={styles.telemetryValue}>{formatPace(telemetry.speed)}</Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Cadence</Text>
          <Text style={styles.telemetryValue}>
            {telemetry.cadence != null ? `${telemetry.cadence} rpm` : "–"}
          </Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Power</Text>
          <Text style={styles.telemetryValue}>
            {telemetry.power != null ? `${telemetry.power} W` : "–"}
          </Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Heart rate</Text>
          <Text style={styles.telemetryValue}>
            {telemetry.heartRate != null ? `${telemetry.heartRate} bpm` : "–"}
          </Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>HRV (RMSSD)</Text>
          <Text style={styles.telemetryValue}>
            {telemetry.rmssd != null ? `${telemetry.rmssd.toFixed(0)} ms` : "–"}
          </Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Incline</Text>
          <Text style={styles.telemetryValue}>
            {telemetry.incline != null ? `${telemetry.incline.toFixed(2)} %` : "–"}
          </Text>
        </View>
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Distance</Text>
          <Text style={styles.telemetryValue}>
            {telemetry.distance != null ? `${telemetry.distance.toFixed(1)} m` : "–"}
          </Text>
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

      <FlatList
        style={styles.list}
        data={devices}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {scanning
              ? "Scanning… hold tight."
              : "No devices found yet. Start a scan."}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
    marginBottom: 4,
  },
  telemetryLabel: {
    fontSize: 12,
    color: "#444",
  },
  telemetryValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111",
  },
  videoContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  webview: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    padding: 16,
  },
  backButton: {
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  backButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
  liveOverlay: {
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 12,
    padding: 12,
  },
  liveOverlayText: {
    color: "#fff",
    fontSize: 12,
    marginBottom: 4,
  },
});
