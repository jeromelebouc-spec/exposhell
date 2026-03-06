import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";

export default function Index() {
  const [playing, setPlaying] = useState(false);

  const onStateChange = useCallback((state: string) => {
    if (state === "ended") {
      setPlaying(false);
    }
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
  },
  note: {
    marginTop: 12,
    color: "#007aff",
  },
});
