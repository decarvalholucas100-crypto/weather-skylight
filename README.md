# Skylight

A virtual skylight: a full-screen WebGL2 sky, viewed straight up, driven by the real sun, moon, stars, planets and live weather wherever it's installed.

## What drives the sky

- **Sun, moon, stars, planets**: computed locally (SunCalc; JPL elements for Venus, Mars, Jupiter, Saturn; real bright-star catalog rotated by sidereal time).
- **Weather**: Open-Meteo every 15 min (cloud layers, precipitation, wind, visibility, temperature, CAPE / lifted index), eased in over ~3 min.
- **Cloud layers**: the nearest airport METAR (via `api/metar.js`, a Vercel function relaying aviationweather.gov) gives real layer coverage and base heights, plus towering cumulus / cumulonimbus flags. Instability (CAPE) decides puffy cumulus vs flat stratus.
- **Location**: the browser's location if allowed (asked once, cached, refreshed every 30 min), else the address in `src/config.ts`. `?geo=0` skips the prompt (kiosks).
- **Offline**: last weather and location are cached; astronomy keeps running without network.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
```

## Controls

| Key | Action |
| --- | --- |
| `M` / `→` | next mode |
| `N` / `←` | previous mode |
| `1`–`7` | Live, Always Sunny, Partly Cloudy, Clear Night, Cloudy Night, Golden Hour, Storm |
| `↑` / `↓` | brightness |
| `D` | dev panel (time of day, time speed, clouds, rain, wind, lightning, quality) |
| `I` | debug overlay (FPS, weather values, mode) |
| `F` / double-click | fullscreen |

URL parameters: `?lat=&lon=&tz=` (fixed location, e.g. for a kiosk), `?geo=0`, `?snap` (apply weather instantly), `?mid=`, `?high=`, `?fov=`, `?mode=storm`, `?q=medium`, `?t=19.5` (local hour), `?cloud=0.6`, `?rain=0.5`, `?wind=12`, `?windto=90`, `?speed=60`, `?dev`, `?debug`, `?ws=ws://host:port`.

## Raspberry Pi

See [`pi/README.md`](pi/README.md): one-script install, Chromium kiosk autostart, rotary encoder bridge.

## Hardware control (Pi)

Every input is a text command (`mode.next`, `mode.set storm`, `brightness.up`, `rotary.cw`, `rotary.ccw`, `rotary.press`, ...). A rotary-encoder script on the Pi can run a small WebSocket server and send these; enable with `?ws=1` (defaults to `ws://localhost:8787`, see `src/config.ts`).

## Configuration

`src/config.ts`: location and time zone, screen heading, field of view, light pollution, poll interval, easing time, quality presets (render scale, raymarch steps), brightness range.

## Licensing

All shaders are original implementations of published techniques (Bruneton/Hillaire atmosphere, Schneider-style volumetric clouds, Henyey-Greenstein phase, PCG hash). No Shadertoy code is used. Runtime dependency: SunCalc (BSD-2-Clause). Star positions are public astronomical facts.
