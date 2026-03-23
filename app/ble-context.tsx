import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, PermissionsAndroid, Platform } from "react-native";
import { BleManager, Device } from "react-native-ble-plx";

const BleContext = createContext<ReturnType<typeof useBleInternal> | null>(null);

export function BleProvider({ children }: { children: React.ReactNode }) {
  const value = useBleInternal();
  return <BleContext.Provider value={value}>{children}</BleContext.Provider>;
}

export function useBle() {
  const ctx = useContext(BleContext);
  if (!ctx) throw new Error("useBle must be used within BleProvider");
  return ctx;
}

function base64ToBytes(base64: string) {
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
  const speed = (bytes[1] | (bytes[2] << 8)) / 256;
  const cadence = bytes[3];
  return { speed, cadence };
}

function parseCSCMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  const flags = bytes[0];
  let cadence: number | null = null;
  let offset = 1;
  const hasWheel = (flags & 0x01) !== 0;
  const hasCrank = (flags & 0x02) !== 0;
  if (hasWheel) {
    offset += 6;
  }
  if (hasCrank) {
    cadence = bytes[offset] | (bytes[offset + 1] << 8);
  }
  return { cadence };
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

  return { heartRate, rrIntervals };
}

function parseCyclingPowerMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  const power = (bytes[2] | (bytes[3] << 8));
  return { power };
}

function parseFTMSMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  const flags = bytes[0];
  let offset = 1;

  const rawSpeed = bytes[offset] | (bytes[offset + 1] << 8);
  const speed = (rawSpeed / 100) / 3.6;
  offset += 2;

  let incline: number | null = null;
  if (flags & 0x02) {
    const rawIncline = bytes[offset] | (bytes[offset + 1] << 8);
    incline = rawIncline / 100;
    offset += 2;
  }

  let distance: number | null = null;
  if (flags & 0x04) {
    distance =
      (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16)) / 10;
    offset += 3;
  }

  return { speed, incline, distance };
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

function useBleInternal() {
  const manager = useRef<BleManager | null>(null);
  const destroyedRef = useRef(false);
  const subscriptions = useRef<Record<string, any>>({});
  const lastDeviceRef = useRef<Device | null>(null);
  const manualDisconnectRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const rrHistoryRef = useRef<number[]>([]);

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
    incline: null as number | null,
    distance: null as number | null,
  });
  const [activeServices, setActiveServices] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const resetTelemetry = useCallback(() => {
    setTelemetry({
      speed: null,
      cadence: null,
      heartRate: null,
      power: null,
      rmssd: null,
      incline: null,
      distance: null,
    });
  }, []);

  const appendLog = useCallback((message: string) => {
    setLogs((prev) => {
      const next = [`${new Date().toLocaleTimeString()}: ${message}`, ...prev];
      return next.slice(0, 60);
    });
  }, []);

  const cleanupSubscriptions = useCallback(() => {
    Object.values(subscriptions.current).forEach((sub) => sub?.remove());
    subscriptions.current = {};
  }, []);

  const safeBleCall = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      if (destroyedRef.current) return null;
      try {
        return await fn();
      } catch (e: any) {
        if (e?.message?.includes("BleManager was destroyed")) return null;
        throw e;
      }
    },
    [],
  );

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
  }, [cleanupSubscriptions]);

  const startScan = useCallback(async () => {
    if (scanning || destroyedRef.current) return;

    const ok = await requestBlePermissions();
    if (!ok) {
      Alert.alert(
        "Permissions missing",
        "Bluetooth permissions are required to scan for devices.",
      );
      return;
    }

    setDevices([]);
    setScanning(true);

    const serviceUUIDs = [
      "00001814-0000-1000-8000-00805f9b34fb",
      "00001816-0000-1000-8000-00805f9b34fb",
      "00001818-0000-1000-8000-00805f9b34fb",
      "0000180d-0000-1000-8000-00805f9b34fb",
      "00001826-0000-1000-8000-00805f9b34fb",
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
  }, [scanning]);

  const connectRef = useRef<((device: Device) => Promise<void>) | null>(null);

  const scheduleReconnect = useCallback(() => {
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
      if (lastDeviceRef.current) connectRef.current?.(lastDeviceRef.current);
    }, 3000);
  }, [autoReconnect, appendLog]);

  const disconnect = useCallback(
    async (manual = true) => {
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
    },
    [connectedId, connectedName, cleanupSubscriptions, resetTelemetry, safeBleCall, appendLog],
  );

  const subscribeToTelemetry = useCallback(
    (deviceId: string) => {
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

      subscribe(
        "00001826-0000-1000-8000-00805f9b34fb",
        "00002acd-0000-1000-8000-00805f9b34fb",
        (value) => {
          const { speed, incline, distance } = parseFTMSMeasurement(value);
          setTelemetry((prev) => ({
            ...prev,
            speed,
            incline: incline ?? prev.incline,
            distance: distance ?? prev.distance,
          }));
          appendLog(
            `FTMS ⇒ speed=${speed.toFixed(2)} m/s` +
              (incline != null ? `, incline=${incline.toFixed(2)}%` : "") +
              (distance != null ? `, distance=${distance.toFixed(1)}m` : ""),
          );
        },
        "Treadmill",
      );
    },
    [appendLog, cleanupSubscriptions],
  );

  const connect = useCallback(
    async (device: Device) => {
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
    },
    [connectingId, resetTelemetry, scheduleReconnect, safeBleCall, subscribeToTelemetry, appendLog],
  );

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const value = useMemo(
    () => ({
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
    }),
    [
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
    ],
  );

  return value;
}
