@echo off
setlocal

:: Configuration
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE_DIR=%USERPROFILE%\.config\google-chrome\tls-work
set APPOINTMENT_URL=https://visas-pt.tlscontact.com/en-us/388184/workflow/appointment-booking?location=dzALG2pt

:: Kill any existing Chrome instance using the same profile (optional)
taskkill /f /im chrome.exe 2>nul

:: Start Chrome with remote debugging
start "" %CHROME_PATH% --remote-debugging-port=9222 --user-data-dir="%PROFILE_DIR%" "%APPOINTMENT_URL%"

:: Wait for Chrome to fully open
timeout /t 5 /nobreak >nul

:: Run the monitor binary
visa-monitor-win.exe
