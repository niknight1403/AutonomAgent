import React, { useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { runDemoAutopilot, type DemoAutopilotRun } from "@autonomagent/trading-core";

const euro = (cents: bigint) => new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
}).format(Number(cents) / 100);

const reasonLabel: Record<string, string> = {
  INVALID_TOTAL_COST: "Kostenbasis ist ungültig",
  MAX_TRADE_EXCEEDED: "Maximales Demo-Risikolimit überschritten",
  MAX_OPEN_TRADES_REACHED: "Maximale Anzahl offener Vorgänge erreicht",
  DAILY_LOSS_LIMIT_REACHED: "Tagesverlustlimit erreicht",
  MIN_PROFIT_NOT_MET: "Demo-Mindestgewinn nicht erreicht",
  MIN_ROI_NOT_MET: "Demo-Mindestrendite nicht erreicht",
  DEMO_STOCK_UNAVAILABLE: "Kein Demo-Bestand verfügbar",
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}

export default function AutopilotDashboard() {
  const [run, setRun] = useState<DemoAutopilotRun | null>(null);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>AUTONOMAGENT / DE-EU DEMO CONTROL</Text>
        <Text style={styles.heading}>Produktpilot</Text>
        <Text style={styles.intro}>
          Lokale Produktideen, nachvollziehbare Kalkulationen und unveröffentlichte Entwürfe.
        </Text>

        <View style={styles.safetyBanner}>
          <View style={styles.safetyDot} />
          <View style={styles.safetyCopy}>
            <Text style={styles.safetyTitle}>PAPER · LIVE-TRADING AUS</Text>
            <Text style={styles.note}>Keine Anbieteraufrufe, Käufe oder Veröffentlichungen.</Text>
          </View>
        </View>

        <Panel>
          <Text style={styles.panelTitle}>BACKENDSTATUS · NICHT VERBUNDEN</Text>
          <Text style={styles.note}>
            Kein API- oder Anbieter verbunden. Dieser Lauf nutzt ausschließlich lokale DE/EU-Demo-Datensätze.
          </Text>
        </Panel>

        <Text style={styles.section}>Autopilot</Text>
        <Panel>
          <Text style={styles.panelTitle}>Lokaler Demo-Lauf</Text>
          <Text style={styles.note}>
            Entdeckung → Profit-/Risikoprüfung → Listing-Entwurf → Reichweitenidee → manuelle Prüfung.
            Es werden ausschließlich fest eingebaute Demo-Datensätze verwendet.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Lokalen Demo-Autopilot starten"
            onPress={() => setRun(runDemoAutopilot())}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.primaryButtonText}>Demo-Autopilot starten</Text>
          </Pressable>
          {run === null ? (
            <Text style={styles.smallNote}>Noch kein Lauf gestartet. Es werden keine Hintergrundjobs ausgeführt.</Text>
          ) : (
            <View style={styles.metricsRow}>
              <Metric label="Kandidaten" value={String(run.assessments.length)} />
              <Metric label="Entwürfe" value={String(run.listingDrafts.length)} />
              <Metric label="Prüfung offen" value={String(run.approvalQueue.length)} />
            </View>
          )}
        </Panel>

        {run !== null && (
          <>
            <Text style={styles.section}>Produktkatalog · Demo-Daten</Text>
            {run.assessments.map((assessment) => (
              <Panel key={assessment.product.id}>
                <View style={styles.cardTopline}>
                  <View style={styles.flexOne}>
                    <Text style={styles.cardTitle}>{assessment.product.title}</Text>
                    <Text style={styles.smallNote}>{assessment.product.category} · Demo</Text>
                  </View>
                  <Text style={assessment.riskReasons.length === 0 ? styles.goodBadge : styles.reviewBadge}>
                    {assessment.riskReasons.length === 0 ? "PRÜFBEREIT" : "PRÜFEN"}
                  </Text>
                </View>
                <Text style={styles.note}>{assessment.product.summary}</Text>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Beispielkosten</Text>
                  <Text style={styles.detailValue}>{euro(assessment.totalCostCents)}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Kalkulierter Demo-Nettogewinn</Text>
                  <Text style={assessment.netProfitCents >= 0n ? styles.profit : styles.loss}>
                    {euro(assessment.netProfitCents)}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Beispielbestand</Text>
                  <Text style={styles.detailValue}>{assessment.product.stockUnits} Einheiten · nicht live</Text>
                </View>
                {assessment.riskReasons.length > 0 && (
                  <View style={styles.reasonBox}>
                    {assessment.riskReasons.map((reason) => (
                      <Text key={reason} style={styles.reasonText}>• {reasonLabel[reason] ?? reason}</Text>
                    ))}
                  </View>
                )}
              </Panel>
            ))}

            <Text style={styles.section}>Listing-Entwürfe</Text>
            {run.listingDrafts.length === 0 ? (
              <Panel><Text style={styles.note}>Keine Demo-Kandidaten erfüllen aktuell die Beispielregeln.</Text></Panel>
            ) : run.listingDrafts.map((draft) => (
              <Panel key={draft.id}>
                <View style={styles.cardTopline}>
                  <Text style={[styles.cardTitle, styles.flexOne]}>{draft.title}</Text>
                  <Text style={styles.reviewBadge}>ENTWURF</Text>
                </View>
                <Text style={styles.note}>{draft.description}</Text>
                <Text style={styles.smallNote}>Kanal: {draft.channelLabel} · individuell formulierter Demo-Entwurf</Text>
                <Text style={styles.pendingText}>Wartet auf menschliche Prüfung · nicht veröffentlicht</Text>
              </Panel>
            ))}

            <Text style={styles.section}>Reichweitenideen</Text>
            {run.reachRecommendations.map((recommendation) => (
              <Panel key={`${recommendation.productId}-${recommendation.channel}`}>
                <View style={styles.cardTopline}>
                  <Text style={[styles.cardTitle, styles.flexOne]}>{recommendation.channelLabel}</Text>
                  <Text style={styles.fitBadge}>{recommendation.fit === "HIGH" ? "GUTE PASSUNG" : "TEST-IDEE"}</Text>
                </View>
                <Text style={styles.detailValue}>
                  Illustratives Szenario: {recommendation.illustrativeWeeklyViews.min}–{recommendation.illustrativeWeeklyViews.max} Ansichten/Woche
                </Text>
                <Text style={styles.note}>{recommendation.rationale}</Text>
                <Text style={styles.smallNote}>Nicht gemessen · keine Prognose · keine Plattform verbunden</Text>
              </Panel>
            ))}

            <Text style={styles.section}>Freigabewarteschlange</Text>
            {run.approvalQueue.length === 0 ? (
              <Panel><Text style={styles.note}>Keine Listing-Entwürfe zur Prüfung vorgemerkt.</Text></Panel>
            ) : run.approvalQueue.map((item) => (
              <Panel key={item.id}>
                <Text style={styles.panelTitle}>MANUELLE PRÜFUNG AUSSTEHEND</Text>
                <Text style={styles.note}>{item.message}</Text>
                <Text style={styles.smallNote}>Es wurde keine externe Aktion ausgeführt.</Text>
              </Panel>
            ))}
          </>
        )}

        <Text style={styles.footer}>
          Alle Preise, Bestände, Gewinn- und Reichweitenwerte sind illustrative Demo-Daten. Kein Kauf, keine Veröffentlichung, keine Finanzberatung.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
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
  primaryButton: { backgroundColor: "#3458A8", paddingVertical: 13, paddingHorizontal: 16, borderRadius: 11, alignItems: "center", marginTop: 3 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  buttonPressed: { opacity: 0.78 },
  metricsRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  metric: { flex: 1, backgroundColor: "#0D1422", padding: 10, borderRadius: 10, gap: 2 },
  metricValue: { color: "#F3F6FF", fontSize: 19, fontWeight: "800" },
  metricLabel: { color: "#8999B6", fontSize: 10 },
  cardTopline: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  flexOne: { flex: 1 },
  goodBadge: { color: "#8CE0B2", backgroundColor: "#123325", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, fontSize: 9, fontWeight: "800", overflow: "hidden" },
  reviewBadge: { color: "#F1C773", backgroundColor: "#382D18", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, fontSize: 9, fontWeight: "800", overflow: "hidden" },
  fitBadge: { color: "#B8C9FF", backgroundColor: "#1A2846", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, fontSize: 9, fontWeight: "800", overflow: "hidden" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  detailLabel: { color: "#8D9CB8", fontSize: 11, flex: 1 },
  detailValue: { color: "#E7EDFA", fontSize: 12, fontWeight: "700" },
  profit: { color: "#8CE0B2", fontSize: 12, fontWeight: "800" },
  loss: { color: "#F08A8A", fontSize: 12, fontWeight: "800" },
  reasonBox: { backgroundColor: "#2A1D1E", borderRadius: 9, padding: 9, gap: 4 },
  reasonText: { color: "#F0AAAA", fontSize: 11, lineHeight: 16 },
  pendingText: { color: "#F1C773", fontSize: 11, fontWeight: "700" },
  footer: { color: "#64738F", fontSize: 10, lineHeight: 16, textAlign: "center", marginTop: 18, marginBottom: 8 },
});
