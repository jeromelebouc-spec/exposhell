import { Stack } from "expo-router";
import { BleProvider } from "@/context/ble-context";
import { YoutubeProvider } from "@/context/youtube-context";

export default function RootLayout() {
  return (
    <BleProvider>
      <YoutubeProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </YoutubeProvider>
    </BleProvider>
  );
}
