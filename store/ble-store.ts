import { create } from 'zustand';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';
import {
  TelemetryData,
  MetricKey,
  parseRSCMeasurement,
  parseCSCMeasurement,
  parseHeartRateMeasurement,
  parseCyclingPowerMeasurement,
  parseFTMSMeasurement,
  computeRmssd,
} from '../utils/ble-parsers';

export interface BleState {
  devices: Device[];
  scanning: boolean;
  connectingId: string | null;
  connectedDevices: Device[];
  autoReconnect: boolean;
  telemetryMap: Record<string, TelemetryData>;
  preferredSource: Partial<Record<MetricKey, string>>;
  activeServicesMap: Record<string, string[]>;
  logs: string[];
  telemetry: TelemetryData;

  startScan: () => Promise<void>;
  connect: (device: Device) => Promise<void>;
  disconnect: (deviceId: string) => Promise<void>;
  setAutoReconnect: (val: boolean | ((prev: boolean) => boolean)) => void;
  setPreferredSource: (metric: MetricKey, deviceId: string | null) => void;
  updateDeviceTelemetry: (deviceId: string, delta: Partial<TelemetryData>) => void;
  appendLog: (msg: string) => void;
  cleanupSubscriptions: () => void;
  resetTelemetry: (deviceId?: string) => void;
}

const emptyTelemetry: TelemetryData = {
  speed: null,
  cadence: null,
  heartRate: null,
  power: null,
  rmssd: null,
  incline: null,
  distance: null,
};

// --- Module-level private state (replaces useRef) ---
let manager: BleManager | null = null;
let destroyed = false;
const subscriptions: Record<string, any> = {};
let manualDisconnect = false;
const reconnectTimeoutRefs: Record<string, ReturnType<typeof setTimeout>> = {};
let scanTimeoutRef: ReturnType<typeof setTimeout> | null = null;
const reconnectAttempts: Record<string, number> = {};
const rrHistoryRefs: Record<string, number[]> = {};
const lastDevicesRef: Record<string, Device> = {};
const cscDataRef: Record<string, any> = {};

export function getBleManager() {
  return manager;
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

function computeTelemetry(
  telemetryMap: Record<string, TelemetryData>,
  preferredSource: Partial<Record<MetricKey, string>>,
  connectedDevices: Device[]
): TelemetryData {
  const result = { ...emptyTelemetry };
  const metrics = Object.keys(emptyTelemetry) as MetricKey[];

  metrics.forEach((key) => {
    const sourceId = preferredSource[key];
    if (sourceId && telemetryMap[sourceId] && telemetryMap[sourceId][key] !== null) {
      result[key] = telemetryMap[sourceId][key];
    } else {
      for (const dev of connectedDevices) {
        const val = telemetryMap[dev.id]?.[key];
        if (val !== null && val !== undefined) {
          result[key] = val;
          break;
        }
      }
    }
  });
  return result;
}

async function safeBleCall<T>(fn: () => Promise<T>): Promise<T | null> {
  if (destroyed || !manager) return null;
  try {
    return await fn();
  } catch (e: any) {
    const msg = e?.message?.toLowerCase() || "";
    if (msg.includes("destroyed") || msg.includes("deallocated")) {
      return null;
    }
    throw e;
  }
}

export const useBleStore = create<BleState>()((set, get) => ({
  devices: [],
  scanning: false,
  connectingId: null,
  connectedDevices: [],
  autoReconnect: true,
  telemetryMap: {},
  preferredSource: {},
  activeServicesMap: {},
  logs: [],
  telemetry: { ...emptyTelemetry },

  appendLog: (message: string) => {
    set((state) => {
      const next = [`${new Date().toLocaleTimeString()}: ${message}`, ...state.logs];
      return { logs: next.slice(0, 60) };
    });
  },

  resetTelemetry: (deviceId?: string) => {
    set((state) => {
      if (deviceId) {
        const nextMap = { ...state.telemetryMap };
        delete nextMap[deviceId];
        return {
          telemetryMap: nextMap,
          telemetry: computeTelemetry(nextMap, state.preferredSource, state.connectedDevices),
        };
      }
      return {
        telemetryMap: {},
        telemetry: { ...emptyTelemetry },
      };
    });
  },

  updateDeviceTelemetry: (deviceId: string, delta: Partial<TelemetryData>) => {
    set((state) => {
      const current = state.telemetryMap[deviceId] || { ...emptyTelemetry };
      const nextMap = {
        ...state.telemetryMap,
        [deviceId]: { ...current, ...delta },
      };

      const nextPref = { ...state.preferredSource };
      let changedPref = false;
      (Object.keys(delta) as MetricKey[]).forEach((key) => {
        if (!nextPref[key]) {
          nextPref[key] = deviceId;
          changedPref = true;
        }
      });

      return {
        telemetryMap: nextMap,
        ...(changedPref ? { preferredSource: nextPref } : {}),
        telemetry: computeTelemetry(nextMap, changedPref ? nextPref : state.preferredSource, state.connectedDevices),
      };
    });
  },

  setPreferredSource: (metric: MetricKey, deviceId: string | null) => {
    set((state) => {
      const nextPref = { ...state.preferredSource, [metric]: deviceId };
      return {
        preferredSource: nextPref,
        telemetry: computeTelemetry(state.telemetryMap, nextPref, state.connectedDevices),
      };
    });
  },

  setAutoReconnect: (val) => {
    set((state) => ({
      autoReconnect: typeof val === "function" ? val(state.autoReconnect) : val,
    }));
  },

  cleanupSubscriptions: () => {
    Object.values(subscriptions).forEach((sub) => sub?.remove());
    for (const key in subscriptions) delete subscriptions[key];
    Object.values(reconnectTimeoutRefs).forEach(clearTimeout);
    for (const key in reconnectTimeoutRefs) delete reconnectTimeoutRefs[key];
  },

  startScan: async () => {
    const state = get();
    if (state.scanning || destroyed) return;

    if (!manager) {
      manager = new BleManager();
    }

    const ok = await requestBlePermissions();
    if (!ok) {
      Alert.alert(
        "Permissions missing",
        "Bluetooth permissions are required to scan for devices.",
      );
      return;
    }

    set({ devices: [], scanning: true });

    const serviceUUIDs = [
      "00001814-0000-1000-8000-00805f9b34fb",
      "00001816-0000-1000-8000-00805f9b34fb",
      "00001818-0000-1000-8000-00805f9b34fb",
      "0000180d-0000-1000-8000-00805f9b34fb",
      "00001826-0000-1000-8000-00805f9b34fb",
    ];

    manager.startDeviceScan(serviceUUIDs, null, (error, device) => {
      if (destroyed) return;

      if (error) {
        set({ scanning: false });
        if (error.message.toLowerCase().includes("destroyed") || destroyed) {
          return;
        }
        Alert.alert("Scan error", error.message);
        return;
      }

      if (!device?.id) return;

      set((s) => {
        const exists = s.devices.some((d) => d.id === device.id);
        if (exists) return s;
        return { devices: [...s.devices, device] };
      });
    });

    scanTimeoutRef = setTimeout(() => {
      if (destroyed || !manager) return;
      try {
        manager.stopDeviceScan();
      } catch {
        // ignore
      }
      set({ scanning: false });
    }, 10000);
  },

  connect: async (device: Device) => {
    const state = get();
    if (state.connectingId) return;

    if (!manager) {
      manager = new BleManager();
    }

    manualDisconnect = false;
    reconnectAttempts[device.id] = 0;
    lastDevicesRef[device.id] = device;

    set({ connectingId: device.id });

    try {
      const connected = await safeBleCall(async () =>
        (await manager?.connectToDevice(device.id))?.discoverAllServicesAndCharacteristics()
      );

      set((s) => {
        const newConnected = s.connectedDevices.some((d) => d.id === device.id)
          ? s.connectedDevices
          : [...s.connectedDevices, device];
        
        return {
          connectedDevices: newConnected,
        };
      });

      get().resetTelemetry(connected?.id);
      get().appendLog(`Connected to ${device.name ?? device.id}`);

      if (connected?.id) {
        subscribeToTelemetry(connected.id, get);

        subscriptions[`disconnect:${connected.id}`] =
          manager.onDeviceDisconnected(connected.id, () => {
            get().appendLog(`Unexpected disconnect from ${device.name ?? device.id}`);
            
            set((s) => ({
              connectedDevices: s.connectedDevices.filter((d) => d.id !== device.id),
            }));
            
            scheduleReconnect(device, get);
          });
      }
    } catch (e: any) {
      get().appendLog(`Connection failed: ${e?.message ?? "Unknown error"}`);
      Alert.alert("Connection failed", e?.message ?? "Unknown error");
      scheduleReconnect(device, get);
    } finally {
      set({ connectingId: null });
    }
  },

  disconnect: async (deviceId: string) => {
    cleanupDeviceSubscriptions(deviceId);
    manualDisconnect = true;

    try {
      if (manager) {
        await safeBleCall(() => manager!.cancelDeviceConnection(deviceId));
      }
      const state = get();
      const dev = state.connectedDevices.find((d) => d.id === deviceId);
      state.appendLog(`Disconnected from ${dev?.name ?? deviceId}`);
    } catch {
      // ignore
    }

    set((state) => {
      const nextConnected = state.connectedDevices.filter((d) => d.id !== deviceId);
      const nextActive = { ...state.activeServicesMap };
      delete nextActive[deviceId];

      const nextPref = { ...state.preferredSource };
      let changedPref = false;
      (Object.keys(nextPref) as MetricKey[]).forEach((k) => {
        if (nextPref[k] === deviceId) {
          const fallback = nextConnected.find((d) => state.telemetryMap[d.id]?.[k] !== null);
          nextPref[k] = fallback?.id;
          changedPref = true;
        }
      });

      return {
        connectedDevices: nextConnected,
        activeServicesMap: nextActive,
        ...(changedPref ? { preferredSource: nextPref } : {}),
      };
    });
    
    get().resetTelemetry(deviceId);
  },
}));

function cleanupDeviceSubscriptions(deviceId: string) {
  Object.keys(subscriptions)
    .filter((key) => key.startsWith(`${deviceId}:`))
    .forEach((key) => {
      subscriptions[key]?.remove();
      delete subscriptions[key];
    });
}

function scheduleReconnect(device: Device, get: () => BleState) {
  if (destroyed || !get().autoReconnect || manualDisconnect) return;

  const attempts = reconnectAttempts[device.id] || 0;
  if (attempts >= 3) {
    get().appendLog(`[${device.name || device.id}] Auto-reconnect aborted after 3 attempts.`);
    return;
  }

  reconnectAttempts[device.id] = attempts + 1;

  get().appendLog(`[${device.name || device.id}] Auto-reconnect attempt ${attempts + 1}...`);
  reconnectTimeoutRefs[device.id] = setTimeout(() => {
    if (lastDevicesRef[device.id]) get().connect(lastDevicesRef[device.id]);
  }, 3000);
}

function subscribeToTelemetry(deviceId: string, get: () => BleState) {
  cleanupDeviceSubscriptions(deviceId);

  const subscribe = (
    service: string,
    characteristic: string,
    handler: (base64: string) => void,
    serviceLabel: string
  ) => {
    const key = `${deviceId}:${service}:${characteristic}`;
    subscriptions[key] = manager?.monitorCharacteristicForDevice(
      deviceId,
      service,
      characteristic,
      (error, char) => {
        if (error || !char?.value) return;
        
        const state = get();
        const currentServices = state.activeServicesMap[deviceId] || [];
        if (!currentServices.includes(serviceLabel)) {
          useBleStore.setState({
            activeServicesMap: {
              ...state.activeServicesMap,
              [deviceId]: [...currentServices, serviceLabel],
            },
          });
        }
        
        handler(char.value);
      }
    );
  };

  subscribe(
    "00001814-0000-1000-8000-00805f9b34fb",
    "00002a53-0000-1000-8000-00805f9b34fb",
    (value) => {
      const { speed, cadence } = parseRSCMeasurement(value);
      get().updateDeviceTelemetry(deviceId, { speed, cadence });
      get().appendLog(`[${deviceId}] RSC ⇒ speed=${speed.toFixed(2)} m/s, cadence=${cadence} rpm`);
    },
    "Running Speed/Cadence"
  );

  subscribe(
    "00001816-0000-1000-8000-00805f9b34fb",
    "00002a5b-0000-1000-8000-00805f9b34fb",
    (value) => {
      const prev = cscDataRef[deviceId];
      const { speed, cadence, data } = parseCSCMeasurement(value, prev);
      cscDataRef[deviceId] = data;

      const delta: Partial<TelemetryData> = {};
      if (speed !== null) delta.speed = speed;
      if (cadence !== null) delta.cadence = cadence;

      if (Object.keys(delta).length > 0) {
        get().updateDeviceTelemetry(deviceId, delta);
        get().appendLog(
          `[${deviceId}] CSC ⇒ ` +
            (speed !== null ? `speed=${speed.toFixed(2)} m/s ` : "") +
            (cadence !== null ? `cadence=${cadence?.toFixed(0)} rpm` : "")
        );
      }
    },
    "Cycling Speed/Cadence"
  );

  subscribe(
    "0000180d-0000-1000-8000-00805f9b34fb",
    "00002a37-0000-1000-8000-00805f9b34fb",
    (value) => {
      const { heartRate, rrIntervals } = parseHeartRateMeasurement(value);

      let rmssd: number | null = null;
      if (rrIntervals?.length) {
        const hist = rrHistoryRefs[deviceId] || [];
        const next = [...rrIntervals, ...hist].slice(0, 64);
        rrHistoryRefs[deviceId] = next;
        rmssd = computeRmssd(next);
        get().appendLog(`[${deviceId}] HRV ⇒ rr=${rrIntervals.map((r) => r.toFixed(0)).join(",")} ms`);
      } else {
        get().appendLog(`[${deviceId}] HR ⇒ ${heartRate} bpm`);
      }
      get().updateDeviceTelemetry(deviceId, { heartRate, rmssd });
    },
    "Heart Rate"
  );

  subscribe(
    "00001818-0000-1000-8000-00805f9b34fb",
    "00002a63-0000-1000-8000-00805f9b34fb",
    (value) => {
      const { power } = parseCyclingPowerMeasurement(value);
      get().updateDeviceTelemetry(deviceId, { power });
      get().appendLog(`[${deviceId}] Power ⇒ ${power} W`);
    },
    "Cycling Power"
  );

  subscribe(
    "00001826-0000-1000-8000-00805f9b34fb",
    "00002acd-0000-1000-8000-00805f9b34fb",
    (value) => {
      const { speed, incline, distance } = parseFTMSMeasurement(value);
      get().updateDeviceTelemetry(deviceId, { speed, incline, distance });
      get().appendLog(
        `[${deviceId}] FTMS ⇒ speed=${speed?.toFixed(2)} m/s` +
          (incline != null ? `, incline=${incline.toFixed(2)}%` : "") +
          (distance != null ? `, distance=${distance.toFixed(1)}m` : "")
      );
    },
    "Treadmill"
  );
}
