import * as ScreenOrientation from "expo-screen-orientation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Dimensions,
  FlatList,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BleManager, Device } from "react-native-ble-plx";
import YoutubePlayer from "react-native-youtube-iframe";

function base64ToBytes(base64: string) {
  // Pure JS base64 decode (works in React Native without Buffer/atob).
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i += 1) {
    lookup[chars.charCodeAt(i)] = i;
  }

  const len = base64.length;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array(((len * 3) / 4) - padding);

  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = lookup[base64.charCodeAt(i)];
    const encoded2 = lookup[base64.charCodeAt(i + 1)];
    const encoded3 = lookup[base64.charCodeAt(i + 2)];
    const encoded4 = lookup[base64.charCodeAt(i + 3)];

    const byte1 = (encoded1 << 2) | (encoded2 >> 4);
    bytes[p++] = byte1;

    if (p < bytes.length) {
      const byte2 = ((encoded2 & 15) << 4) | (encoded3 >> 2);
      bytes[p++] = byte2;
    }

    if (p < bytes.length) {
      const byte3 = ((encoded3 & 3) << 6) | encoded4;
      bytes[p++] = byte3;
    }
  }

  return bytes;
}

function parseRSCMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  const flags = bytes[0];
  const speed = (bytes[1] | (bytes[2] << 8)) / 256; // m/s
  const cadence = bytes[3];
  return { speed, cadence, flags };
}

function parseCSCMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  const flags = bytes[0];
  let cadence: number | null = null;
  let wheelRevs: number | null = null;

  let offset = 1;
  const hasWheel = (flags & 0x01) !== 0;
  const hasCrank = (flags & 0x02) !== 0;

  if (hasWheel) {
    wheelRevs =
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);
    offset += 4;
    offset += 2; // wheel event time (ignored)
  }

  if (hasCrank) {
    cadence = bytes[offset] | (bytes[offset + 1] << 8);
  }

  return { cadence, wheelRevs, flags };
}

function parseHeartRateMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  const flags = bytes[0];
  const formatUint16 = (flags & 0x01) !== 0;

  let offset = 1;
  const heartRate = formatUint16
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : bytes[offset];
  offset += formatUint16 ? 2 : 1;

  // If bit 3 is set, RR-Interval values follow (uint16, units 1/1024s).
  const hasRr = (flags & 0x10) !== 0;
  const rrIntervals: number[] = [];
  if (hasRr) {
    while (offset + 1 < bytes.length) {
      const raw = bytes[offset] | (bytes[offset + 1] << 8);
      const ms = (raw * 1000) / 1024;
      rrIntervals.push(ms);
      offset += 2;
    }
  }

  return { heartRate, flags, rrIntervals };
}

function parseCyclingPowerMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  // flags uint16
  const power = (bytes[2] | (bytes[3] << 8));
  return { power, flags: bytes[0] | (bytes[1] << 8) };
}

function formatPace(speedMps: number | null) {
  if (!speedMps || speedMps <= 0) return "–";
  const kmh = speedMps * 3.6;
  const minutesPerKm = 60 / kmh;
  const mins = Math.floor(minutesPerKm);
  const secs = Math.round((minutesPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function computeRmssd(rrIntervals: number[]) {
  if (rrIntervals.length < 2) return null;
  const diffs = rrIntervals
    .slice(1)
    .map((v, i) => v - rrIntervals[i])
    .map((d) => d * d);
  const mean = diffs.reduce((sum, v) => sum + v, 0) / diffs.length;
  return Math.sqrt(mean);
}

async function requestBlePermissions() {
  if (Platform.OS !== "android") return true;

  const permissions = [
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ];

  const granted = await PermissionsAndroid.requestMultiple(permissions);

  return (
    granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
      PermissionsAndroid.RESULTS.GRANTED &&
    granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
      PermissionsAndroid.RESULTS.GRANTED
  );
}

export default function Index() {
  const manager = useRef<BleManager | null>(null);
  const destroyedRef = useRef(false);
  const subscriptions = useRef<Record<string, any>>({});
  const lastDeviceRef = useRef<Device | null>(null);
  const manualDisconnectRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);

  const [view, setView] = useState<"list" | "video">("list");
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [connectedName, setConnectedName] = useState<string | null>(null);
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [telemetry, setTelemetry] = useState({
    speed: null as number | null,
    cadence: null as number | null,
    heartRate: null as number | null,
    power: null as number | null,
    rmssd: null as number | null,
  });
  const rrHistoryRef = useRef<number[]>([]);
  const [activeServices, setActiveServices] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const resetTelemetry = () =>
    setTelemetry({ speed: null, cadence: null, heartRate: null, power: null, rmssd: null });

  const appendLog = (message: string) => {
    setLogs((prev) => {
      const next = [`${new Date().toLocaleTimeString()}: ${message}`, ...prev];
      return next.slice(0, 60);
    });
  };

  const cleanupSubscriptions = () => {
    Object.values(subscriptions.current).forEach((sub) => sub?.remove());
    subscriptions.current = {};
  };

  const safeBleCall = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    if (destroyedRef.current) return null;
    try {
      return await fn();
    } catch (e: any) {
      if (e?.message?.includes("BleManager was destroyed")) return null;
      throw e;
    }
  };

  useEffect(() => {
    manager.current = new BleManager();

    return () => {
      destroyedRef.current = true;
      cleanupSubscriptions();
      reconnectTimeoutRef.current && clearTimeout(reconnectTimeoutRef.current);
      scanTimeoutRef.current && clearTimeout(scanTimeoutRef.current);
      try {
        manager.current?.destroy();
      } catch {
        // may already be destroyed
      }
    };
  }, []);

  useEffect(() => {
    if (connectedId) {
      setView("video");
      return;
    }

    if (view === "video") {
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

  const resetDevices = () => setDevices([]);

  const startScan = async () => {
    if (scanning || destroyedRef.current) return;

    const ok = await requestBlePermissions();
    if (!ok) {
      Alert.alert(
        "Permissions missing",
        "Bluetooth permissions are required to scan for devices.",
      );
      return;
    }

    resetDevices();
    setScanning(true);

    // Scan only for common fitness BLE services (running/cycling/heart rate/power)
    const serviceUUIDs = [
      "00001814-0000-1000-8000-00805f9b34fb", // Running Speed and Cadence
      "00001816-0000-1000-8000-00805f9b34fb", // Cycling Speed and Cadence
      "00001818-0000-1000-8000-00805f9b34fb", // Cycling Power
      "0000180d-0000-1000-8000-00805f9b34fb", // Heart Rate
    ];

    manager.current?.startDeviceScan(serviceUUIDs, null, (error, device) => {
      if (destroyedRef.current) return;

      if (error) {
        setScanning(false);
        Alert.alert("Scan error", error.message);
        return;
      }

      if (!device?.id) return;

      setDevices((prev) => {
        const exists = prev.some((d) => d.id === device.id);
        if (exists) return prev;
        return [...prev, device];
      });
    });

    scanTimeoutRef.current = setTimeout(() => {
      if (destroyedRef.current) return;
      manager.current?.stopDeviceScan();
      setScanning(false);
    }, 10000);
  };

  const subscribeToTelemetry = (deviceId: string) => {
    cleanupSubscriptions();

    const subscribe = (
      service: string,
      characteristic: string,
      handler: (base64: string) => void,
      serviceLabel: string,
    ) => {
      const key = `${service}:${characteristic}`;
      subscriptions.current[key] = manager.current?.monitorCharacteristicForDevice(
        deviceId,
        service,
        characteristic,
        (error, characteristic) => {
          if (error || !characteristic?.value) return;
          setActiveServices((prev) =>
            prev.includes(serviceLabel) ? prev : [...prev, serviceLabel],
          );
          handler(characteristic.value);
        },
      );
    };

    // Running Speed and Cadence
    subscribe(
      "00001814-0000-1000-8000-00805f9b34fb",
      "00002a53-0000-1000-8000-00805f9b34fb",
      (value) => {
        const { speed, cadence } = parseRSCMeasurement(value);
        setTelemetry((prev) => ({ ...prev, speed, cadence }));
        appendLog(`RSC ⇒ speed=${speed.toFixed(2)} m/s, cadence=${cadence} rpm`);
      },
      "Running Speed/Cadence",
    );

    // Cycling Speed and Cadence
    subscribe(
      "00001816-0000-1000-8000-00805f9b34fb",
      "00002a5b-0000-1000-8000-00805f9b34fb",
      (value) => {
        const { cadence } = parseCSCMeasurement(value);
        setTelemetry((prev) => ({ ...prev, cadence: cadence ?? prev.cadence }));
        if (cadence != null) appendLog(`CSC ⇒ cadence=${cadence} rpm`);
      },
      "Cycling Speed/Cadence",
    );

    // Heart Rate (includes optional RR-intervals for HRV)
    subscribe(
      "0000180d-0000-1000-8000-00805f9b34fb",
      "00002a37-0000-1000-8000-00805f9b34fb",
      (value) => {
        const { heartRate, rrIntervals } = parseHeartRateMeasurement(value);
        setTelemetry((prev) => ({ ...prev, heartRate }));

        if (rrIntervals?.length) {
          const next = [...rrIntervals, ...rrHistoryRef.current].slice(0, 64);
          rrHistoryRef.current = next;
          const rmssd = computeRmssd(next);
          setTelemetry((t) => ({ ...t, rmssd }));
          appendLog(
            `HRV ⇒ rr=${rrIntervals.map((r) => r.toFixed(0)).join(",")} ms`,
          );
        } else {
          appendLog(`HR ⇒ ${heartRate} bpm`);
        }
      },
      "Heart Rate",
    );

    // Cycling Power
    subscribe(
      "00001818-0000-1000-8000-00805f9b34fb",
      "00002a63-0000-1000-8000-00805f9b34fb",
      (value) => {
        const { power } = parseCyclingPowerMeasurement(value);
        setTelemetry((prev) => ({ ...prev, power }));
        appendLog(`Power ⇒ ${power} W`);
      },
      "Cycling Power",
    );
  };

  const disconnect = async (manual = true) => {
    if (!connectedId) return;

    if (manual) {
      manualDisconnectRef.current = true;
      reconnectAttempts.current = 0;
      reconnectTimeoutRef.current && clearTimeout(reconnectTimeoutRef.current);
    }

    cleanupSubscriptions();

    try {
      if (manager.current) {
        await safeBleCall(() =>
          manager.current!.cancelDeviceConnection(connectedId),
        );
      }
      appendLog(`Disconnected from ${connectedName ?? connectedId}`);
    } catch {
      // ignore
    }

    setConnectedId(null);
    setConnectedName(null);
    resetTelemetry();
    setActiveServices([]);
  };

  const scheduleReconnect = () => {
    if (destroyedRef.current || !autoReconnect || manualDisconnectRef.current) return;
    if (!lastDeviceRef.current) return;

    if (reconnectAttempts.current >= 3) {
      appendLog("Auto-reconnect aborted after 3 attempts.");
      return;
    }

    reconnectAttempts.current += 1;
    const attempt = reconnectAttempts.current;

    appendLog(`Auto-reconnect attempt ${attempt}...`);
    reconnectTimeoutRef.current = setTimeout(() => {
      if (lastDeviceRef.current) connect(lastDeviceRef.current);
    }, 3000);
  };

  const connect = async (device: Device) => {
    if (connectingId) return;

    manualDisconnectRef.current = false;
    reconnectAttempts.current = 0;
    lastDeviceRef.current = device;

    setConnectingId(device.id);

    try {
      const connected = await safeBleCall(async () =>
        (await manager.current?.connectToDevice(device.id))
          ?.discoverAllServicesAndCharacteristics(),
      );

      setConnectedId(connected?.id ?? null);
      setConnectedName(device.name ?? device.id);
      resetTelemetry();
      setActiveServices([]);
      appendLog(`Connected to ${device.name ?? device.id}`);

      if (connected?.id) {
        subscribeToTelemetry(connected.id);

        // Listen for unexpected disconnects so we can auto reconnect.
        subscriptions.current[`disconnect:${connected.id}`] =
          manager.current?.onDeviceDisconnected(connected.id, () => {
            appendLog(`Unexpected disconnect from ${device.name ?? device.id}`);
            setConnectedId(null);
            scheduleReconnect();
          });
      }
    } catch (e: any) {
      appendLog(`Connection failed: ${e?.message ?? "Unknown error"}`);
      Alert.alert("Connection failed", e?.message ?? "Unknown error");
      scheduleReconnect();
    } finally {
      setConnectingId(null);
    }
  };

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
              HR {telemetry.heartRate != null ? `${telemetry.heartRate} bpm` : "–"} • HRV {telemetry.rmssd != null ? `${telemetry.rmssd.toFixed(0)} ms` : "–"}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🩺 BLE Scanner</Text>
      <Text style={styles.subtitle}>
        Scanning for cycling/running speed & cadence sensors, power meters, and heart rate monitors (10s scan).
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
