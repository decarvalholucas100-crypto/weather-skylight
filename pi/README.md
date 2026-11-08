# Raspberry Pi 5 install

Turns a Pi 5 into a dedicated skylight: boots straight into the sky, full screen, with a rotary
encoder for brightness and modes.

## Hardware

- Raspberry Pi 5 (4 GB is plenty), official 27 W power supply, active cooler
- Display: HDMI TV / panel, or an LED matrix wall via its HDMI receiver card (e.g. 384×240)
- KY-040 rotary encoder with push button

| Encoder pin | Pi pin (BCM) |
| --- | --- |
| CLK | GPIO17 |
| DT | GPIO27 |
| SW | GPIO22 |
| + | 3.3 V |
| GND | GND |

## Install

1. Flash **Raspberry Pi OS (64-bit, desktop, Bookworm)** with Raspberry Pi Imager. In the imager's
   settings set Wi-Fi, a user, and enable auto-login to the desktop.
2. Copy this `pi/` folder to the Pi (or `git clone` the repo) and run:
   ```sh
   cd weather-skylight/pi
   bash install.sh
   sudo reboot
   ```
3. The Pi boots into the skylight. The rotary encoder controls it immediately.

## Controls on the encoder

| Action | Effect |
| --- | --- |
| Turn right / left | Brightness up / down |
| Short press | Next mode |
| Hold 1.5 s | Back to Live |

## Configuration

- **URL**: `kiosk.sh` opens `https://weather-skylight.vercel.app/?q=medium&ws=1&geo=0`.
  Override with `SKYLIGHT_URL=... ` in `~/.config/labwc/autostart`.
  - `q=medium` is the Pi quality preset; `q=low` is the fallback if the frame rate is poor.
  - `ws=1` connects to the local encoder bridge.
  - `geo=0` skips browser geolocation (a kiosk can't answer the permission prompt).
- **Location** (kept on the Pi, never in the repo): create `~/.config/skylight.env` with
  ```sh
  SKYLIGHT_LAT=40.71
  SKYLIGHT_LON=-74.01
  SKYLIGHT_TZ=America/New_York
  ```
  Two decimals (about 1 km) is plenty.
- **LED wall (e.g. 384×240)**: set the Pi's HDMI output to the wall's input resolution; the app
  renders at the output size automatically, so a small wall costs very little GPU.
- **Pins / port**: `SKY_PIN_A`, `SKY_PIN_B`, `SKY_PIN_SW`, `SKY_PORT` environment variables in
  `~/.config/systemd/user/skylight-rotary.service`.

## Offline behaviour

The last weather reading and location are cached in the browser. Without network the sky keeps
the last known weather and keeps tracking the real sun, moon and stars (computed locally).
For a fully offline install, build the app (`npm run build`) and serve `dist/` locally, then
point `SKYLIGHT_URL` at it.

## Troubleshooting

- Logs for the encoder bridge: `journalctl --user -u skylight-rotary -f`
- Test the bridge without the page: `python3 -m websockets ws://127.0.0.1:8787` then turn the knob.
- Press `I` on a keyboard to see FPS. The app lowers its own render resolution to hold 30 fps
  (`dyn` in the overlay).
