import { requireNativeModule } from 'expo-modules-core';

const BlePeripheral = requireNativeModule('BlePeripheral');

export const startGattServer = (): Promise<void> =>
  BlePeripheral.startGattServer();

export const startAdvertising = (): Promise<void> =>
  BlePeripheral.startAdvertising();

export const notifyRSC = (speedMps: number, cadenceSpm: number | null): Promise<void> =>
  BlePeripheral.notifyRSC(speedMps, cadenceSpm);

export const stopPeripheral = (): Promise<void> =>
  BlePeripheral.stop();
