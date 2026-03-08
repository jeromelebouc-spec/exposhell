# `ble-peripheral` Local Expo Module

A local Expo module that turns your Android device into a BLE GATT peripheral broadcasting the **Running Speed and Cadence Service (RSCS, UUID `0x1814`)**, consumable by Garmin watches and any other RSCS-compatible BLE central.

---

## Installation & Setup

This is a local module — no npm install needed. It lives in `modules/ble-peripheral/` and is automatically linked by Expo's autolinking.

Requires a **dev build** (not Expo Go):

    npx expo run:android

---

## Required Permissions

Declared in `app.json`:

| Permission | Purpose |
|---|---|
| `BLUETOOTH` | General BLE access (API < 31) |
| `BLUETOOTH_ADMIN` | Enable/disable adapter (API < 31) |
| `BLUETOOTH_ADVERTISE` | BLE advertising (API 31+) |
| `BLUETOOTH_CONNECT` | GATT server connections (API 31+) |
| `BLUETOOTH_SCAN` | Discover central devices (API 31+) |

---

## API Reference

### `startGattServer(): Promise<void>`

Initializes the GATT server and registers the RSC service with all mandatory characteristics. Must be called **before** `startAdvertising()`.

    await startGattServer();

**Registers these characteristics:**

| Characteristic | UUID | Properties | Value |
|---|---|---|---|
| RSC Measurement | `0x2A53` | Notify | Updated via `notifyRSC()` |
| RSC Feature | `0x2A54` | Read | `0x0003` (speed + cadence) |
| Sensor Location | `0x2A5D` | Read | `0x06` (foot) |

---

### `startAdvertising(): Promise<void>`

Starts BLE advertising so Garmin and other centrals can discover the device. Advertises the RSC service UUID and the device name.

    await startAdvertising();

**Advertising parameters:**
- Mode: `LOW_LATENCY` (fastest discovery)
- Connectable: `true`
- Timeout: none (advertises indefinitely)

---

### `notifyRSC(speedMps: number, cadenceSpm: number | null): Promise<void>`

Pushes a new RSC Measurement notification to all subscribed centrals. Only devices that have enabled notifications via the CCCD descriptor will receive it.

    await notifyRSC(2.78, 160);  // 2.78 m/s ≈ 10 km/h, 160 steps/min
    await notifyRSC(3.0, null);  // speed only, no cadence

**Parameters:**

| Parameter | Type | Unit | Description |
|---|---|---|---|
| `speedMps` | `number` | m/s | Instantaneous speed |
| `cadenceSpm` | `number \| null` | steps/min | Cadence, or `null` if unavailable |

**RSC Measurement byte encoding — with cadence:**

    Byte 0: 0x03  (flags: running mode + cadence present)
    Byte 1: speed low byte  (speed × 256, little-endian)
    Byte 2: speed high byte
    Byte 3: cadence (steps/min)

**RSC Measurement byte encoding — without cadence:**

    Byte 0: 0x00  (flags: speed only)
    Byte 1: speed low byte
    Byte 2: speed high byte

---

### `stopPeripheral(): Promise<void>`

Stops advertising, closes the GATT server, and clears all subscribed device records. Call on app unmount or session end.

    await stopPeripheral();

---

## Internal Behaviour

### Subscription Tracking (CCCD)

When a Garmin connects and enables notifications, it writes `0x0100` to the **CCCD descriptor** (`0x2902`) of the RSC Measurement characteristic. The module tracks this per-device in `subscribedDevices: mutableSetOf<BluetoothDevice>()`. `notifyRSC()` only pushes to devices in this set.

### Disconnection Handling

On `STATE_DISCONNECTED`, the device is automatically removed from `subscribedDevices`, preventing notify attempts to stale connections.

### Read Requests

The GATT server responds to read requests on `RSC Feature` and `Sensor Location` with their static values. This is required by the RSCS spec for Garmin to accept the sensor.

---

## Recommended Usage Pattern

    import { useEffect, useCallback } from 'react';
    import {
      startGattServer,
      startAdvertising,
      notifyRSC,
      stopPeripheral
    } from './modules/ble-peripheral';

    export function useBlePeripheral() {
      useEffect(() => {
        const init = async () => {
          await startGattServer();
          await startAdvertising();
        };
        init();
        return () => { stopPeripheral(); };
      }, []);

      const broadcast = useCallback(async (speedMps: number, cadenceSpm: number | null) => {
        await notifyRSC(speedMps, cadenceSpm);
      }, []);

      return { broadcast };
    }

### FTMS Speed → m/s Conversion

FTMS Treadmill Data (characteristic `0x2ACD`) reports speed in **km/h × 100** (uint16, little-endian). Convert before passing to `notifyRSC`:

    const speedMps = (rawSpeed / 100) / 3.6;
    await notifyRSC(speedMps, cadence ?? null);

---

## Limitations

| Limitation | Detail |
|---|---|
| Android only | iOS restricts peripheral advertising for non-MFi accessories |
| Background advertising | Works on Android; consider a Foreground Service for long sessions |
| Multiple centrals | Supported — all subscribed devices receive notifications |
| FTMS parsing | Not included — handled in the app TypeScript layer |

---

## File Structure

    modules/ble-peripheral/
    ├── expo-module.config.json        # module registration
    ├── index.ts                       # JS/TS public API
    └── android/
        └── src/main/java/expo/modules/bleperipheral/
            └── BlePeripheralModule.kt # native GATT server implementation
