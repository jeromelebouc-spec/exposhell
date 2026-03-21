import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, PermissionsAndroid, Platform } from "react-native";
import { BleManager, Device } from "react-native-ble-plx";

export type TelemetryData = {
  speed: number | null;
  cadence: number | null;
  heartRate: number | null;
  power: number | null;
  rmssd: number | null;
  incline: number | null;
  distance: number | null;
};

export type MetricKey = keyof TelemetryData;

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

function parseCSCMeasurement(
  base64: string,
  prev?: {
    wheelRev: number;
    wheelTime: number;
    crankRev: number;
    crankTime: number;
  }
) {
  const bytes = base64ToBytes(base64);
  const flags = bytes[0];
  let offset = 1;

  let speed: number | null = null;
  let cadence: number | null = null;

  let currentWheelRev = 0;
  let currentWheelTime = 0;
  let currentCrankRev = 0;
  let currentCrankTime = 0;

  const hasWheel = (flags & 0x01) !== 0;
  const hasCrank = (flags & 0x02) !== 0;

  if (hasWheel) {
    currentWheelRev =
      (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>> 0;
    currentWheelTime = (bytes[offset + 4] | (bytes[offset + 5] << 8)) >>> 0;
    offset += 6;

    if (prev && prev.wheelTime !== currentWheelTime) {
      const revDiff = (currentWheelRev - prev.wheelRev) >>> 0;
      let timeDiff = (currentWheelTime - prev.wheelTime) & 0xffff;
      if (timeDiff < 0) timeDiff += 0x10000;

      if (timeDiff > 0 && revDiff >= 0) {
        const timeSec = timeDiff / 1024;
        const circumference = 2.096; // 700x23c default
        speed = (revDiff * circumference) / timeSec;
      }
    }
  }

  if (hasCrank) {
    currentCrankRev = (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
    currentCrankTime = (bytes[offset + 2] | (bytes[offset + 3] << 8)) >>> 0;
    offset += 4;

    if (prev && prev.crankTime !== currentCrankTime) {
      const revDiff = (currentCrankRev - prev.crankRev) & 0xffff;
      let timeDiff = (currentCrankTime - prev.crankTime) & 0xffff;
      if (timeDiff < 0) timeDiff += 0x10000;

      if (timeDiff > 0 && revDiff >= 0) {
        const timeSec = timeDiff / 1024;
        cadence = (revDiff / timeSec) * 60;
      }
    }
  }

  return {
    speed,
    cadence,
    data: {
      wheelRev: currentWheelRev,
      wheelTime: currentWheelTime,
      crankRev: currentCrankRev,
      crankTime: currentCrankTime,
    },
  };
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

// FTMS treadmill data (0x2ACD). Flags indicate which fields are present;
// see Bluetooth spec. In practice most sensors send speed (uint16 km/h×100),
// incline (int16 1/100%) and total distance (uint24 0.1m).
function parseFTMSMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  const flags = bytes[0];
  let offset = 1;

  const rawSpeed = bytes[offset] | (bytes[offset + 1] << 8);
  const speed = (rawSpeed / 100) / 3.6; // km/h → m/s
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
        (bytes[offset + 2] << 16)) / 10; // 0.1m units
    offset += 3;
  }

  return { speed, incline, distance };
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
  const cscDataRef = useRef<Record<string, any>>({});

  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectedDevices, setConnectedDevices] = useState<Device[]>([]);
  const [autoReconnect, setAutoReconnect] = useState(true);

  const [telemetryMap, setTelemetryMap] = useState<Record<string, TelemetryData>>({});
  const [preferredSource, setPreferredSource] = useState<Record<MetricKey, string | null>>({
    speed: null,
    cadence: null,
    heartRate: null,
    power: null,
    rmssd: null,
    incline: null,
    distance: null,
  });

  const [activeServicesMap, setActiveServicesMap] = useState<Record<string, string[]>>({});
  const [logs, setLogs] = useState<string[]>([]);

  const telemetry = useMemo(() => {
    const result: TelemetryData = {
      speed: null,
      cadence: null,
      heartRate: null,
      power: null,
      rmssd: null,
      incline: null,
      distance: null,
    };
    (Object.keys(preferredSource) as MetricKey[]).forEach((key) => {
      const sourceId = preferredSource[key];
      if (sourceId && telemetryMap[sourceId]) {
        result[key] = telemetryMap[sourceId][key];
      }
    });
    return result;
  }, [telemetryMap, preferredSource]);

  const updateDeviceTelemetry = useCallback((deviceId: string, delta: Partial<TelemetryData>) => {
    setTelemetryMap((prev) => {
      const current = prev[deviceId] || {
        speed: null,
        cadence: null,
        heartRate: null,
        power: null,
        rmssd: null,
        incline: null,
        distance: null,
      };
      return {
        ...prev,
        [deviceId]: { ...current, ...delta },
      };
    });

    // Auto-map empty sources
    setPreferredSource((prev) => {
      const next = { ...prev };
      let changed = false;
      (Object.keys(delta) as MetricKey[]).forEach((key) => {
        if (!next[key]) {
          next[key] = deviceId;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const setPreferredSourceHelper = useCallback((metric: MetricKey, deviceId: string | null) => {
    setPreferredSource((prev) => ({
      ...prev,
      [metric]: deviceId,
    }));
  }, []);

  const resetTelemetry = useCallback((deviceId?: string) => {
    if (deviceId) {
      setTelemetryMap((prev) => {
        const next = { ...prev };
        delete next[deviceId];
        return next;
      });
    } else {
      setTelemetryMap({});
    }
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
      if (destroyedRef.current || !manager.current) return null;
      try {
        return await fn();
      } catch (e: any) {
        const msg = e?.message?.toLowerCase() || "";
        if (msg.includes("destroyed") || msg.includes("deallocated")) {
          return null;
        }
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
        manager.current?.stopDeviceScan();
      } catch {
        // ignore
      }
      try {
        manager.current?.destroy();
      } catch {
        // ignore
      }
      manager.current = null;
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
      // FTMS treadmill service
      "00001826-0000-1000-8000-00805f9b34fb",
    ];

    manager.current?.startDeviceScan(serviceUUIDs, null, (error, device) => {
      if (destroyedRef.current) return;

      if (error) {
        setScanning(false);
        if (error.message.toLowerCase().includes("destroyed") || destroyedRef.current) {
          return;
        }
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
      if (destroyedRef.current || !manager.current) return;
      try {
        manager.current.stopDeviceScan();
      } catch {
        // ignore
      }
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
    async (deviceId: string) => {
      cleanupSubscriptions(); // Note: in multi-device this might need more refinement, but for now we follow old logic

      try {
        if (manager.current) {
          await safeBleCall(() =>
            manager.current!.cancelDeviceConnection(deviceId),
          );
        }
        const dev = connectedDevices.find(d => d.id === deviceId);
        appendLog(`Disconnected from ${dev?.name ?? deviceId}`);
      } catch {
        // ignore
      }

      setConnectedDevices((prev) => prev.filter((d) => d.id !== deviceId));
      resetTelemetry(deviceId);
      setActiveServicesMap((prev) => {
        const next = { ...prev };
        delete next[deviceId];
        return next;
      });
      
      // Cleanup sources if they pointed to this device
      setPreferredSource(prev => {
        const next = {...prev};
        let changed = false;
        (Object.keys(next) as MetricKey[]).forEach(k => {
          if (next[k] === deviceId) {
            next[k] = null;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    },
    [connectedDevices, cleanupSubscriptions, resetTelemetry, safeBleCall, appendLog],
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
        const key = `${deviceId}:${service}:${characteristic}`;
        subscriptions.current[key] = manager.current?.monitorCharacteristicForDevice(
          deviceId,
          service,
          characteristic,
          (error, characteristic) => {
            if (error || !characteristic?.value) return;
            setActiveServicesMap((prev) => {
              const current = prev[deviceId] || [];
              if (current.includes(serviceLabel)) return prev;
              return { ...prev, [deviceId]: [...current, serviceLabel] };
            });
            handler(characteristic.value);
          },
        );
      };

      subscribe(
        "00001814-0000-1000-8000-00805f9b34fb",
        "00002a53-0000-1000-8000-00805f9b34fb",
        (value) => {
          const { speed, cadence } = parseRSCMeasurement(value);
          updateDeviceTelemetry(deviceId, { speed, cadence });
          appendLog(`[${deviceId}] RSC ⇒ speed=${speed.toFixed(2)} m/s, cadence=${cadence} rpm`);
        },
        "Running Speed/Cadence",
      );

      subscribe(
        "00001816-0000-1000-8000-00805f9b34fb",
        "00002a5b-0000-1000-8000-00805f9b34fb",
        (value) => {
          const prev = cscDataRef.current[deviceId];
          const { speed, cadence, data } = parseCSCMeasurement(value, prev);
          cscDataRef.current[deviceId] = data;

          const delta: Partial<TelemetryData> = {};
          if (speed !== null) delta.speed = speed;
          if (cadence !== null) delta.cadence = cadence;

          if (Object.keys(delta).length > 0) {
            updateDeviceTelemetry(deviceId, delta);
            appendLog(
              `[${deviceId}] CSC ⇒ ` +
              (speed !== null ? `speed=${speed.toFixed(2)} m/s ` : "") +
              (cadence !== null ? `cadence=${cadence.toFixed(0)} rpm` : "")
            );
          }
        },
        "Cycling Speed/Cadence",
      );

      subscribe(
        "0000180d-0000-1000-8000-00805f9b34fb",
        "00002a37-0000-1000-8000-00805f9b34fb",
        (value) => {
          const { heartRate, rrIntervals } = parseHeartRateMeasurement(value);
          
          let rmssd: number | null = null;
          if (rrIntervals?.length) {
            const next = [...rrIntervals, ...rrHistoryRef.current].slice(0, 64);
            rrHistoryRef.current = next;
            rmssd = computeRmssd(next);
            appendLog(`[${deviceId}] HRV ⇒ rr=${rrIntervals.map((r) => r.toFixed(0)).join(",")} ms`);
          } else {
            appendLog(`[${deviceId}] HR ⇒ ${heartRate} bpm`);
          }
          updateDeviceTelemetry(deviceId, { heartRate, rmssd });
        },
        "Heart Rate",
      );

      subscribe(
        "00001818-0000-1000-8000-00805f9b34fb",
        "00002a63-0000-1000-8000-00805f9b34fb",
        (value) => {
          const { power } = parseCyclingPowerMeasurement(value);
          updateDeviceTelemetry(deviceId, { power });
          appendLog(`[${deviceId}] Power ⇒ ${power} W`);
        },
        "Cycling Power",
      );

      // FTMS treadmill data
      subscribe(
        "00001826-0000-1000-8000-00805f9b34fb",
        "00002acd-0000-1000-8000-00805f9b34fb",
        (value) => {
          const { speed, incline, distance } = parseFTMSMeasurement(value);
          updateDeviceTelemetry(deviceId, { speed, incline, distance });
          appendLog(
            `[${deviceId}] FTMS ⇒ speed=${speed.toFixed(2)} m/s` +
            (incline != null ? `, incline=${incline.toFixed(2)}%` : "") +
            (distance != null ? `, distance=${distance.toFixed(1)}m` : ""),
          );
        },
        "Treadmill",
      );
    },
    [appendLog, cleanupSubscriptions, updateDeviceTelemetry],
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

        setConnectedDevices((prev) => {
          if (prev.some(d => d.id === device.id)) return prev;
          return [...prev, device];
        });
        resetTelemetry(connected?.id);
        appendLog(`Connected to ${device.name ?? device.id}`);

        if (connected?.id) {
          subscribeToTelemetry(connected.id);

          subscriptions.current[`disconnect:${connected.id}`] =
            manager.current?.onDeviceDisconnected(connected.id, () => {
              appendLog(`Unexpected disconnect from ${device.name ?? device.id}`);
              setConnectedDevices((prev) => prev.filter(d => d.id !== device.id));
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
      connectedDevices,
      autoReconnect,
      telemetry,
      telemetryMap,
      preferredSource,
      activeServicesMap,
      logs,
      startScan,
      connect,
      disconnect,
      setAutoReconnect,
      setPreferredSource: setPreferredSourceHelper,
    }),
    [
      devices,
      scanning,
      connectingId,
      connectedDevices,
      autoReconnect,
      telemetry,
      telemetryMap,
      preferredSource,
      activeServicesMap,
      logs,
      startScan,
      connect,
      disconnect,
      setAutoReconnect,
      setPreferredSourceHelper,
    ],
  );

  return value;
}
