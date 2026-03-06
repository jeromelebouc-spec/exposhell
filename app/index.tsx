import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";

export default function Index() {
  const [playing, setPlaying] = useState(false);
  const [overlayNumber, setOverlayNumber] = useState(0);

  const onStateChange = useCallback((state: string) => {
    if (state === "ended") {
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setOverlayNumber(Math.floor(Math.random() * 10000));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🎬 Expo Shell: YouTube Iframe</Text>
      <View style={styles.player}> 
        <YoutubePlayer
          height={200}
          play={playing}
          videoId="dQw4w9WgXcQ"
          onChangeState={onStateChange}
        />
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.overlayText}>{overlayNumber}</Text>
        </View>
      </View>
      <Text style={styles.note} onPress={() => setPlaying((prev) => !prev)}>
        {playing ? "⏸️ Tap to pause" : "▶️ Tap to play"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
  },
  player: {
    width: "100%",
    maxWidth: 480,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
    position: "relative",
  },
  overlay: {
    position: "absolute",
    top: 12,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 8,
  },
  overlayText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  note: {
    marginTop: 12,
    color: "#007aff",
  },
});
