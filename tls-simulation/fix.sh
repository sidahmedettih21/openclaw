#!/bin/bash
# Run this script from inside the tls-simulation directory

set -e

# Check if we are in the correct directory
if [ ! -f index.html ]; then
    echo "Error: index.html not found in current directory."
    echo "Please cd into ~/visa-agent/tls-simulation first, then run this script."
    exit 1
fi

echo "Working in: $(pwd)"

# Backup original
cp index.html index.html.backup-$(date +%Y%m%d-%H%M%S)
echo "Backup created"

# Write the new script content to a temporary file
cat > /tmp/new_script.js << 'EOF'
<script>
(function() {
    const config = {
        freqMin: 15000,
        freqMax: 45000,
        durMin: 3000,
        durMax: 8000,
        slotCount: 3
    };
    let slotsVisible = false, slotsAppearTs = null, slotExpireTimer = null, scheduleTimer = null;

    function getCalendarContent() {
        for (const p of document.querySelectorAll('p')) {
            if (p.textContent.includes("We currently don't have any appointment slots available")) {
                return { noSlotsMsg: p.parentElement, card: p.closest('div[style*="padding-bottom:48px"]') };
            }
        }
        return null;
    }

    const slotGrid = document.createElement("div");
    slotGrid.id = "sim-slot-grid";
    slotGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;justify-content:center;padding:16px;margin:0 auto;max-width:560px";

    function rand(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }

    function showSlots() {
        if (slotsVisible) return;
        const refs = getCalendarContent();
        if (!refs) { console.error("[SIM] Calendar container not found"); return; }
        slotsVisible = true;
        slotsAppearTs = Date.now();
        refs.noSlotsMsg.style.display = "none";
        const duration = rand(config.durMin, config.durMax);
        const times = ["07:30","08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","13:00","13:30","14:00","14:30","15:00"];
        const selected = [...times].sort(() => 0.5 - Math.random()).slice(0, config.slotCount);
        slotGrid.innerHTML = "";
        selected.forEach(time => {
            const btn = document.createElement("button");
            btn.className = "sim-slot-btn";
            btn.textContent = time;
            btn.style.cssText = "background-color:rgb(235,96,0);color:rgb(255,255,255);border:none;border-radius:4px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer;font-family:'Open Sans','Open Sans Fallback',sans-serif;min-width:80px;line-height:1.4;transition:background-color 0.15s ease";
            btn.onmouseover = () => { if (!btn.classList.contains("selected")) btn.style.backgroundColor = "rgb(198,75,0)"; };
            btn.onmouseout  = () => { if (!btn.classList.contains("selected")) btn.style.backgroundColor = "rgb(235,96,0)"; };
            btn.onclick = () => onSlotClick(btn, time);
            slotGrid.appendChild(btn);
        });
        refs.card.prepend(slotGrid);
        fetch("/log-event", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ type:"slot_appeared", data:{ slots:selected, duration } }) }).catch(()=>{});
        slotExpireTimer = setTimeout(() => hideSlots("expired"), duration);
    }

    function hideSlots(reason) {
        if (!slotsVisible) return;
        slotsVisible = false;
        if (slotExpireTimer) clearTimeout(slotExpireTimer);
        slotGrid.remove();
        const refs = getCalendarContent();
        if (refs) refs.noSlotsMsg.style.display = "";
        const bookBtn = document.querySelector('button[type="submit"]');
        if (bookBtn) {
            bookBtn.disabled = true;
            bookBtn.style.cssText = "border-color:rgb(209,213,219);background-color:rgb(243,244,246);color:rgb(156,163,175);cursor:auto";
        }
        fetch("/log-event", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ type:"slot_expired", data:{ reason } }) }).catch(()=>{});
    }

    function onSlotClick(btn, time) {
        if (!slotsVisible) return;
        const reactTime = slotsAppearTs ? Date.now() - slotsAppearTs : null;
        slotGrid.querySelectorAll(".sim-slot-btn").forEach(b => {
            b.classList.remove("selected");
            b.style.backgroundColor = "rgb(235,96,0)";
        });
        btn.classList.add("selected");
        btn.style.backgroundColor = "rgb(10,48,143)";
        const bookBtn = document.querySelector('button[type="submit"]');
        if (bookBtn) {
            bookBtn.disabled = false;
            bookBtn.style.backgroundColor = "rgb(10,48,143)";
            bookBtn.style.color = "rgb(255,255,255)";
            bookBtn.style.borderColor = "rgb(10,48,143)";
            bookBtn.style.cursor = "pointer";
            if (!bookBtn._simBound) {
                bookBtn._simBound = true;
                bookBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    fetch("/log-event", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ type:"book_clicked", data:{ time, reactTime: Date.now() - slotsAppearTs } }) }).catch(()=>{});
                    alert("✅ SIMULATION: Appointment booked! The bot would stop here.");
                    hideSlots("booked");
                });
            }
        }
        fetch("/log-event", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ type:"slot_clicked", data:{ time, reactTime } }) }).catch(()=>{});
    }

    function scheduleNext() {
        const delay = rand(config.freqMin, config.freqMax);
        scheduleTimer = setTimeout(() => { if (!slotsVisible) showSlots(); scheduleNext(); }, delay);
    }

    scheduleNext();
    window.forceSlot = () => {
        if (scheduleTimer) clearTimeout(scheduleTimer);
        if (slotsVisible) hideSlots("manual");
        showSlots();
        scheduleNext();
    };
    console.log("[SIM] Running. Use forceSlot() in console to trigger slots immediately.");
})();
</script>
EOF

# Use Python to replace the old script block in index.html
python3 << 'PYEOF'
import re, os
html_path = "index.html"
if not os.path.exists(html_path):
    print("Error: index.html not found")
    exit(1)
with open(html_path, "r") as f:
    content = f.read()

with open("/tmp/new_script.js", "r") as f:
    new_script = f.read()

# Try to replace the existing simulation script (the one with forceSlot)
pattern = r"<script>\s*\(function\(\) \{[\s\S]*?forceSlot[\s\S]*?</script>"
if re.search(pattern, content):
    new_content = re.sub(pattern, new_script, content)
    print("Replaced existing script block (found forceSlot).")
else:
    # Fallback: replace the last <script> before </body>
    pattern2 = r"(<script>[\s\S]*?</script>)(?=\s*</body>)"
    if re.search(pattern2, content):
        new_content = re.sub(pattern2, new_script, content)
        print("Replaced the last script before </body>.")
    else:
        # If nothing found, append before </body>
        new_content = content.replace("</body>", new_script + "\n</body>")
        print("Appended new script before </body>.")
with open(html_path, "w") as f:
    f.write(new_content)
print("index.html updated successfully.")
PYEOF

echo ""
echo "✅ Simulation script updated."
echo ""
echo "⚠️  IMPORTANT: You must also update your bot's detection logic:"
echo "   In correct-monitor.js, replace the text detection with:"
echo ""
echo "     const hasSlot = await page.$('.sim-slot-btn') !== null;"
echo ""
echo "   This detects the orange buttons in the simulation."
echo "   On the real site, replace '.sim-slot-btn' with the actual class name of the time buttons (inspect with F12)."
echo ""
echo "To test the simulation:"
echo "   cd ~/visa-agent/tls-simulation"
echo "   python3 -m http.server 8080"
echo "   Open http://localhost:8080 in Chrome (with remote debugging)"
echo "   In console: forceSlot()"
echo "   Run your bot against localhost:8080"
echo "=================================================="
