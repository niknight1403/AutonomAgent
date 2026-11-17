# AutonomAgent

AutonomAgent is an Android-first, Expo/React Native TypeScript workspace for researching product arbitrage and managing a controlled resale workflow.

## Current release posture

- **Default mode:** PAPER (simulation only)
- **Live trading:** disabled
- **Purchases/listings:** require real provider integrations and explicit server-side approval
- **Financial figures:** demo values are labelled; no simulated value is represented as realized revenue
- **Secrets:** provider credentials belong on the server, never in the mobile app or `EXPO_PUBLIC_*`

This repository is an initial, safe foundation. It is **not** a production trading system and does not yet contain verified marketplace checkout, settlement, or APK release evidence.

## Workspace

- `apps/mobile` — Expo Android client
- `services/api` — planned server-side API boundary and integration notes
- `packages/trading-core` — pure risk/profit calculation primitives
- `docs` — architecture and release gates

## Getting started

Requirements: Node.js 20+ and npm.

```bash
npm ci
npm run mobile
```

The mobile shell is designed to make the disconnected/demo state explicit. It does not execute real trades.

## Safety gates before any live use

1. Implement authenticated server-side sessions and ADMIN/OPERATOR/VIEWER authorization.
2. Implement an immutable, double-entry wallet ledger and atomic capital reservations.
3. Add durable jobs, transactional outbox, idempotency, leases, and reconciliation.
4. Integrate each marketplace only through its official supported API and explicit capability flags.
5. Require a fresh price/stock/fee check and explicit administrator approval for every purchase.
6. Keep a server-side emergency stop and make unknown order/payment states reconcile-only.
7. Pass automated unit, integration, concurrency, security, and Android install tests.
8. Publish build IDs, artifact hashes, migration status, and health-check evidence before calling a release production-ready.

See [docs/architecture.md](docs/architecture.md) and [docs/release-gates.md](docs/release-gates.md).

## License

No license has been granted yet. All rights reserved unless a separate license is added.


## Lokaler Produktpilot (Demo)

Die Android-App enthält einen explizit gestarteten, deterministischen Demo-Lauf mit lokal festgelegten Produktbeispielen, Cent-basierter Profit-/Risikobewertung, unveröffentlichten Listing-Entwürfen, illustrativen Reichweitenideen und einer Warteschlange für manuelle Prüfung. Der Demo-Lauf selbst startet keine externen Marktplatz-/Werbeaufrufe, Hintergrundjobs, Käufe, Veröffentlichungen oder Freigabeausführung. Separate API-Worker-Bausteine sind nicht mit dem mobilen Demo-Lauf verbunden und werden vom aktuellen Serverstart nicht gestartet. PAPER bleibt aktiv; die API-Konfiguration weist LIVE hart zurück. Preise, Bestände, Margen und Reichweiten sind Beispieldaten, keine Marktdaten oder Prognosen.
