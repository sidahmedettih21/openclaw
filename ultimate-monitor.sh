#!/bin/bash
# ================================================
# ULTIMATE TLScontact Slot Monitor (Production Ready)
# ================================================

TELEGRAM_TOKEN="8362293388:AAFWYAozBBlsZM2aNvPTy10KLdjo5G-qDWE"
CHAT_ID="8092143549"
CHECK_INTERVAL=2

send_telegram() {
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
    -d chat_id="$CHAT_ID" \
    -d text="$1" \
    -d parse_mode="Markdown" > /dev/null
}

echo "🚀 Ultimate monitor started - checking every ${CHECK_INTERVAL}s"
send_telegram "🟢 *Ultimate monitor started* – checking every ${CHECK_INTERVAL}s"

while true; do
  # Force focus Chrome window
  xdotool search --name "Google Chrome" windowactivate --sync
  sleep 0.2

  # Select all + copy page text
  xdotool key ctrl+a
  sleep 0.1
  xdotool key ctrl+c
  sleep 0.15

  PAGE_TEXT=$(xclip -selection clipboard -o 2>/dev/null || echo "")

  echo "$(date '+%H:%M:%S') - Checking..."

  if echo "$PAGE_TEXT" | grep -qi "Select a slot"; then
    send_telegram "🎉 *SLOT FOUND!* Attempting to book..."
    
    # Click using safe coordinates (adjust once on real page)
    # Or use Tab method if you prefer
    xdotool key Tab Tab Tab Return
    
    send_telegram "✅ *Slot clicked!* Go complete payment in Chrome."
    break
  fi

  sleep $CHECK_INTERVAL
done
