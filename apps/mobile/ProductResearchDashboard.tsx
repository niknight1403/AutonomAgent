import React, { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";

type ApiStatus = {
  state: "HEALTHY" | "DEGRADED";
  uptimeSeconds: number;
  latencyMs: number;
  database: { state: "CONNECTED" | "DISCONNECTED"; latencyMs: number };
  workers: { active: number; state: string };
  integrations: { braveSearch: boolean; stripe: boolean; digistore24: boolean; hubspot: boolean };
  tradingMode: string;
  liveTradingEnabled: boolean;
};

type SearchLead = {
  id: string;
  providerId: "brave-search";
  title: string;
  url: string;
  snippet?: string;
  retrievedAt: string;
};

type SearchPage = {
  query: string;
  results: SearchLead[];
  moreResultsAvailable: boolean;
};

type SessionTokens = { accessToken: string; refreshToken: string };

type StatusResult =
  | { status: "loading" }
  | { status: "offline"; message: string }
  | { status: "online"; data: ApiStatus };

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL?.trim() ||
  (Platform.OS === "android" ? "http://10.0.2.2:8080" : "http://127.0.0.1:8080")).replace(/\/+$/, "");
const REFRESH_TOKEN_KEY = "autonomagent.refreshToken";

async function requestJson(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function errorMessage(code: unknown): string {
  switch (code) {
    case "INVALID_CREDENTIALS": return "E-Mail oder Passwort ist nicht korrekt.";
    case "AUTHENTICATION_REQUIRED":
    case "INVALID_REFRESH_TOKEN": return "Die Sitzung ist abgelaufen. Bitte melde dich erneut an.";
    case "ADMIN_ROLE_REQUIRED": return "Die Produktsuche ist nur für ADMIN-Konten freigeschaltet.";
    case "BRAVE_SEARCH_NOT_CONFIGURED": return "Die Brave-Suche ist serverseitig noch nicht eingerichtet.";
    case "WEB_SEARCH_RATE_LIMITED": return "Die Suchanfrage wurde begrenzt. Bitte warte kurz und versuche es erneut.";
    case "WEB_SEARCH_PROVIDER_UNAVAILABLE": return "Der Suchdienst ist momentan nicht erreichbar.";
    case "AUTH_SIGNING_SECRET_NOT_CONFIGURED": return "Die sichere Anmeldung ist serverseitig noch nicht eingerichtet.";
    default: return "Anfrage fehlgeschlagen. Prüfe die API-Verbindung und versuche es erneut.";
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    return errorMessage(body.error);
  } catch {
    return errorMessage(undefined);
  }
}

export default function ProductResearchDashboard() {
  const [apiStatus, setApiStatus] = useState<StatusResult>({ status: "loading" });
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchLead[]>([]);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [pageOffset, setPageOffset] = useState(0);
  const [activeQuery, setActiveQuery] = useState("");

  const refreshApiStatus = useCallback(async () => {
    setRefreshingStatus(true);
    try {
      const response = await requestJson("/api/status");
      if (!response.ok) throw new Error("status request failed");
      const data = await response.json() as ApiStatus;
      if (!data || !["HEALTHY", "DEGRADED"].includes(data.state) || !data.database) {
        throw new Error("invalid status response");
      }
      setApiStatus({ status: "online", data });
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "Zeitüberschreitung beim Statusabruf"
        : "Backend derzeit nicht erreichbar";
      setApiStatus({ status: "offline", message });
    } finally {
      setRefreshingStatus(false);
    }
  }, []);

  const renewSession = useCallback(async (token: string): Promise<SessionTokens | null> => {
    try {
      const response = await requestJson("/v1/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
          setRefreshToken(null);
          setAccessToken(null);
        }
        setAuthMessage(await readError(response));
        return null;
      }
      const tokens = await response.json() as SessionTokens;
      if (!tokens.accessToken || !tokens.refreshToken) throw new Error("invalid token response");
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
      setRefreshToken(tokens.refreshToken);
      setAccessToken(tokens.accessToken);
      setAuthMessage(null);
      return tokens;
    } catch {
      setAuthMessage("Gespeicherte Sitzung konnte nicht erneuert werden. Prüfe die Backend-Verbindung.");
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const restore = async () => {
      try {
        const storedRefreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
        if (storedRefreshToken && mounted) {
          setRefreshToken(storedRefreshToken);
          await renewSession(storedRefreshToken);
        }
      } catch {
        if (mounted) setAuthMessage("Sichere Sitzung konnte nicht aus dem Gerätespeicher gelesen werden.");
      } finally {
        if (mounted) setSessionLoading(false);
      }
    };
    void restore();
    return () => { mounted = false; };
  }, [renewSession]);

  useEffect(() => {
    void refreshApiStatus();
    const interval = setInterval(() => void refreshApiStatus(), 30_000);
    return () => clearInterval(interval);
  }, [refreshApiStatus]);

  const login = async () => {
    setAuthBusy(true);
    setAuthMessage(null);
    try {
      const response = await requestJson("/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!response.ok) {
        setAuthMessage(await readError(response));
        return;
      }
      const tokens = await response.json() as SessionTokens;
      if (!tokens.accessToken || !tokens.refreshToken) throw new Error("invalid token response");
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
      setAccessToken(tokens.accessToken);
      setRefreshToken(tokens.refreshToken);
      setPassword("");
      setAuthMessage(null);
    } catch (error) {
      setAuthMessage(error instanceof Error && error.name === "AbortError"
        ? "Die Anmeldung hat zu lange gedauert."
        : "Anmeldung fehlgeschlagen. Prüfe API-Adresse und Backendstatus.");
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    const token = refreshToken;
    setAuthBusy(true);
    try {
      if (token) {
        const response = await requestJson("/v1/auth/logout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken: token }),
        });
        if (!response.ok) setAuthMessage("Sitzung lokal entfernt; der Server konnte das Token nicht bestätigen.");
      }
    } catch {
      setAuthMessage("Sitzung lokal entfernt; der Server war zum Widerrufen nicht erreichbar.");
    } finally {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      setAccessToken(null);
      setRefreshToken(null);
      setSearchResults([]);
      setHasMoreResults(false);
      setActiveQuery("");
      setAuthBusy(false);
    }
  };

  const runSearch = async (offset = 0, existingToken = accessToken) => {
    const searchQuery = (offset > 0 ? activeQuery : query).trim();
    if (!existingToken || !searchQuery) return;
    if (offset === 0) {
      setSearchResults([]);
      setHasMoreResults(false);
    }
    setSearchBusy(true);
    setSearchMessage(null);
    try {
      let token = existingToken;
      let response = await requestJson("/v1/admin/web-search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: searchQuery, count: 10, offset }),
      });
      if (response.status === 401 && refreshToken) {
        const renewed = await renewSession(refreshToken);
        if (renewed) {
          token = renewed.accessToken;
          response = await requestJson("/v1/admin/web-search", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ query: searchQuery, count: 10, offset }),
          });
        }
      }
      if (!response.ok) {
        setSearchMessage(await readError(response));
        return;
      }
      const page = await response.json() as SearchPage;
      if (!Array.isArray(page.results)) throw new Error("invalid search response");
      setActiveQuery(page.query);
      setPageOffset(offset);
      setHasMoreResults(page.moreResultsAvailable);
      setSearchResults((previous) => {
        const all = offset === 0 ? page.results : [...previous, ...page.results];
        return [...new Map(all.map((item) => [item.id, item])).values()];
      });
    } catch {
      setSearchMessage("Suche fehlgeschlagen. Prüfe die Verbindung und versuche es erneut.");
    } finally {
      setSearchBusy(false);
    }
  };

  const statusHeading = apiStatus.status === "loading" ? "BACKENDSTATUS · PRÜFUNG LÄUFT"
    : apiStatus.status === "offline" ? "BACKENDSTATUS · NICHT ERREICHBAR"
      : apiStatus.data.state === "HEALTHY" ? "BACKENDSTATUS · VERBUNDEN"
        : "BACKENDSTATUS · EINGESCHRÄNKT";

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>AUTONOMAGENT / PRODUKTRECHERCHE</Text>
        <Text style={styles.heading}>Produktrecherche</Text>
        <Text style={styles.intro}>
          Echte Web-Suchergebnisse mit Quellenlinks. Preise und Verfügbarkeit werden dadurch nicht verifiziert.
        </Text>

        <View style={styles.safetyBanner}>
          <View style={styles.safetyDot} />
          <View style={styles.safetyCopy}>
            <Text style={styles.safetyTitle}>
              {apiStatus.status === "online"
                ? `${apiStatus.data.tradingMode} · LIVE-TRADING ${apiStatus.data.liveTradingEnabled ? "EIN" : "AUS"}`
                : "HANDEL NICHT VERBUNDEN"}
            </Text>
            <Text style={styles.note}>Keine Käufe, Zahlungen oder Veröffentlichungen.</Text>
          </View>
        </View>

        <Panel>
          <Text style={styles.panelTitle}>{statusHeading}</Text>
          {apiStatus.status === "online" ? (
            <>
              <Text style={styles.note}>
                API {apiStatus.data.latencyMs} ms · Datenbank {apiStatus.data.database.state === "CONNECTED" ? `verbunden (${apiStatus.data.database.latencyMs} ms)` : "getrennt"}
              </Text>
              <Text style={styles.note}>Worker: {apiStatus.data.workers.state} ({apiStatus.data.workers.active} aktiv)</Text>
              <Text style={styles.note}>
                Umgebungsvariablen gesetzt: Brave {apiStatus.data.integrations.braveSearch ? "ja" : "nein"} · Stripe {apiStatus.data.integrations.stripe ? "ja" : "nein"} · Digistore24 {apiStatus.data.integrations.digistore24 ? "ja" : "nein"} · HubSpot {apiStatus.data.integrations.hubspot ? "ja" : "nein"}
              </Text>
              <Text style={styles.smallNote}>Ein gesetzter Schlüssel bestätigt keine funktionierende Anbindung; Stripe-/Digistore24-Checkout und HubSpot-Sync sind nicht aktiviert.</Text>
            </>
          ) : (
            <Text style={styles.note}>
              {apiStatus.status === "offline" ? `${apiStatus.message}. Adresse: ${API_BASE_URL}` : `Verbinde mit ${API_BASE_URL}`}
            </Text>
          )}
          <Pressable accessibilityRole="button" onPress={() => void refreshApiStatus()} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>{refreshingStatus ? "Wird aktualisiert …" : "Status aktualisieren"}</Text>
          </Pressable>
        </Panel>

        <Text style={styles.section}>Anmeldung</Text>
        <Panel>
          {sessionLoading ? <Text style={styles.note}>Sichere Sitzung wird geprüft …</Text> : accessToken ? (
            <>
              <Text style={styles.note}>Angemeldet. Die Produktsuche erfordert ein ADMIN-Konto.</Text>
              <Pressable accessibilityRole="button" disabled={authBusy} onPress={() => void logout()} style={styles.secondaryButton}>
                <Text style={styles.buttonLabel}>{authBusy ? "Bitte warten …" : "Abmelden"}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <TextInput
                accessibilityLabel="E-Mail-Adresse"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="E-Mail-Adresse"
                placeholderTextColor="#7788A8"
                value={email}
                onChangeText={setEmail}
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="Passwort"
                autoCapitalize="none"
                autoComplete="password"
                placeholder="Passwort"
                placeholderTextColor="#7788A8"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                style={styles.input}
              />
              <Pressable accessibilityRole="button" disabled={authBusy || !email.trim() || !password} onPress={() => void login()} style={styles.primaryButton}>
                <Text style={styles.buttonLabel}>{authBusy ? "Anmeldung läuft …" : "Anmelden"}</Text>
              </Pressable>
              <Text style={styles.smallNote}>Das Refresh-Token wird im sicheren Gerätespeicher abgelegt. Passwörter werden nicht gespeichert.</Text>
            </>
          )}
          {authMessage ? <Text accessibilityRole="alert" style={styles.errorText}>{authMessage}</Text> : null}
        </Panel>

        {accessToken ? (
          <>
            <Text style={styles.section}>Websuche</Text>
            <Panel>
              <Text style={styles.note}>Brave liefert Suchtreffer und Ausschnitte. Es wird daraus weder ein realer Preis noch ein Bestand abgeleitet.</Text>
              <TextInput
                accessibilityLabel="Suchbegriff"
                autoCapitalize="sentences"
                placeholder="Produkt oder Suchbegriff"
                placeholderTextColor="#7788A8"
                value={query}
                onChangeText={setQuery}
                maxLength={600}
                style={styles.input}
              />
              <Pressable accessibilityRole="button" disabled={searchBusy || !query.trim()} onPress={() => void runSearch(0)} style={styles.primaryButton}>
                <Text style={styles.buttonLabel}>{searchBusy ? "Suche läuft …" : "Im Web suchen"}</Text>
              </Pressable>
              {searchMessage ? <Text accessibilityRole="alert" style={styles.errorText}>{searchMessage}</Text> : null}
              {activeQuery ? <Text style={styles.smallNote}>Suchanfrage: „{activeQuery}“ · {searchResults.length} Quellen</Text> : null}
            </Panel>

            {searchResults.map((result) => (
              <Panel key={result.id}>
                <Text style={styles.cardTitle}>{result.title}</Text>
                {result.snippet ? <Text style={styles.note}>{result.snippet}</Text> : null}
                <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(result.url).catch(() => setSearchMessage("Quelle konnte auf diesem Gerät nicht geöffnet werden.")); }}>
                  <Text selectable style={styles.sourceUrl}>{result.url}</Text>
                </Pressable>
                <Text style={styles.smallNote}>Brave-Webtreffer · Preis und Verfügbarkeit nicht geprüft</Text>
              </Panel>
            ))}
            {hasMoreResults ? (
              <Pressable accessibilityRole="button" disabled={searchBusy} onPress={() => void runSearch(pageOffset + 1)} style={styles.secondaryButton}>
                <Text style={styles.buttonLabel}>{searchBusy ? "Wird geladen …" : "Weitere Quellen laden"}</Text>
              </Pressable>
            ) : null}
            {activeQuery && searchResults.length === 0 && !searchBusy ? (
              <Panel><Text style={styles.note}>Für diese Suche wurden keine Quellen zurückgegeben.</Text></Panel>
            ) : null}
          </>
        ) : (
          <Panel><Text style={styles.note}>Melde dich mit einem ADMIN-Konto an, um die geschützte Websuche zu verwenden.</Text></Panel>
        )}

        <Text style={styles.footer}>
          Suchtreffer sind keine geprüften Angebote. Kein Kauf, keine Veröffentlichung und keine Prognose.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#090D18" },
  container: { padding: 22, gap: 12, paddingBottom: 40 },
  eyebrow: { color: "#7C91B8", fontSize: 10, letterSpacing: 1.8, fontWeight: "700" },
  heading: { color: "#F3F6FF", fontSize: 32, fontWeight: "800" },
  intro: { color: "#AAB8D1", fontSize: 14, lineHeight: 21, marginBottom: 4 },
  safetyBanner: { flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: "#765C2C", backgroundColor: "#241D12", padding: 13, borderRadius: 12 },
  safetyDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#E9B44C" },
  safetyCopy: { flex: 1, gap: 3 },
  safetyTitle: { color: "#F2C875", fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  section: { color: "#DDE6FA", fontSize: 17, fontWeight: "700", marginTop: 10 },
  panel: { backgroundColor: "#121A2B", borderColor: "#24314A", borderWidth: 1, borderRadius: 16, padding: 15, gap: 10 },
  panelTitle: { color: "#F4F7FF", fontSize: 15, fontWeight: "700" },
  cardTitle: { color: "#F4F7FF", fontSize: 16, fontWeight: "700" },
  note: { color: "#A4B1CA", fontSize: 12, lineHeight: 18 },
  smallNote: { color: "#7788A8", fontSize: 10, lineHeight: 15 },
  input: { color: "#F3F6FF", backgroundColor: "#0D1422", borderColor: "#24314A", borderWidth: 1, borderRadius: 9, paddingVertical: 11, paddingHorizontal: 12, fontSize: 14 },
  primaryButton: { backgroundColor: "#3458A8", paddingVertical: 13, paddingHorizontal: 16, borderRadius: 11, alignItems: "center", marginTop: 3 },
  secondaryButton: { backgroundColor: "#24314A", paddingVertical: 11, paddingHorizontal: 16, borderRadius: 11, alignItems: "center", marginTop: 3 },
  buttonLabel: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  textButton: { alignSelf: "flex-start", paddingVertical: 5, paddingHorizontal: 2 },
  textButtonLabel: { color: "#AFC5FF", fontSize: 12, fontWeight: "700" },
  sourceUrl: { color: "#AFC5FF", fontSize: 11, lineHeight: 16 },
  errorText: { color: "#F08A8A", fontSize: 12, lineHeight: 18 },
  footer: { color: "#64738F", fontSize: 10, lineHeight: 16, textAlign: "center", marginTop: 18, marginBottom: 8 },
});
