#!/usr/bin/env bash
# One-time setup on a Raspberry Pi 5 running Raspberry Pi OS (Bookworm, desktop).
# Run as the desktop user (not root):   bash install.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "== packages"
sudo apt-get update
sudo apt-get install -y chromium-browser python3-gpiozero python3-websockets unclutter

echo "== kiosk autostart (labwc / Wayland)"
mkdir -p "$HOME/.config/labwc"
AUTOSTART="$HOME/.config/labwc/autostart"
touch "$AUTOSTART"
grep -q skylight-kiosk "$AUTOSTART" || echo "bash $DIR/kiosk.sh &  # skylight-kiosk" >> "$AUTOSTART"

echo "== rotary encoder bridge (systemd user service)"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/skylight-rotary.service" <<UNIT
[Unit]
Description=Skylight rotary encoder bridge
After=default.target

[Service]
ExecStart=/usr/bin/python3 $DIR/rotary_server.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now skylight-rotary.service
sudo loginctl enable-linger "$USER"

echo "== screen: never blank"
sudo raspi-config nonint do_blanking 1 || true

echo "Done. Reboot to start the skylight:  sudo reboot"
