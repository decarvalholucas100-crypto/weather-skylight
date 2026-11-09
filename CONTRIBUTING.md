# Contributing

Thanks for helping make the sky more real. This is a real-time renderer driven by live data,
so every improvement has to work for *any* weather, time and location, and stay fast enough
for a Raspberry Pi 5 (about 1/30th of a laptop GPU).

## Getting started

```sh
npm install
npm run dev
```

Open http://localhost:5173 and press `D` for the dev panel (time of day, speed-up, cloud cover,
cloud type, rain, wind, city) and `I` for the debug overlay (FPS, live weather, METAR, version).
Useful URL parameters: `?mode=storm`, `?t=19.5` (local hour), `?cloud=0.6`, `?high=0.5` (cirrus),
`?mid=0.5` (altocumulus), `?q=medium` (Pi preset), `?snap` (apply weather instantly), `?geo=0`.

## Where things live

| Area | Files |
| --- | --- |
| Sky color (atmosphere) | `src/shaders/skylut.frag`, `src/atmosphere.ts` |
| Clouds (volumetric low layer, altocumulus, scud) | `src/shaders/sky.frag` |
| Cirrus (instanced strands) | `src/shaders/cirrus.vert`, `src/shaders/cirrus.frag` |
| Rain on glass, moon, Milky Way, upscale | `src/shaders/composite.frag` |
| Stars and planets | `src/shaders/stars.*`, `src/stars.ts`, `src/planets.ts`, `src/data/stars6.ts` |
| Lighting terms, exposure, night | `src/lighting.ts` |
| Weather → sky parameters, modes | `src/state.ts`, `src/weather.ts`, `api/metar.js` |
| Location, cities, light pollution | `src/location.ts`, `src/cities.ts` |
| Render passes, quality presets | `src/render/renderer.ts`, `src/config.ts` |
| Raspberry Pi kit | `pi/` |

## Help wanted

Ordered by impact. Open an issue to discuss before starting anything big.

1. **More realistic cumulus.** Shapes come from tiled noise. The big step is physically
   simulated cloud volumes (e.g. from a fluid / large-eddy simulation, baked to 3D textures)
   that the renderer lights live and morphs between.
2. **Cloud lighting.** Better multiple scattering, silver linings, and sunset colors on cloud
   bases. Reference photos of skies taken straight up are the target.
3. **Raspberry Pi 5 performance.** Profile on real hardware (Chromium, V3D GPU) and tune the
   `medium` preset to hold 30 fps at 1080p.
4. **Snow and fog.** Snow falling past / sticking to the glass; ground fog and low stratus.
5. **Astronomy extras.** ISS and satellite passes, meteor showers, planet phases, aurora at
   high latitudes.
6. **Light pollution data.** Replace the city-distance estimate in `src/cities.ts` with a real
   (openly licensed) light pollution dataset.
7. **More weather sources** outside the US (METAR works worldwide; other observation feeds
   welcome).

## Guidelines

- Keep it real-time and data-driven: no pre-rendered video or photo textures.
- Check the Pi preset (`?q=medium`) and the debug overlay's FPS / `dyn` value after visual changes.
- Original code only. If you adapt someone else's shader or data, check its license first:
  many Shadertoy shaders are non-commercial (CC BY-NC-SA), which is incompatible with MIT.
  Add attribution to THIRD_PARTY_NOTICES.md.
- Small, focused pull requests with before/after screenshots.
- `npm run build` must pass (it type-checks).

By contributing you agree your contribution is licensed under the MIT License.
