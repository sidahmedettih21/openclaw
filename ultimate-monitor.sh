#!/bin/bash
# FINAL WORKING MONITOR – tested, complete

TELEGRAM_TOKEN="8362293388:AAFWYAozBBlsZM2aNvPTy10KLdjo5G-qDWE"
CHAT_ID="8092143549"
CHECK_INTERVAL=2

send_telegram() {
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
    -d chat_id="$CHAT_ID" -d text="$1" -d parse_mode="Markdown" > /dev/null
}

echo "Ultimate monitor started. Checking every ${CHECK_INTERVAL}s"
send_telegram "🟢 *Ultimate monitor started* – checking every ${CHECK_INTERVAL}s"

while true; do
  xdotool search --name "Google Chrome" windowactivate
  sleep 0.3
  xdotool key ctrl+a
  sleep 0.1
  xdotool key ctrl+c
  sleep 0.1
  PAGE_TEXT=$(xclip -selection clipboard -o 2>/dev/null)

  echo "$(date '+%H:%M:%S'): Checking..."
  echo "$PAGE_TEXT" | head -c 200
  echo "..."

  if echo "$PAGE_TEXT" | grep -qi "Select a slot"; then
    send_telegram "🎉 *SLOT FOUND!* Attempting to click..."
    xdotool key Tab Tab Tab Return
    send_telegram "✅ *Slot clicked!* Check Chrome to complete payment."
    break
  else
    echo "No slot yet"
  fi

  sleep $CHECK_INTERVAL
done
