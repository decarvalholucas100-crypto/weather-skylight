# Capture harness

Gives us eyes on the renderer: deterministic frames, fixed viewports, side-by-side composites and
frame timings, so visual changes can be judged and performance regressions caught.

## Run (on a machine with a GPU, e.g. your laptop)

```sh
npm install
node tools/capture.mjs --baseline        # first time: capture and save as the baseline
# ... make changes ...
node tools/capture.mjs                   # capture again; composites compare against baseline
open captures/*/composites               # reference | baseline | this run, per scenario and viewport
```

Headed Chromium opens briefly for each capture (that is the real GPU rendering). Frame times in
`captures/<run>/timings.json` are from the app's own FPS counter.

Options: `--only golden-hour,overcast`, `--viewports 1080p`, `--url https://weather-skylight.vercel.app`
(capture a deployment instead of the local dev server), `--software` (headless SwiftShader, for
machines without a GPU; slow and its timings are not representative), `--compare` (rebuild
composites from the latest run without recapturing), `--settle 4000` (ms to wait before the shot).

## How determinism works

Each scenario loads the app with `freeze=1` (clock, cloud evolution, easing and dynamic resolution
all stopped), `seed=7` (fixed lightning), `snap=1` (weather applied instantly), `geo=0`, a fixed
location and date, and mocked weather feeds. Temporal anti-aliasing stays on: its jitter sequence
is deterministic, and with nothing moving it converges to a stable image. The script waits until
the final noise volume is loaded and `--frames` frames (default 120) have rendered, then pauses the
render loop and takes the shot. Two runs of the same scenario on the same machine agree to within
2/255 per channel (8-bit accumulation rounding); `diff.json` reports the mean difference and the
share of pixels that changed by more than 8/255 against the baseline, so real changes stand out.

`--notaa` captures a raw single frame instead (no temporal blending); it is noisy by design and
only useful for debugging the raymarch itself.

Scenarios live in `tools/scenarios.json`; add one by adding an entry (keys are URL parameters)
and, optionally, a reference photo in `reference/`.

## Viewports

`1080p` (TV), `4k`, and `wall` (384x240, the LED wall; also saved upscaled 5x nearest-neighbour as
`_wall_x5.png` so you can inspect it at a sane size).
