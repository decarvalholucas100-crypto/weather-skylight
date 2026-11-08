#!/usr/bin/env bash
# Launch the skylight full-screen in Chromium kiosk mode (Raspberry Pi OS Bookworm, Wayland/labwc).
# Started at login by ~/.config/labwc/autostart (see install.sh).
URL="${SKYLIGHT_URL:-https://weather-skylight.vercel.app/?q=medium&ws=1&geo=0}"

# Wait for the network (weather + METAR) but don't hang forever: the app works offline from cache.
for i in $(seq 1 30); do
  ping -c1 -W1 1.1.1.1 >/dev/null 2>&1 && break
  sleep 1
done

# Clear any "Chromium didn't shut down correctly" bubble after a power cut.
PREFS="$HOME/.config/chromium/Default/Preferences"
[ -f "$PREFS" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PREFS"

exec chromium-browser \
  --kiosk --noerrdialogs --disable-infobars --no-first-run \
  --disable-session-crashed-bubble --disable-features=Translate \
  --check-for-update-interval=31536000 \
  --enable-gpu-rasterization --ignore-gpu-blocklist \
  --autoplay-policy=no-user-gesture-required \
  "$URL"
