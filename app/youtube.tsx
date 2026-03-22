import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  YoutubePlaylist,
  YoutubeVideo,
  useYoutube,
} from "@/context/youtube-context";

type Screen = "playlists" | "videos";

export default function YoutubeScreen() {
  const router = useRouter();
  const { isSignedIn, isLoading, signIn, signOut, fetchPlaylists, fetchPlaylistItems } =
    useYoutube();

  const [screen, setScreen] = useState<Screen>("playlists");
  const [playlists, setPlaylists] = useState<YoutubePlaylist[]>([]);
  const [videos, setVideos] = useState<YoutubeVideo[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<YoutubePlaylist | null>(null);
  const [fetching, setFetching] = useState(false);

  const loadPlaylists = useCallback(async () => {
    setFetching(true);
    try {
      const data = await fetchPlaylists();
      setPlaylists(data);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to load playlists");
    } finally {
      setFetching(false);
    }
  }, [fetchPlaylists]);

  useEffect(() => {
    if (isSignedIn) loadPlaylists();
  }, [isSignedIn, loadPlaylists]);

  const openPlaylist = useCallback(
    async (playlist: YoutubePlaylist) => {
      setSelectedPlaylist(playlist);
      setFetching(true);
      try {
        const data = await fetchPlaylistItems(playlist.id);
        setVideos(data);
        setScreen("videos");
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "Failed to load videos");
      } finally {
        setFetching(false);
      }
    },
    [fetchPlaylistItems]
  );

  const selectVideo = useCallback(
    (video: YoutubeVideo) => {
      // Navigate to the main screen with the videoId as a param.
      // Using replace so the YouTube screen is not kept on the stack.
      router.replace({ pathname: "/", params: { videoId: video.id } });
    },
    [router]
  );

  // ── Login screen ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF0000" />
      </View>
    );
  }

  if (!isSignedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loginContainer}>
          <Text style={styles.appTitle}>YouTube</Text>
          <Text style={styles.loginSubtitle}>
            Sign in to browse your playlists and pick a video to play.
          </Text>
          <TouchableOpacity style={styles.googleButton} onPress={signIn}>
            <Text style={styles.googleButtonText}>Sign in with Google</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Video list ─────────────────────────────────────────────────────────────
  if (screen === "videos") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => setScreen("playlists")}
            style={styles.headerBack}
          >
            <Text style={styles.headerBackText}>← {selectedPlaylist?.title}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={signOut} style={styles.signOutButton}>
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        {fetching ? (
          <ActivityIndicator style={styles.spinner} size="large" color="#FF0000" />
        ) : (
          <FlatList
            data={videos}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} onPress={() => selectVideo(item)}>
                {item.thumbnail ? (
                  <Image source={{ uri: item.thumbnail }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]} />
                )}
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {item.title}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>No videos in this playlist.</Text>
            }
          />
        )}
      </SafeAreaView>
    );
  }

  // ── Playlist list ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Text style={styles.headerBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Playlists</Text>
        <TouchableOpacity onPress={signOut} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      {fetching ? (
        <ActivityIndicator style={styles.spinner} size="large" color="#FF0000" />
      ) : (
        <FlatList
          data={playlists}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openPlaylist(item)}>
              {item.thumbnail ? (
                <Image source={{ uri: item.thumbnail }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]} />
              )}
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.rowMeta}>{item.itemCount} videos</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No playlists found.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f0f" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f0f0f" },

  // Login
  loginContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 20,
  },
  appTitle: {
    fontSize: 40,
    fontWeight: "900",
    color: "#FF0000",
    letterSpacing: -1,
  },
  loginSubtitle: {
    fontSize: 15,
    color: "#aaa",
    textAlign: "center",
    lineHeight: 22,
  },
  googleButton: {
    backgroundColor: "#FF0000",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 28,
    marginTop: 8,
  },
  googleButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  backButton: { marginTop: 4 },
  backButtonText: { color: "#888", fontSize: 14 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  headerBack: { flex: 1 },
  headerBackText: { color: "#FF0000", fontSize: 14, fontWeight: "600" },
  headerTitle: { color: "#fff", fontSize: 15, fontWeight: "700", flex: 2, textAlign: "center" },
  signOutButton: { flex: 1, alignItems: "flex-end" },
  signOutText: { color: "#888", fontSize: 13 },

  // Rows
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    gap: 12,
  },
  thumb: {
    width: 96,
    height: 56,
    borderRadius: 6,
    backgroundColor: "#222",
  },
  thumbPlaceholder: { backgroundColor: "#2a2a2a" },
  rowInfo: { flex: 1 },
  rowTitle: { color: "#fff", fontSize: 14, fontWeight: "500", lineHeight: 20 },
  rowMeta: { color: "#888", fontSize: 12, marginTop: 3 },

  spinner: { marginTop: 48 },
  empty: { color: "#666", textAlign: "center", marginTop: 48 },
});
