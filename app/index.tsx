import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BleManager, Device } from "react-native-ble-plx";

async function hasAndroidBlePermissions() {
  if (Platform.OS !== "android") return true;

  // Android 12+ requires specific BLE permissions.
  const scan = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
  );
  const connect = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  );

  return scan && connect;
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
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectedId, setConnectedId] = useState<string | null>(null);

  useEffect(() => {
    manager.current = new BleManager();

    return () => {
      manager.current?.destroy();
    };
  }, []);

  const resetDevices = () => setDevices([]);

  const startScan = async () => {
    if (scanning) return;

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

    manager.current?.startDeviceScan(null, null, (error, device) => {
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

    setTimeout(() => {
      manager.current?.stopDeviceScan();
      setScanning(false);
    }, 10000);
  };

  const connect = async (device: Device) => {
    if (connectingId) return;

    setConnectingId(device.id);

    try {
      const connected = await manager.current
        ?.connectToDevice(device.id)
        .then((d) => d.discoverAllServicesAndCharacteristics());

      setConnectedId(connected?.id ?? null);
      Alert.alert("Connected", `Connected to ${device.name ?? device.id}`);
    } catch (e: any) {
      Alert.alert("Connection failed", e?.message ?? "Unknown error");
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🩺 BLE Scanner</Text>
      <Text style={styles.subtitle}>
        Tap a device to connect. (Runs for 10 seconds per scan.)
      </Text>

      <TouchableOpacity style={styles.scanButton} onPress={startScan}>
        <Text style={styles.scanButtonText}>{scanButtonLabel}</Text>
      </TouchableOpacity>

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
});
