import { formatPace } from "@/utils/formatters";
import { Link, useRouter, useLocalSearchParams } from "expo-router";
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
import { useBleStore } from "../store/ble-store";

const { width } = Dimensions.get("window");

export default function Index() {
  const router = useRouter();
  
  // videoId comes back from the youtube picker screen via route params
  const params = useLocalSearchParams<{ videoId?: string }>();
  const [videoId, setVideoId] = useState("dQw4w9WgXcQ");

  useEffect(() => {
    if (params.videoId) setVideoId(params.videoId);
  }, [params.videoId]);

  // Zustand selectors
  const scanning = useBleStore((s) => s.scanning);
  const startScan = useBleStore((s) => s.startScan);
  const connectingId = useBleStore((s) => s.connectingId);
  const devices = useBleStore((s) => s.devices);
  const connectedDevices = useBleStore((s) => s.connectedDevices);
  const autoReconnect = useBleStore((s) => s.autoReconnect);
  const setAutoReconnect = useBleStore((s) => s.setAutoReconnect);
  const telemetry = useBleStore((s) => s.telemetry);
  const telemetryMap = useBleStore((s) => s.telemetryMap);
  const logs = useBleStore((s) => s.logs);
  const connect = useBleStore((s) => s.connect);
  const disconnect = useBleStore((s) => s.disconnect);
  const setPreferredSource = useBleStore((s) => s.setPreferredSource);
  const preferredSource = useBleStore((s) => s.preferredSource);
  const activeServicesMap = useBleStore((s) => s.activeServicesMap);

  const isConnected = connectedDevices.length > 0;

  const [view, setView] = useState<"list" | "video">("list");

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
    const isConn = connectedDevices.some((d) => d.id === item.id);
    const isConnecting = item.id === connectingId;

    return (
      <TouchableOpacity
        style={[styles.deviceRow, isConn && styles.deviceRowConnected]}
        onPress={() => (isConn ? disconnect(item.id) : connect(item))}
        disabled={isConnecting}
      >
        <View>
          <Text style={styles.deviceName}>{item.name ?? "Unknown"}</Text>
          <Text style={styles.deviceId}>{item.id}</Text>
        </View>
        <Text style={[styles.deviceStatus, isConn && { color: "#ff3b30" }]}>
          {isConn ? "Disconnect" : isConnecting ? "…" : "Connect"}
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
              {connectedDevices.length} sensors connected • {Array.from(new Set(Object.values(activeServicesMap).flat())).join(", ")}
            </Text>
            <Text style={styles.liveOverlayText}>
              {telemetry.speed != null ? `${telemetry.speed.toFixed(2)} m/s` : "–"} • {formatPace(telemetry.speed)}
            </Text>
            <Text style={styles.liveOverlayText}>
              Incline {telemetry.incline != null ? `${telemetry.incline.toFixed(2)}%` : "–"} • Dist {telemetry.distance != null ? `${telemetry.distance.toFixed(1)}m` : "–"}
            </Text>
            <Text style={styles.liveOverlayText}>
              HR {telemetry.heartRate != null ? `${telemetry.heartRate} bpm` : "–"} • {telemetry.cadence != null ? `${telemetry.cadence} rpm` : "–"}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🩺 BLE Scanner youpi</Text>
      <Text style={styles.subtitle}>
        Scanning for cycling/running speed & cadence sensors, power meters, heart rate monitors, and FTMS treadmills (10s scan).
      </Text>

      <TouchableOpacity style={styles.scanButton} onPress={startScan}>
        <Text style={styles.scanButtonText}>{scanButtonLabel}</Text>
      </TouchableOpacity>

      <Link href="/debug" asChild>
        <TouchableOpacity style={styles.debugButton}>
          <Text style={styles.debugButtonText}>🛠️ Wide BLE Debug Scan</Text>
        </TouchableOpacity>
      </Link>

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
        const showVideoButton = view === "list";
        return showVideoButton ? (
          <TouchableOpacity style={styles.scanButton} onPress={() => setView("video")}>
            <Text style={styles.scanButtonText}>Show video</Text>
          </TouchableOpacity>
        ) : null;
      })()}

      <TouchableOpacity
        style={[styles.scanButton, styles.youtubeButton]}
        onPress={() => router.push("/youtube")}
      >
        <Text style={styles.scanButtonText}>📺  Pick YouTube video</Text>
      </TouchableOpacity>

      {isConnected ? (
        <TouchableOpacity style={styles.disconnectButton} onPress={() => connectedDevices.forEach(d => disconnect(d.id))}>
          <Text style={styles.disconnectButtonText}>Disconnect all</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.telemetryContainer}>
        <Text style={styles.telemetryTitle}>Live data</Text>

        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryLabel}>Sensors</Text>
          <Text style={styles.telemetryValue}>
            {connectedDevices.length > 0
              ? `${connectedDevices.length} connected`
              : "—"}
          </Text>
        </View>

        {(
          [
            "speed",
            "cadence",
            "heartRate",
            "power",
            "rmssd",
            "incline",
            "distance",
          ] as const
        ).map((metric) => {
          const value = telemetry[metric];
          const sourceId = preferredSource[metric];
          const sources = connectedDevices.filter(
            (d) => telemetryMap[d.id]?.[metric] !== null
          );
          const sourceDevice = connectedDevices.find((d) => d.id === sourceId);

          const label = {
            speed: "Speed",
            cadence: "Cadence",
            heartRate: "Heart Rate",
            power: "Power",
            rmssd: "HRV (RMSSD)",
            incline: "Incline",
            distance: "Distance",
          }[metric];

          return (
            <View key={metric} style={styles.metricRow}>
              <View style={styles.metricInfo}>
                <Text style={styles.telemetryLabel}>{label}</Text>
                {sources.length > 1 && (
                  <TouchableOpacity
                    onPress={() => {
                      const idx = sources.findIndex((s) => s.id === sourceId);
                      const next = sources[(idx + 1) % sources.length];
                      setPreferredSource(metric, next.id);
                    }}
                    style={styles.sourceToggle}
                  >
                    <Text style={styles.sourceToggleText}>
                      Source: {sourceDevice?.name ?? "Auto"} 🔄
                    </Text>
                  </TouchableOpacity>
                )}
                {sources.length === 1 && (
                  <Text style={styles.sourceInfo}>{sourceDevice?.name}</Text>
                )}
              </View>
              <Text style={styles.telemetryValue}>
                {value !== null
                  ? typeof value === "number"
                    ? metric === "speed"
                      ? `${value.toFixed(2)} m/s`
                      : metric === "distance"
                      ? `${value.toFixed(1)} m`
                      : metric === "incline"
                      ? `${value.toFixed(2)} %`
                      : Math.round(value)
                    : value
                  : "–"}
              </Text>
            </View>
          );
        })}
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
  youtubeButton: {
    backgroundColor: "#FF0000",
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
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
    paddingBottom: 4,
  },
  metricInfo: {
    flex: 1,
  },
  sourceToggle: {
    marginTop: 2,
  },
  sourceToggleText: {
    fontSize: 10,
    color: "#007aff",
    fontWeight: "600",
  },
  sourceInfo: {
    fontSize: 10,
    color: "#666",
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
    fontWeight: "600",
  },
  debugButton: {
    padding: 12,
    marginTop: 12,
    alignItems: "center",
    backgroundColor: "#f0f0f5",
    borderRadius: 8,
  },
  debugButtonText: {
    color: "#8e8e93",
    fontSize: 14,
    fontWeight: "600",
  },
});
