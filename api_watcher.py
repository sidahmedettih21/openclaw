#!/usr/bin/env python3
import os
import time
import json
import requests
import yaml
from datetime import datetime

# Load config
with open("config.yaml", "r") as f:
    config = yaml.safe_load(f)

TELEGRAM_TOKEN = os.getenv(config["telegram"]["token_env"])
CHAT_ID = os.getenv(config["telegram"]["chat_id_env"])
# Use localhost address defined in the service file
API_WATCHER_URL = "http://127.0.0.1:7432/run"

def notify(text):
    if not config["telegram"]["enabled"]:
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        requests.post(url, json={"chat_id": CHAT_ID, "text": text, "parse_mode": "Markdown"}, timeout=10)
    except Exception as e:
        print(f"Telegram notification failed: {e}")

def trigger_check():
    try:
        # Use a POST request to trigger the slot check
        response = requests.post(API_WATCHER_URL, timeout=15)
        if response.status_code != 200:
            notify(f"❌ API watcher error: Status {response.status_code}")
            return False
        # The response is just an acknowledgment, not the result of the check.
        return True
    except Exception as e:
        notify(f"❌ API watcher connection error: {e}")
        return False

if __name__ == "__main__":
    notify("🟢 API watcher started – triggering checks every 5s")
    while True:
        trigger_check()
        time.sleep(config["general"]["check_interval_seconds"])
