#!/bin/bash
CHROME_BIN="/usr/bin/google-chrome"
PROFILE_DIR="$HOME/.config/google-chrome/tls-work"
APPOINTMENT_URL="https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt"

# Kill existing Chrome using the same profile (to avoid conflicts)
pkill -f "user-data-dir=$PROFILE_DIR" 2>/dev/null

# Start Chrome with remote debugging
$CHROME_BIN --remote-debugging-port=9222 --user-data-dir="$PROFILE_DIR" "$APPOINTMENT_URL" &

# Wait 5 seconds
sleep 5

# Run the monitor binary
./visa-monitor-linux
