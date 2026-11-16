import React from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

const Card = ({ title, value, note }: { title: string; value: string; note: string }) => (
  <View style={styles.card}>
    <Text style={styles.cardTitle}>{title}</Text>
    <Text style={styles.value}>{value}</Text>
    <Text style={styles.note}>{note}</Text>
  </View>
);

export default function App() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>AUTONOMAGENT / CONTROL CENTER</Text>
        <Text style={styles.heading}>Operations</Text>
        <View style={styles.status}>
          <View style={styles.dot} />
          <Text style={styles.statusText}>PAPER MODE · LIVE TRADING DISABLED</Text>
        </View>
        <Text style={styles.section}>Portfolio overview</Text>
        <Card title="Wallet" value="—" note="Backend not connected · no live balance" />
        <Card title="Realized profit" value="—" note="Only settled ledger entries will appear here" />
        <Card title="Open trades" value="0" note="No connected trading backend" />
        <Text style={styles.section}>Agent supervisor</Text>
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>STOPPED</Text>
          <Text style={styles.note}>The mobile shell cannot start purchases. Connect the authenticated API and complete the release gates first.</Text>
        </View>
        <Text style={styles.section}>Activity</Text>
        <View style={styles.panel}>
          <Text style={styles.note}>No backend events received.</Text>
        </View>
        <Text style={styles.footer}>AutonomAgent · Safe preview build · Not financial advice</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#090D18" },
  container: { padding: 22, gap: 14 },
  eyebrow: { color: "#7C91B8", fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  heading: { color: "#F3F6FF", fontSize: 32, fontWeight: "800" },
  status: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: "#765C2C", backgroundColor: "#241D12", padding: 12, borderRadius: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#E9B44C" },
  statusText: { color: "#F2C875", fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  section: { color: "#DDE6FA", fontSize: 16, fontWeight: "700", marginTop: 10 },
  card: { backgroundColor: "#121A2B", borderColor: "#24314A", borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 },
  cardTitle: { color: "#8FA2C5", fontSize: 12, fontWeight: "600" },
  value: { color: "#F4F7FF", fontSize: 25, fontWeight: "800" },
  note: { color: "#91A0BC", fontSize: 12, lineHeight: 18 },
  panel: { backgroundColor: "#121A2B", borderColor: "#24314A", borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  panelTitle: { color: "#E9B44C", fontSize: 18, fontWeight: "800" },
  footer: { color: "#64738F", fontSize: 10, textAlign: "center", marginTop: 18, marginBottom: 22 }
});
