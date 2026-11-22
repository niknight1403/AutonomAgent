# AutonomAgent v0.5.0 – Entwicklungsplan

**Status:** Vorschlag zur Planung, keine Freigabe für Implementierung, Merge oder Veröffentlichung.
**Ausgangspunkt:** veröffentlichter Quellcode-Release `v0.4.0`, Tag/Commit `35b537de398360f9c601bbfd3942c599b67b74cb`.
**Empfohlener Release-Fokus:** robuste, sichere und nachvollziehbare Produktsuche für den Admin-Testbetrieb. Kein Live-Handel und keine Produktionsfreigabe.

## Zielbild

v0.5.0 soll den aktuellen Ablauf „Admin meldet sich an → führt eine begrenzte Websuche aus → prüft sichere Quellen und den Systemstatus“ verlässlicher machen. Antworten bleiben ausdrücklich **Suchhinweise**, nicht verifizierte Preise, Lagerbestände, Kosten oder Kaufempfehlungen. PAPER bleibt der einzige Betriebsmodus.

## Meilensteine

### M0 – Umfang festlegen und PR-Basis bereinigen

- [ ] `#10 Fix mobile search pagination and stale results after logout` als vorgelagerten Fix prüfen: Endseite bei maximalem Brave-Offset, sofortiges Leeren bei Logout und Verwerfen alter Antworten.
- [ ] `#11 Harden product search in ten quality steps` erst nach #10 neu auf `main` ausrichten. Änderungspunkte einzeln gegen Akzeptanzkriterien prüfen; keine pauschale Übernahme nur aufgrund grüner PR-Checks.
- [ ] Offene PRs #3/#4/#5 mit dem aktuellen `main` vergleichen. Soweit ESM-/Migrationskorrekturen bereits enthalten und CI-bewiesen sind, als Duplikate schließen oder neu begründen statt erneut zu integrieren.
- [ ] Scope und Daten-/Sicherheitsgrenzen in den Release-Geltungsbereich aufnehmen.

**Abnahme:** ein eindeutiger v0.5-Umfang, keine doppelten Fixes, PR #10 vor #11; beide Ziel-PRs haben aktuelle CI-Checks.

### M1 – Suchablauf korrekt abbrechen und begrenzen

- [ ] Pagination am Provider-Limit abschließen; keine Seite jenseits des erlaubten maximalen Offsets anfordern oder anbieten.
- [ ] Sucheingaben normalisieren und leere/ungültige Abfragen kontrolliert ablehnen.
- [ ] Logout, Sitzungswechsel und neue Suchabfrage löschen bzw. invalidieren alte Ergebnisse unmittelbar; verspätete Responses dürfen den neuen Zustand nicht überschreiben.
- [ ] Abbruch muss laufende, wartende und Retry-Aufrufe stoppen, ohne Anfrage-Reihenfolge oder Ressourcenbereinigung zu beschädigen.
- [ ] Providerantworten streng validieren; fehlerhafte Resultate sicher verwerfen und keine Demo-/Beispieldaten einsetzen.
- [ ] Quellenlinks auf sichere HTTPS-Ziele beschränken und lokale, private, IP-basierte sowie nicht erlaubte Host-/Port-Ziele blockieren; Tracking-Parameter entfernen, soweit dies die Quelle nicht verfälscht.

**Abnahmekriterien:** Tests für Grenzoffset, Abbruch vor/nach Login-Wechsel, verspätete Antworten, Retry-Abbruch, URL-/Port-Grenzen, Tracking-Parameter und kaputte Providerpayloads. Kein privates Netz-/Loopback-Ziel wird als Ergebnislink akzeptiert. Bestehende PAPER- und ADMIN-Grenzen bleiben unverändert.

### M2 – Mobile-Ergebnisdarstellung verständlich und testbar machen

- [ ] Ergebniszustände klar trennen: „Suche läuft“, „keine Treffer“, „Provider nicht konfiguriert“, „Rate-Limit/temporärer Fehler“ und „Sitzung abgelaufen“.
- [ ] Für jeden Treffer nur verfügbare Herkunftsdaten zeigen (Titel, Domain/Quelle, HTTPS-Link, Suchzeit); kein Preis-/Bestands-/Margefeld aus Snippets ableiten.
- [ ] Suchformular per Tastatur bedienbar machen; Statusaktualisierung, Ladezustände und Fehler barrierearm beschriften.
- [ ] Mobile-UI-Tests für Logout, neue Suche, leere Ergebnisse, Fehler und Pagination ergänzen. Wenn ein Component-Test-Setup fehlt, zunächst minimal und nur für den Produktsuchbildschirm einführen.

**Abnahmekriterien:** nachvollziehbare UI-Tests verhindern alte Treffer nach Logout/neuer Suche; Fehlermeldungen verraten keine Secrets; Ergebnisdarstellung behauptet keine Marktverifikation.

### M3 – Authentifizierten Ablauf in Staging verifizieren

- [ ] Mit nicht-produktiven Zugangsdaten gegen eine Staging-PostgreSQL-Instanz testen: Migrationen, Login, Refresh-Rotation, Logout, ADMIN/VIEWER-Trennung, Rate-Limit und Audit-Lesezugriff.
- [ ] Suchintegration mit Brave-Testcredential oder einem kontrollierten Provider-Vertrag testen. Zugangsdaten verbleiben im serverseitigen Secret Store und erscheinen weder in Logs noch in der Mobile-App.
- [ ] Rate-Limit-Fail-closed-Verhalten bei nicht erreichbarer Datenbank, Provider-429/Timeout und sichere Wiederherstellung verifizieren.
- [ ] Staging-Smoke-Check dokumentieren: Build-ID, Commit, Migrationsstand, HTTP-Status/Health-Informationen und beobachtete Grenzen.

**Abnahmekriterien:** reproduzierbarer Staging-Test ohne Live-Kauf-/Schreiboperationen; keine Production Secrets oder echten Marktplatzkonten; kontrollierte Fehlerbehandlung dokumentiert. Ohne Providercredential bleibt die externe Providerprüfung offen und wird nicht als bestanden ausgewiesen.

### M4 – Release-Qualität und Android-Preview

- [ ] Frische `npm ci`, Prisma-Validierung und alle Migrationen gegen ephemeres PostgreSQL, API-Build, Workspace-Typechecks, API/Core-Tests, `npm audit --audit-level=high`, Secret-Hygiene und Android-Expo-Export müssen auf dem Release-Commit grün sein.
- [ ] Moderate Advisory-Liste erneut triagieren. Expo SDK 54 nicht stillschweigend durch ein Major-Upgrade ersetzen; mögliche SDK-/Toolchain-Änderungen als eigene Kompatibilitätsarbeit mit separatem Testplan behandeln.
- [ ] Versionsfelder konsistent auf `0.5.0` setzen; Android-`versionCode` von 4 auf 5 erhöhen.
- [ ] Falls Expo/EAS-Zugang und Android-Testgerät verfügbar sind: signierte Preview-APK bauen, installieren und Login/Suche/Logout auf einem Gerät smoke-testen. Sonst ausdrücklich nur den JavaScript-Export liefern.
- [ ] Release-Notizen mit tatsächlicher Testevidenz und verbleibenden Einschränkungen erstellen, GitHub-Release als Draft vorbereiten und vor öffentlicher Veröffentlichung erneut die konkrete Freigabe einholen.

**Abnahmekriterien:** alle CI-Gates des Release-Commits grün; bekannte moderate Advisory-Risiken offengelegt; Versionen/Tag/Notizen konsistent; kein Produktionsreife- oder Geräteinstallationsanspruch ohne entsprechende Nachweise.

## Globale Nicht-Ziele für v0.5.0

- Keine LIVE-Trading-Freigabe, Käufe/Bestellungen, Zahlungen/Checkout, Listing-Veröffentlichung oder Auszahlungen.
- Keine Behauptung, Brave-Snippets oder generische Providerverträge seien verifizierte Marketplace-Daten.
- Keine automatische Ausführung, autonomer Scheduler oder Aktivierung der Worker-/Outbox-Prozesse.
- Kein Vision-/Worker-Branch in diesem Umfang; die zuvor ausgeschlossene Vision-Arbeit bleibt separat.
- Kein ungetestetes Expo-SDK-Major-Upgrade im Produktsuch-Release.
- Kein öffentliches v0.5.0-Release ohne ausdrückliche Bestätigung des konkreten Release-Inhalts.

## Abhängigkeiten und offene Entscheidungen

1. **Staging-Datenbank und Secret-Verwaltung:** nötig für echte PostgreSQL-/Auth-Abnahme; nur Testdaten verwenden.
2. **Brave-API-Zugang oder kontrollierter Vertragstest:** ohne diesen Zugang sind Provider-Liveverhalten und 429/Timeout-Verhalten nur per Fake/Contract-Test abgedeckt.
3. **EAS/Expo-Zugang und Android-Gerät:** nötig für signierte APK und Installationsnachweis, nicht für einen JS-Bundle-Export.
4. **Moderate Expo-Advisories:** für v0.5 entscheiden, ob vertretbar dokumentiert oder über kompatible Einzelupdates reduziert; SDK 58 nicht als implizite Voraussetzung einplanen.
5. **Offene PRs #10/#11:** aktuell als gestapelte, offene Suchverbesserungen sichtbar; Merge nur nach Prüfung des neuesten Diffs und grüner CI auf dem aktualisierten Basisbranch.

## Reihenfolge und Aufwand

Empfohlene Reihenfolge: **M0 → M1 → M2 → M3 → M4**. Als grobe Planung ohne Kalenderzusage sind etwa **6–10 Engineering-Tage** für die Code-/Testarbeit plausibel; Staging-Zugang, Credential-Bereitstellung und echte Geräteprüfung können zusätzliche Wartezeit verursachen. M3 kann parallel zur UI-Arbeit vorbereitet werden, seine Abnahme hängt aber von den nicht-produktiven Zugangsdaten ab.
