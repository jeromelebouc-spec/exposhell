import { Stack } from "expo-router";
import { BleProvider } from "@/context/ble-context";

export default function RootLayout() {
  return (
    <BleProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </BleProvider>
  );
}
