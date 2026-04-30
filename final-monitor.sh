#!/bin/bash
# FINAL MONITOR – no Playwright, no Cloudflare issues
# Uses curl to fetch page, xdotool to click

URL="https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt"
CHECK_INTERVAL=2   # seconds (adjust if needed)
TELEGRAM_TOKEN="8362293388:AAFWYAozBBlsZM2aNvPTy10KLdjo5G-qDWE"
CHAT_ID="8092143549"

send_telegram() {
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
    -d chat_id="$CHAT_ID" -d text="$1" -d parse_mode="Markdown" > /dev/null
}

echo "Final monitor started. Checking every ${CHECK_INTERVAL}s"
send_telegram "🟢 *Final monitor started* – checking every ${CHECK_INTERVAL}s"

while true; do
  # Fetch page content (simple, fast)
  PAGE=$(curl -s -L --max-time 5 "$URL" | grep -o "Select a slot\|appointment slots available\|No slots are currently available")

  if echo "$PAGE" | grep -q "Select a slot"; then
    send_telegram "🎉 *SLOT FOUND!* Clicking now..."
    # Focus the Chrome window (adjust window title if needed)
    xdotool search --name "Google Chrome" windowactivate 2>/dev/null
    sleep 0.2
    # Tab 3 times to focus slot, then Enter
    xdotool key Tab Tab Tab Return
    send_telegram "✅ *Slot clicked!* Check Chrome to complete payment."
    break
  else
    echo "$(date '+%H:%M:%S'): No slot"
  fi

  sleep $CHECK_INTERVAL
done
