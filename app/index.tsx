import React from "react";
import { Text, View } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";

export default function Index() {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text>Edit app/index.tsx to edit this screen.</Text>
      <YoutubePlayer
height={300}
play={true}
videoId={"dQw4w9WgXcQ"} // Replace with your YouTube video ID
/>
    </View>
  );
}
