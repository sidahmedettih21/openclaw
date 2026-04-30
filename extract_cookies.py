import sqlite3
import os
import json

profile_path = os.path.expanduser("~/.config/google-chrome/tls-work/Default/Cookies")
conn = sqlite3.connect(profile_path)
cursor = conn.cursor()
cursor.execute("SELECT name, value, host, path, is_secure, expires_utc FROM cookies WHERE host LIKE '%tlscontact.com%'")
cookies = cursor.fetchall()
conn.close()

with open(os.path.expanduser("~/visa-agent/cookies.txt"), "w") as f:
    for name, value, host, path, is_secure, expires in cookies:
        f.write(f"{host}\tTRUE\t{path}\t{is_secure}\t{expires}\t{name}\t{value}\n")
print("Cookies exported to ~/visa-agent/cookies.txt")
