import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Device, BleManager } from "react-native-ble-plx";
import { getBleManager, requestBlePermissions } from "../store/ble-store";
import { getServiceNameFromUUID, getCompanyName } from "../utils/ble-uuids";
import { base64ToBytes } from "../utils/ble-parsers";

export default function DebugScreen() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const scanTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startScan = async () => {
    const manager = getBleManager();
    if (!manager || scanning) return;

    const hasPermissions = await requestBlePermissions();
    if (!hasPermissions) {
      console.warn("Missing BLE Permissions");
      return;
    }

    setDevices([]);
    setScanning(true);

    // Scan for ALL devices using null for UUIDs
    manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      if (error) {
        console.warn("Debug Scan Error:", error);
        return;
      }
      if (device) {
        setDevices((prev) => {
          const idx = prev.findIndex((d) => d.id === device.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = device;
            return next;
          }
          return [...prev, device];
        });
      }
    });

    scanTimeout.current = setTimeout(() => {
      manager.stopDeviceScan();
      setScanning(false);
    }, 15000);
  };

  const stopScan = () => {
    const manager = getBleManager();
    if (manager) manager.stopDeviceScan();
    if (scanTimeout.current) clearTimeout(scanTimeout.current);
    setScanning(false);
  };

  useEffect(() => {
    return () => {
      stopScan();
    };
  }, []);

  const renderItem = ({ item }: { item: Device }) => {
    let companyName = null;
    let extraData = null;

    if (item.manufacturerData) {
      try {
        const bytes = base64ToBytes(item.manufacturerData);
        // Company ID is the first two bytes of manufacturer data (little-endian)
        if (bytes.length >= 2) {
          const companyId = bytes[0] | (bytes[1] << 8);
          companyName = getCompanyName(companyId);

          // Deep-dive: Apple Specific parsing
          if (companyId === 0x004c && bytes.length >= 3) {
            const type = bytes[2];
            switch (type) {
              case 0x02: extraData = "iBeacon"; break;
              case 0x07: extraData = "AirPods / Proximity Pairing"; break;
              case 0x09: extraData = "AirDrop / OS X Info"; break;
              case 0x10: extraData = "Nearby Action (AirPods / Apple TV)"; break;
              case 0x12: extraData = "Find My Network (AirTag / Tracker)"; break;
              case 0x16: extraData = "Nearby Info"; break;
              default: extraData = `Apple Type 0x${type.toString(16).padStart(2, "0")}`;
            }
          }
        }
      } catch (e) {
        console.warn("Failed to parse manufacturer data", e);
      }
    }

    return (
      <View style={styles.deviceCard}>
        <View style={styles.headerRow}>
          <Text style={styles.deviceName}>{item.name ?? "Unknown Device"}</Text>
          <Text style={[styles.rssi, (item.rssi ?? -100) > -60 ? styles.rssiGood : styles.rssiBad]}>
            {item.rssi != null ? `${item.rssi} dBm` : "N/A"}
          </Text>
        </View>
        <Text style={styles.deviceId}>{item.id}</Text>
        
        {/* Manufacturer Data */}
        {companyName && (
          <View style={styles.manufacturerContainer}>
            <Text style={styles.manufacturerLabel}>Manufacturer:</Text>
            <View>
              <Text style={styles.manufacturerValue}>{companyName}</Text>
              {extraData && <Text style={styles.extraDataText}>↳ {extraData}</Text>}
            </View>
          </View>
        )}

        <View style={styles.uuidContainer}>
          {item.serviceUUIDs && item.serviceUUIDs.length > 0 ? (
            item.serviceUUIDs.map((uuid) => (
              <Text key={uuid} style={styles.uuidText}>
                • {getServiceNameFromUUID(uuid)}
              </Text>
            ))
          ) : (
            <Text style={styles.noUuidText}>No advertised service UUIDs</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.controls}>
        <Text style={styles.title}>Wide BLE Debug Scan</Text>
        <Text style={styles.subtitle}>
          Finds ALL nearby devices (not just fitness). Scan auto-stops after 15s.
        </Text>
        <TouchableOpacity
          style={[styles.button, scanning ? styles.buttonStop : styles.buttonStart]}
          onPress={scanning ? stopScan : startScan}
        >
          <Text style={styles.buttonText}>
            {scanning ? "Stop Scan" : "Start Wide Scan"}
          </Text>
        </TouchableOpacity>
        <Text style={styles.status}>
          {scanning ? `Scanning... Found ${devices.length} devices` : `Found ${devices.length} devices`}
        </Text>
      </View>

      <FlatList
        data={devices.sort((a, b) => (b.rssi ?? -100) - (a.rssi ?? -100))}
        keyExtractor={(d) => d.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  controls: {
    padding: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
    marginBottom: 16,
  },
  button: {
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonStart: {
    backgroundColor: "#007AFF",
  },
  buttonStop: {
    backgroundColor: "#ff3b30",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  status: {
    marginTop: 8,
    fontSize: 14,
    color: "#333",
    textAlign: "center",
  },
  list: {
    padding: 16,
  },
  deviceCard: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  deviceName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
  },
  rssi: {
    fontSize: 14,
    fontWeight: "700",
  },
  rssiGood: {
    color: "#34c759",
  },
  rssiBad: {
    color: "#ff3b30",
  },
  deviceId: {
    fontSize: 12,
    color: "#8e8e93",
    marginTop: 4,
    marginBottom: 8,
  },
  uuidContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#eee",
  },
  uuidText: {
    fontSize: 12,
    color: "#444",
    marginBottom: 2,
  },
  noUuidText: {
    fontSize: 12,
    color: "#999",
    fontStyle: "italic",
  },
  manufacturerContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#eee",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  manufacturerLabel: {
    fontSize: 12,
    color: "#8e8e93",
    fontWeight: "600",
  },
  manufacturerValue: {
    fontSize: 13,
    color: "#007AFF",
    fontWeight: "600",
  },
  extraDataText: {
    fontSize: 12,
    color: "#ff9500", // Apple-orange-ish highlight
    fontWeight: "600",
    marginTop: 2,
  },
});
