#!/bin/bash
cd ~/visa-agent
export DISPLAY=:0
export XAUTHORITY=$HOME/.Xauthority
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus
npx tsx src/server.ts
