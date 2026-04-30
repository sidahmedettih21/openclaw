#!/bin/bash
echo "Stopping all visa monitors..."

# Kill any running monitor scripts
pkill -f "ultimate-monitor.sh" 2>/dev/null
pkill -f "final-monitor.sh" 2>/dev/null
pkill -f "slot-watcher.sh" 2>/dev/null
pkill -f "fast-slot-monitor.sh" 2>/dev/null
pkill -f "silent-monitor.js" 2>/dev/null
pkill -f "api_watcher.py" 2>/dev/null

# Kill Playwright/tsx processes
pkill -f "tsx src/server.ts" 2>/dev/null
pkill -f "node.*server.ts" 2>/dev/null

# Stop systemd services
systemctl --user stop ultimate-monitor 2>/dev/null
systemctl --user stop final-monitor 2>/dev/null
systemctl --user stop slot-watcher 2>/dev/null
systemctl --user stop fast-slot 2>/dev/null
systemctl --user stop silent-monitor 2>/dev/null
systemctl --user stop visa-agent 2>/dev/null
systemctl --user stop visa-api-watcher 2>/dev/null

# Disable them (optional – comment out if you don't want to disable)
systemctl --user disable ultimate-monitor 2>/dev/null
systemctl --user disable final-monitor 2>/dev/null
systemctl --user disable slot-watcher 2>/dev/null
systemctl --user disable fast-slot 2>/dev/null
systemctl --user disable silent-monitor 2>/dev/null
systemctl --user disable visa-agent 2>/dev/null
systemctl --user disable visa-api-watcher 2>/dev/null

# Kill any tmux sessions related to monitoring
tmux kill-session -t visa 2>/dev/null
tmux kill-session -t monitor 2>/dev/null
tmux kill-session -t nsa 2>/dev/null

echo "All monitors stopped."
