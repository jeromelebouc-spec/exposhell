import * as AuthSession from "expo-auth-session";
import * as Google from "expo-auth-session/providers/google";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

// ─────────────────────────────────────────
// Set EXPO_PUBLIC_GOOGLE_CLIENT_ID in your .env file.
// This must be an OAuth 2.0 Client ID (ends in .apps.googleusercontent.com),
// NOT an API key. Create one at:
//   Google Cloud Console → APIs & Services → Credentials → Create Credentials
//   → OAuth client ID → iOS (or Android)
// Also enable: YouTube Data API v3, scope: youtube.readonly
// ─────────────────────────────────────────
const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "";

WebBrowser.maybeCompleteAuthSession();

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

  // expo-auth-session Google provider — handles PKCE + auth code flow correctly
  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: CLIENT_ID,
    scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
  });

  // Restore token on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_KEY);
        if (stored) setAccessToken(stored);
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Handle OAuth response
  useEffect(() => {
    if (response?.type === "success") {
      const token = response.authentication?.accessToken;
      if (token) {
        SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => { });
        setAccessToken(token);
      }
    }
  }, [response]);

  const signIn = useCallback(async () => {
    if (!request) return;
    await promptAsync();
  }, [request, promptAsync]);

  const signOut = useCallback(async () => {
    if (accessToken) {
      try {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${accessToken}`,
          { method: "POST" }
        );
      } catch {
        // ignore revocation error
      }
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => { });
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
