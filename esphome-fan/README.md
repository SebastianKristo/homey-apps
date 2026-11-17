# ESPHome Relay Fan – Homey app

Styr vifter med flere hastigheter som er koblet til et ESP32-relékort med ESPHome
(f.eks. [Ultimate Fan Project v4](https://github.com/3ative/Ultimate-Fan-Project-V4)).

## Tilkobling
Appen bruker ESPHome sin innebygde API (port 6053) – samme som Home Assistant.
Ingen endringer i YAML trengs, så lenge `api:` er med (uten `encryption:`).
Viftene finnes automatisk via mDNS, og endringer fra knappene på vifta pushes til Homey med en gang.
Homey og Home Assistant kan være koblet til samtidig.

NB: Ultimate Fan-configen venter 10 s etter oppstart før WiFi skrus på.

## To moduser (oppdages automatisk ved paring)
**Ultimate Fan** – kortet har `Master`-bryter, `Speed`-tall og `Random`-bryter.
Homey styrer disse, så knappene, LED-ene og relé-interlock på vifta fortsetter å fungere og er alltid i synk.

**Rene reléer** – hvilket som helst ESPHome-relékort. Du velger ett relé per hastighet;
appen slår alltid av alle reléer og venter (standard 500 ms) før neste slås på.

## I Homey
- Av/på (husker siste hastighet), hastighetsvelger (Av/1/2/3), glidebryter
- Tilfeldig/vind-modus (Ultimate)
- Flows: sett hastighet, øk/senk, kjør X minutter og slå av, slå tilfeldig av/på,
  betingelse «hastighet er», trigger «hastighet endret»

Én Homey-enhet per vifte – har du flere vifter, legg til én per kort.

## Installer
```bash
npm install
npx homey app install
```
