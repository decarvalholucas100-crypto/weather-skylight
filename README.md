# Skylight

A virtual skylight: a full-screen WebGL2 sky, viewed straight up, driven by the real sun, moon and live weather for New York.

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
| `1`–`5` | Live, Always Sunny, Clear Night, Golden Hour, Storm |
| `↑` / `↓` | brightness |
| `D` | dev panel (time of day, time speed, clouds, rain, wind, lightning, quality) |
| `I` | debug overlay (FPS, weather values, mode) |
| `F` / double-click | fullscreen |

URL parameters for testing on any screen: `?mode=storm`, `?q=medium`, `?t=19.5` (local hour), `?cloud=0.6`, `?rain=0.5`, `?wind=12`, `?windto=90`, `?speed=60`, `?dev`, `?debug`, `?ws=ws://host:port`.

## Hardware control (Pi)

Every input is a text command (`mode.next`, `mode.set storm`, `brightness.up`, `rotary.cw`, `rotary.ccw`, `rotary.press`, ...). A rotary-encoder script on the Pi can run a small WebSocket server and send these; enable with `?ws=1` (defaults to `ws://localhost:8787`, see `src/config.ts`).

## Configuration

`src/config.ts`: location and time zone, screen heading, field of view, light pollution, poll interval, easing time, quality presets (render scale, raymarch steps), brightness range.

## Licensing

All shaders are original implementations of published techniques (Bruneton/Hillaire atmosphere, Schneider-style volumetric clouds, Henyey-Greenstein phase, PCG hash). No Shadertoy code is used. Runtime dependency: SunCalc (BSD-2-Clause). Star positions are public astronomical facts.
