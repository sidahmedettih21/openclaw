#!/bin/bash
echo "Testing connectivity to CDP…"
curl -s http://127.0.0.1:9222/json/version | grep -q "Browser" && echo "CDP OK" || echo "CDP FAIL – Chrome not listening"
