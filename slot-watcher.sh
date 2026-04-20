#!/bin/bash
# Monitors the appointment page and clicks the first slot when available

URL="https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt"
CHECK_INTERVAL=10  # seconds

while true; do
  # Fetch the page content
  CONTENT=$(curl -s "$URL" | grep -o "Select a slot\|appointment slots available\|No slots are currently available")

  if echo "$CONTENT" | grep -q "Select a slot"; then
    # Slot found! Focus Chrome and click
    notify-send "Slot found!" "Clicking now..."
    # Focus Chrome window (replace 'Chrome' with the exact window title)
    xdotool search --name "Google Chrome" windowactivate
    sleep 0.5
    # Simulate Tab key to focus the slot, then Enter
    xdotool key Tab Tab Tab Return
    # Send Telegram notification
    curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
      -d chat_id="$TELEGRAM_ALLOWED_USER_ID" \
      -d text="🎉 SLOT FOUND! Clicked automatically. Check Chrome."
    break
  else
    echo "$(date): No slot yet"
  fi

  sleep $CHECK_INTERVAL
done
