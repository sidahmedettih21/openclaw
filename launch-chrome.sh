#!/bin/bash
# Launch Chrome with the correct profile and appointment page
# Run this once manually, then leave the window open.

google-chrome \
  --user-data-dir=/home/samsepi0l/.config/google-chrome/tls-work \
  --no-first-run \
  --disable-blink-features=AutomationControlled \
  "https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt"
