import { Stack } from "expo-router";
import { BleProvider } from "./ble-context";

export default function RootLayout() {
  return (
    <BleProvider>
      <Stack />
    </BleProvider>
  );
}
