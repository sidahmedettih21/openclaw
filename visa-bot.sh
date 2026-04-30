#!/bin/bash
# Launch Chrome with remote debugging
google-chrome --remote-debugging-port=9222 --user-data-dir=/home/samsepi0l/.config/google-chrome/tls-work "https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt" &

# Wait for Chrome to start
sleep 5

# Run the monitor
./visa-monitor-linux
