# Klassenarbeitsplaner – Mauritius-Gymnasium Büren

Ersetzt den A3-Papierplan an der Pinnwand. Gleiches Prinzip: Klassen in Spalten, Schultage in Zeilen.
Neu ist, dass der Planer beim Eintragen sofort prüft, ob die Klasse in der Woche schon zwei Arbeiten hat,
und dass alle von überall denselben Stand sehen.

Keine npm-Pakete, nur Node.js ab Version 20. Alle Daten liegen in einer Datei: `data/db.json`
(im Docker-Volume unter `/data`).

## Starten

    ADMIN_PASSWORD='langes-passwort' KOLLEGIUM_PASSWORD='fuers-kollegium' \
    SESSION_SECRET="$(openssl rand -hex 32)" node server.js

Oder mit Docker: Werte in `docker-compose.yml` eintragen, dann `docker compose up -d --build`.

| Variable | Bedeutung |
|---|---|
| `ADMIN_PASSWORD` | Passwort für die Verwaltung (Pflicht, mind. 10 Zeichen) |
| `KOLLEGIUM_PASSWORD` | Gemeinsames Passwort für alle Lehrkräfte. Nur beim **ersten** Start nötig, danach in der Verwaltung änderbar |
| `SESSION_SECRET` | Fester Zufallswert (mind. 32 Zeichen), damit Anmeldungen einen Neustart überstehen |
| `PORT` | Standard 3000 |
| `DATA_DIR` | Speicherort der Daten, Standard `./data` |
| `TRUST_PROXY` | `1` hinter einem Reverse-Proxy (echte IP für die Sperre nach Fehlversuchen) |
| `COOKIE_SECURE` | Standard an. Nur auf `0` setzen, wenn ohne HTTPS im Schulnetz betrieben |
| `STAFF_SESSION_DAYS` | Wie lange ein Gerät angemeldet bleibt, Standard 180 Tage |
| `FRAME_ANCESTORS` | Wer die Seite per iframe einbetten darf, Standard `'self'` |

## Reverse-Proxy (Caddy, HTTPS automatisch)

    klassenarbeiten.mauri-tools.de {
        reverse_proxy 127.0.0.1:3010
    }

In EduPage am besten einen **Link** auf die Seite setzen. Ein iframe funktioniert wegen der
Anmelde-Cookies in Safari und künftig auch in Chrome nicht zuverlässig.

## Inbetriebnahme

1. Verwaltung öffnen (Reiter „Verwaltung“, eigenes Passwort).
2. **Klassen, Fächer, Regeln:** Klassenliste an die tatsächlichen Klassen anpassen (vorbelegt: 5a–10d, EF, Q1, Q2).
   Häufige Fächer nach oben, sie erscheinen als Schaltflächen beim Eintragen.
3. **Schuljahr und Ferien:** NRW-Ferien 2026/27 und gesetzliche Feiertage sind vorbelegt.
   Bewegliche Ferientage, Brückentage und Sperrtage (z. B. Zeugniskonferenzen) ergänzen.
4. **Papierplan übernehmen:** Unter „Daten und Zugang“ Zeilen im Format
   `Datum; Klasse(n); Fach; Kürzel; Bemerkung` einfügen, „Prüfen“, dann „Importieren“.
   Importierte Einträge werden nicht blockiert, Regelverstöße erscheinen im Prüfbericht.
5. Kollegiums-Passwort und Adresse per Dienstmail verteilen, Papierplan mit Stichtag abhängen.

## Regeln

Grundlage ist BASS 12-63 Nr. 3: Sek I höchstens zwei Klassenarbeiten pro Woche und eine pro Tag,
Oberstufe bis zu drei Klausuren pro Woche. In der Verwaltung einstellbar:

- Bis zur normalen Grenze: wird eingetragen.
- Eine darüber (z. B. die 3. in Klasse 7): nur mit Begründung, im Plan rot markiert, im Prüfbericht gelistet.
- Darüber hinaus, in Ferien, an Feiertagen, Sperrtagen oder während eines Termins der Klasse
  (Klassenfahrt, Praktikum): nicht möglich.
- Zweite Arbeit am selben Tag: nur mit Begründung, etwa bei getrennten Kursgruppen (F/L).

Kurse über mehrere Klassen (WP, 2. Fremdsprache) werden einmal eingetragen und zählen für alle gewählten Klassen.
Die Prüfung läuft im Browser für die Live-Anzeige und noch einmal auf dem Server; gleichzeitige Einträge
zweier Lehrkräfte können die Grenze also nicht gemeinsam überschreiten.

## Anmeldung

Ein gemeinsames Kollegiums-Passwort, damit niemand ein Konto anlegen muss. Das Gerät bleibt 180 Tage angemeldet.
Das eigene Kürzel wird nur im Browser gespeichert und an den Einträgen vermerkt. Jede Änderung landet mit
Kürzel und Zeit im Protokoll der Verwaltung. Wird das Kollegiums-Passwort geändert, sind alle Geräte abgemeldet.
Nach zehn Fehlversuchen wird eine IP für 15 Minuten gesperrt.

## Sicherung

- Bei der ersten Änderung jedes Tages wird `data/backups/db-JJJJ-MM-TT.json` angelegt, die letzten 60 bleiben.
- In der Verwaltung: Sicherung herunterladen und wieder einspielen, Export als CSV für Excel.
- Zusätzlich das Docker-Volume in die normale Server-Sicherung aufnehmen.

## Neues Schuljahr

Sicherung herunterladen → „Alle Einträge löschen“ → Schuljahr, Ferien und Klassen anpassen → Kollegiums-Passwort ändern.

## Datenschutz

Es werden keine Schülerdaten verarbeitet, nur Klassen, Fächer, Termine und Lehrkräfte-Kürzel.
Kürzel und Protokoll sind trotzdem personenbezogene Daten von Beschäftigten. Vor dem Start mit der Schulleitung
klären und den Lehrerrat informieren. Die Seite lädt keine externen Schriften oder Skripte und setzt nur die beiden
Anmelde-Cookies.

## Demo ohne Server

    node tools/build-demo.js

erzeugt `dist/klassenarbeitsplaner-demo.html`: eine einzelne Datei mit Beispieldaten, die im Browser
ohne Server läuft (Verwaltungs-Passwort dort: `demo`). Gut zum Vorführen in der Konferenz.

## Dateien

- `server.js` – Webserver, Anmeldung, Speicherung
- `public/core.js` – Kalender, NRW-Feiertage, Regelprüfung, API-Logik (läuft auf Server und im Browser)
- `public/app.js`, `public/app.css`, `public/index.html` – Oberfläche
- `public/fonts/` – Atkinson Hyperlegible Next (SIL Open Font License, siehe `OFL.txt`)
- `tools/` – Demo-Daten und Demo-Build
