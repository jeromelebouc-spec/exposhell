import { YoutubeProvider } from "@/context/youtube-context";
import { Stack } from "expo-router";
import { BleProvider } from "./ble-context";

export default function RootLayout() {
  return (
    <YoutubeProvider>
      <BleProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </BleProvider>
    </YoutubeProvider>
  );
}
