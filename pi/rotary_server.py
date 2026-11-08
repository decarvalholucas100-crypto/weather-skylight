#!/usr/bin/env python3
"""Rotary encoder -> skylight control bridge for Raspberry Pi 5.

Reads a KY-040 style rotary encoder (with push button) on GPIO and broadcasts the same text
commands the keyboard produces to every connected skylight page over a local WebSocket:

    turn clockwise        -> rotary.cw      (brightness up)
    turn counter-clockwise-> rotary.ccw     (brightness down)
    short press           -> rotary.press   (next mode)
    long press (>1.5 s)   -> mode.set live  (back to Live)

The page connects when opened with ?ws=1 (defaults to ws://localhost:8787).

Wiring (BCM numbering, change below if needed):
    encoder CLK -> GPIO17   encoder DT -> GPIO27   encoder SW -> GPIO22
    encoder +   -> 3.3V     encoder GND -> GND

Requires: python3-gpiozero (preinstalled on Raspberry Pi OS) and websockets:
    sudo apt install -y python3-websockets
"""
import asyncio
import os

import websockets
from gpiozero import Button, RotaryEncoder

PIN_A = int(os.environ.get("SKY_PIN_A", 17))
PIN_B = int(os.environ.get("SKY_PIN_B", 27))
PIN_SW = int(os.environ.get("SKY_PIN_SW", 22))
PORT = int(os.environ.get("SKY_PORT", 8787))

clients: set = set()
loop: asyncio.AbstractEventLoop


def send(cmd: str) -> None:
    """Called from gpiozero's threads; hop onto the asyncio loop to broadcast."""
    loop.call_soon_threadsafe(asyncio.ensure_future, broadcast(cmd))


async def broadcast(cmd: str) -> None:
    dead = []
    for ws in list(clients):
        try:
            await ws.send(cmd)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def handler(ws):
    clients.add(ws)
    try:
        async for _ in ws:  # the page doesn't send anything; just keep the socket open
            pass
    finally:
        clients.discard(ws)


async def main() -> None:
    global loop
    loop = asyncio.get_running_loop()

    enc = RotaryEncoder(PIN_A, PIN_B, max_steps=0)
    enc.when_rotated_clockwise = lambda: send("rotary.cw")
    enc.when_rotated_counter_clockwise = lambda: send("rotary.ccw")

    btn = Button(PIN_SW, pull_up=True, bounce_time=0.03, hold_time=1.5)
    held = {"v": False}

    def on_held():
        held["v"] = True
        send("mode.set live")

    def on_released():
        if not held["v"]:
            send("rotary.press")
        held["v"] = False

    btn.when_held = on_held
    btn.when_released = on_released

    async with websockets.serve(handler, "127.0.0.1", PORT):
        print(f"skylight rotary bridge on ws://127.0.0.1:{PORT}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
