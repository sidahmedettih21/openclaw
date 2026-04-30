#!/bin/bash
# Ultra-fast slot monitor – refreshes every 1 second, clicks instantly

URL="https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt"
CHECK_INTERVAL=1   # seconds – change to 0.5 if you dare
TELEGRAM_TOKEN="8362293388:AAFWYAozBBlsZM2aNvPTy10KLdjo5G-qDWE"
CHAT_ID="8092143549"

# Function to send Telegram message
send_telegram() {
    curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
        -d chat_id="$CHAT_ID" -d text="$1" -d parse_mode="Markdown" &>/dev/null
}

# Focus Chrome window (adjust window name if needed)
focus_chrome() {
    xdotool search --name "Google Chrome" windowactivate 2>/dev/null
}

echo "Fast slot monitor started. Refreshing every ${CHECK_INTERVAL}s"
send_telegram "🟢 *Fast slot monitor started* – checking every ${CHECK_INTERVAL}s"

while true; do
    # Focus Chrome, refresh page (F5), wait a tiny bit for DOM
    focus_chrome
    sleep 0.1
    xdotool key F5
    sleep 0.3   # wait for page to reload – adjust as needed (0.2–0.5s)

    # Copy visible text from the page (simulates what human sees)
    # Using xclip to get selected text, but easier: use xdotool to select all and copy
    xdotool key ctrl+a
    sleep 0.05
    xdotool key ctrl+c
    sleep 0.05
    PAGE_TEXT=$(xclip -selection clipboard -o 2>/dev/null)

    if echo "$PAGE_TEXT" | grep -qi "Select a slot"; then
        send_telegram "🎉 *SLOT FOUND!* Attempting to click..."
        # Click the first slot (Tab three times then Enter)
        xdotool key Tab Tab Tab Return
        send_telegram "✅ *Slot clicked!* Complete payment manually."
        break
    fi

    # Optional: print timestamp to console (no notification)
    echo "$(date '+%H:%M:%S'): No slot"

    sleep $CHECK_INTERVAL
done
