import * as SecureStore from "expo-secure-store";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { GoogleSignin } from "@react-native-google-signin/google-signin";

// ─────────────────────────────────────────
// Set EXPO_PUBLIC_GOOGLE_CLIENT_ID in your .env file.
// This MUST be a "Web application" Client ID from Google Cloud Console.
// The matching "Android" client ID must also exist in the same project.
// ─────────────────────────────────────────
const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "";

GoogleSignin.configure({
  webClientId: CLIENT_ID,
  scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
});

const TOKEN_KEY = "yt_access_token";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface YoutubePlaylist {
  id: string;
  title: string;
  thumbnail: string;
  itemCount: number;
}

export interface YoutubeVideo {
  id: string;
  title: string;
  thumbnail: string;
}

interface YoutubeContextValue {
  isSignedIn: boolean;
  isLoading: boolean;
  accessToken: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  fetchPlaylists: () => Promise<YoutubePlaylist[]>;
  fetchPlaylistItems: (playlistId: string) => Promise<YoutubeVideo[]>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const YoutubeContext = createContext<YoutubeContextValue | null>(null);

export function useYoutube() {
  const ctx = useContext(YoutubeContext);
  if (!ctx) throw new Error("useYoutube must be used inside <YoutubeProvider>");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function YoutubeProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore token on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_KEY);
        if (stored) {
          // Check if silently signed in
          const currentUser = await GoogleSignin.signInSilently();
          if (currentUser) {
            const tokens = await GoogleSignin.getTokens();
            if (tokens.accessToken) {
              setAccessToken(tokens.accessToken);
              SecureStore.setItemAsync(TOKEN_KEY, tokens.accessToken).catch(() => {});
            } else {
              setAccessToken(stored);
            }
          } else {
            setAccessToken(stored);
          }
        }
      } catch {
        // ignore errors during silent sign in
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async () => {
    try {
      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signIn();
      const tokens = await GoogleSignin.getTokens();
      if (tokens.accessToken) {
        setAccessToken(tokens.accessToken);
        SecureStore.setItemAsync(TOKEN_KEY, tokens.accessToken).catch(() => {});
      }
    } catch (error: any) {
      console.warn("Google Signin Error:", error);
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (accessToken) {
         await GoogleSignin.revokeAccess();
      }
      await GoogleSignin.signOut();
    } catch (error) {
       console.warn("Error signing out", error);
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    setAccessToken(null);
  }, [accessToken]);

  const fetchPlaylists = useCallback(async (): Promise<YoutubePlaylist[]> => {
    if (!accessToken) return [];
    const url =
      "https://www.googleapis.com/youtube/v3/playlists" +
      "?part=snippet,contentDetails&mine=true&maxResults=50";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`YouTube API error ${res.status}`);
    const json = await res.json();
    return (json.items ?? []).map((item: any) => ({
      id: item.id,
      title: item.snippet.title,
      thumbnail:
        item.snippet.thumbnails?.medium?.url ??
        item.snippet.thumbnails?.default?.url ??
        "",
      itemCount: item.contentDetails?.itemCount ?? 0,
    }));
  }, [accessToken]);

  const fetchPlaylistItems = useCallback(
    async (playlistId: string): Promise<YoutubeVideo[]> => {
      if (!accessToken) return [];
      const url =
        "https://www.googleapis.com/youtube/v3/playlistItems" +
        `?part=snippet&playlistId=${playlistId}&maxResults=50`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`YouTube API error ${res.status}`);
      const json = await res.json();
      return (json.items ?? [])
        .filter(
          (item: any) =>
            item.snippet?.resourceId?.videoId &&
            item.snippet?.title !== "Deleted video" &&
            item.snippet?.title !== "Private video"
        )
        .map((item: any) => ({
          id: item.snippet.resourceId.videoId,
          title: item.snippet.title,
          thumbnail:
            item.snippet.thumbnails?.medium?.url ??
            item.snippet.thumbnails?.default?.url ??
            "",
        }));
    },
    [accessToken]
  );

  const value = useMemo(
    () => ({
      isSignedIn: !!accessToken,
      isLoading,
      accessToken,
      signIn,
      signOut,
      fetchPlaylists,
      fetchPlaylistItems,
    }),
    [
      accessToken,
      isLoading,
      signIn,
      signOut,
      fetchPlaylists,
      fetchPlaylistItems,
    ]
  );

  return (
    <YoutubeContext.Provider value={value}>{children}</YoutubeContext.Provider>
  );
}
