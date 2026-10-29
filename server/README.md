# Nexora-Server

Gemeinsamer Server für Team-Notizbücher (Stufe 5). Stand Schritt 1: Gesundheitsseite, Anmeldeangaben für die Desktop-App und Prüfung der Entra-Anmeldung. Private Notizen bleiben immer auf dem eigenen PC; auf den Server kommt nur, was ausdrücklich geteilt wird (ab Schritt 2).

Ein Container, keine npm-Abhängigkeiten (Node 24 mit eingebautem HTTP, SQLite und Kryptografie). Daten liegen im Volume `/data`.

## 1. App-Registrierung in Microsoft Entra

Im Entra Admin Center unter **App-Registrierungen → Neue Registrierung**:

1. **Name:** `Nexora`. **Unterstützte Kontotypen:** nur Konten in diesem Organisationsverzeichnis.
   **Umleitungs-URI:** Plattform **Öffentlicher Client/nativ (mobil und Desktop)**, URI `http://localhost`.
   (Die Desktop-App meldet sich im Browser an und nimmt die Antwort auf einem freien Port von `localhost` entgegen; Entra erlaubt dafür jeden Port.)
2. **Eine API verfügbar machen:** Anwendungs-ID-URI festlegen (Vorschlag `api://<Client-ID>` übernehmen), dann **Bereich hinzufügen**: Name `access_as_user`, Zustimmung durch **Administratoren und Benutzer**, Anzeigename z. B. „Nexora verwenden“.
3. **API-Berechtigungen → Berechtigung hinzufügen → Meine APIs → Nexora → Delegiert → `access_as_user`**, danach **Administratorzustimmung erteilen**.
4. **Tokenkonfiguration → Gruppenanspruch hinzufügen:** Sicherheitsgruppen, für das **Zugriffstoken** z. B. `sAMAccountName` (bei aus dem AD synchronisierten Gruppen). Wird ab Schritt 2 für Rechte nach Gruppen gebraucht.
5. Empfohlen für den Anfang: **Unternehmensanwendungen → Nexora → Eigenschaften → Zuweisung erforderlich: Ja**, dann unter **Benutzer und Gruppen** nur die Gruppe zuweisen, die Nexora im Team nutzen soll.

Aus der **Übersicht** der App-Registrierung braucht der Server die **Anwendungs-ID (Client-ID)** und die **Verzeichnis-ID (Mandant)**. Ein geheimer Schlüssel ist nicht nötig.

## 2. Name und Proxy

- DNS-Eintrag für den Server, z. B. `nexora.firma.local`, auf den Docker-Host.
- Proxy-Host im Reverse Proxy (z. B. Nginx Proxy Manager) auf `http://<Docker-Host>:8092` mit HTTPS-Zertifikat. **WebSocket-Unterstützung einschalten** (für das gemeinsame Bearbeiten ab Schritt 3).

## 3. Container (z. B. Arcane)

1. Neues Projekt, `compose.yaml` aus diesem Ordner einfügen.
2. `.env` aus `.env.example` anlegen und ausfüllen: `NEXORA_TENANT_ID`, `NEXORA_CLIENT_ID`, `APP_PORT` (freier Port auf dem Host).
3. **Build & Deploy.** Gebaut wird direkt aus dem GitHub-Repo; der Host muss `github.com` erreichen.
4. Prüfen: `https://nexora.firma.local/health` zeigt `{"ok":true,"version":"…"}`.

Nach einem Update im Repo erneut **Build & Deploy** (die gespeicherte `compose.yaml` ist eine Kopie, ein Push ändert sie nicht).

## 4. In Nexora verbinden

**Einstellungen → Team-Server:** Adresse eintragen (`https://nexora.firma.local`), **Anmelden**. Der Browser öffnet die Microsoft-Anmeldung; danach zeigt Nexora „Angemeldet als …“. Die Anmeldung bleibt gespeichert, verschlüsselt mit Windows (DPAPI, nur für den eigenen Benutzer).

## Entwickeln

```bash
cd server
npm test
```

Lokal starten: `NEXORA_TENANT_ID=… NEXORA_CLIENT_ID=… DATA_DIR=./data npm start` (Port 8080).
