# ESPHome Relay Fan – Homey app

Styr vifter med flere hastigheter som er koblet til et ESP32-relékort med ESPHome
(f.eks. [Ultimate Fan Project v4](https://github.com/3ative/Ultimate-Fan-Project-V4)).

## Krav i ESPHome
Appen bruker ESPHome sin lokale REST-API. Legg til dette i YAML-en og flash på nytt:

```yaml
web_server:
  port: 80
  version: 3
  # valgfritt:
  # auth:
  #   username: admin
  #   password: hemmelig
```

Gi gjerne kortet fast IP (DHCP-reservasjon i ruteren). NB: Ultimate Fan-configen
venter 10 s etter oppstart før WiFi skrus på – vifta vises som utilgjengelig i Homey så lenge.

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
