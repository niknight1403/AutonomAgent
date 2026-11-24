import React from "react";
import { View, Text, Pressable } from "react-native";
import ProductResearchDashboard from "./ProductResearchDashboard";

class StartupBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: "#090D18", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: "#FFFFFF", fontSize: 22 }}>AutonomAgent – Wiederherstellung</Text>
        <Text style={{ color: "#AAB8D1", marginVertical: 16 }}>Die Oberfläche konnte nicht geladen werden. Bitte versuche es erneut.</Text>
        <Pressable accessibilityRole="button" onPress={() => this.setState({ failed: false })}>
          <Text style={{ color: "#AFC5FF", paddingVertical: 16 }}>Erneut versuchen</Text>
        </Pressable>
      </View>
    );
  }
}

export default function App() {
  return <StartupBoundary><ProductResearchDashboard /></StartupBoundary>;
}
