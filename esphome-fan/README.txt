Control multi-speed fans (tower fans, desk fans) that are wired to an ESP32 relay board running ESPHome.

Works out of the box with the "Ultimate Fan Project" ESPHome firmware: Homey controls the Master switch, Speed and Random mode, so the physical buttons, LEDs and relay interlock on the fan keep working and stay in sync. Any other ESPHome relay board can be used too – pick one relay per speed and the app makes sure only one is on at a time.

Features:
- On/off (remembers the last speed), speed picker and slider
- Random / wind mode
- Flows: set speed, speed up/down, run for X minutes then turn off, random mode on/off, "speed is" condition and "speed changed" trigger

Requirement: add "web_server:" (port 80) to the ESPHome config of the board.
