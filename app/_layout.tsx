import { Stack } from "expo-router";
import { YoutubeProvider } from "@/context/youtube-context";

export default function RootLayout() {
  return (
    <YoutubeProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </YoutubeProvider>
  );
}
