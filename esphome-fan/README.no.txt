Styr vifter med flere hastigheter (ståvifter, pultvifter) som er koblet til et ESP32-relékort med ESPHome.

Fungerer rett ut av boksen med ESPHome-firmwaren «Ultimate Fan Project»: Homey styrer Master-bryteren, hastigheten og tilfeldig-modus, så knappene, LED-ene og relé-sperren på vifta fortsetter å virke og er alltid i synk. Andre ESPHome-relékort kan også brukes – velg ett relé per hastighet, så sørger appen for at bare ett er på om gangen.

Funksjoner:
- Av/på (husker siste hastighet), hastighetsvelger og glidebryter
- Tilfeldig/vind-modus
- Svingning (eget relé, f.eks. Relay4)
- Flows: sett hastighet, øk/senk, kjør X minutter og slå av, tilfeldig modus av/på, betingelsen «hastighet er» og triggeren «hastighet endret»

Bruker ESPHome sin innebygde API (port 6053) – samme tilkobling som Home Assistant. Ingen endringer i ESPHome-konfigurasjonen trengs. Viftene finnes automatisk på nettverket, og knappetrykk på vifta vises i Homey med en gang.
