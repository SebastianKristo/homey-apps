Styr vifter med flere hastigheter (ståvifter, pultvifter) som er koblet til et ESP32-relékort med ESPHome.

Fungerer rett ut av boksen med ESPHome-firmwaren «Ultimate Fan Project»: Homey styrer Master-bryteren, hastigheten og tilfeldig-modus, så knappene, LED-ene og relé-sperren på vifta fortsetter å virke og er alltid i synk. Andre ESPHome-relékort kan også brukes – velg ett relé per hastighet, så sørger appen for at bare ett er på om gangen.

Funksjoner:
- Av/på (husker siste hastighet), hastighetsvelger og glidebryter
- Tilfeldig/vind-modus
- Flows: sett hastighet, øk/senk, kjør X minutter og slå av, tilfeldig modus av/på, betingelsen «hastighet er» og triggeren «hastighet endret»

Krav: legg til «web_server:» (port 80) i ESPHome-konfigurasjonen på kortet.
