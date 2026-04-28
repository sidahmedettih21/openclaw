#!/bin/bash
set -e

echo "Working in: $(pwd)"

# Backup current index.html
cp index.html index.html.backup-$(date +%Y%m%d-%H%M%S)
echo "Backup created"

# Use Python to replace the simulation script
python3 << 'PYEOF'
import re, os

html_path = "index.html"
with open(html_path, "r") as f:
    content = f.read()

# New simulation script (correct container detection, blue buttons, no 501 errors)
new_script = '''<script>
(function() {
    const config = {
        freqMin: 15000,
        freqMax: 45000,
        durMin: 3000,
        durMax: 8000,
        slotCount: 3
    };
    let slotsVisible = false, slotsAppearTs = null, slotExpireTimer = null, scheduleTimer = null;
    let targetContainer = null;
    let noSlotsDiv = null;

    // Find the card that contains the "No slots" message
    function findTargetContainer() {
        const paras = Array.from(document.querySelectorAll('p'));
        const noSlotsPara = paras.find(p => p.textContent.includes("No slots are currently available"));
        if (!noSlotsPara) return null;
        noSlotsDiv = noSlotsPara.parentElement;
        // Walk up to the div that has the max-width styling (the appointment card)
        let card = noSlotsPara.closest('div[style*="max-width:640px"]');
        if (!card) card = noSlotsPara.closest('div[style*="margin-left: auto"]');
        return card;
    }

    function getTarget() {
        if (!targetContainer) targetContainer = findTargetContainer();
        return { card: targetContainer, noSlotsMsg: noSlotsDiv };
    }

    const slotGrid = document.createElement("div");
    slotGrid.id = "sim-slot-grid";
    slotGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;justify-content:center;padding:20px 0;margin:0 auto;max-width:560px";

    function rand(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }

    function showSlots() {
        if (slotsVisible) return;
        const target = getTarget();
        if (!target.card) { console.error("[SIM] Target card not found"); return; }

        slotsVisible = true;
        slotsAppearTs = Date.now();
        if (target.noSlotsMsg) target.noSlotsMsg.style.display = "none";

        const duration = rand(config.durMin, config.durMax);
        const times = ["07:30","08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","13:00","13:30","14:00","14:30","15:00"];
        const selected = [...times].sort(() => 0.5 - Math.random()).slice(0, config.slotCount);
        slotGrid.innerHTML = "";
        selected.forEach(time => {
            const btn = document.createElement("button");
            btn.className = "sim-slot-btn";
            btn.textContent = time;
            // Real TLScontact slots are BLUE (brand colour #003087 or #0057B8)
            btn.style.cssText = "background-color:#0057B8;color:#fff;border:none;border-radius:4px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;min-width:80px;transition:background-color 0.15s";
            btn.onmouseover = () => { if (!btn.classList.contains("selected")) btn.style.backgroundColor = "#003087"; };
            btn.onmouseout  = () => { if (!btn.classList.contains("selected")) btn.style.backgroundColor = "#0057B8"; };
            btn.onclick = () => onSlotClick(btn, time);
            slotGrid.appendChild(btn);
        });
        target.card.prepend(slotGrid);

        // Try to send event, but ignore errors (simple HTTP server doesn't accept POST)
        fetch("/log-event", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ type:"slot_appeared", data:{ slots:selected, duration } }) }).catch(()=>{});

        slotExpireTimer = setTimeout(() => hideSlots("expired"), duration);
    }

    function hideSlots(reason) {
        if (!slotsVisible) return;
        slotsVisible = false;
        if (slotExpireTimer) clearTimeout(slotExpireTimer);
        if (slotGrid.parentNode) slotGrid.remove();
        const target = getTarget();
        if (target.noSlotsMsg) target.noSlotsMsg.style.display = "";
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
            b.style.backgroundColor = "#0057B8";
        });
        btn.classList.add("selected");
        btn.style.backgroundColor = "#003087";
        const bookBtn = document.querySelector('button[type="submit"]');
        if (bookBtn) {
            bookBtn.disabled = false;
            bookBtn.style.backgroundColor = "#003087";
            bookBtn.style.color = "#fff";
            bookBtn.style.borderColor = "#003087";
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
    console.log("[SIM] Running. Use forceSlot() to trigger slots.");
})();
</script>'''

# Find the existing script block that contains "forceSlot" (the simulation script)
# We'll replace from the first '<script' that contains 'forceSlot' to the next '</script>'
import re
pattern = r'(<script\b[^>]*>[\s\S]*?forceSlot[\s\S]*?</script>)'
match = re.search(pattern, content, re.IGNORECASE)
if match:
    new_content = content[:match.start()] + new_script + content[match.end():]
    print("Replaced existing simulation script.")
else:
    # Fallback: replace the last script before </body>
    pattern2 = r'(<script>[\s\S]*?</script>)(?=\s*</body>)'
    new_content = re.sub(pattern2, new_script, content, count=1)
    print("Replaced last script before </body>.")

with open(html_path, "w") as f:
    f.write(new_content)
print("✅ index.html updated successfully.")
PYEOF

echo ""
echo "=========================================================="
echo "✅ Simulation fixed."
echo ""
echo "Now start the server:"
echo "   python3 -m http.server 8080"
echo ""
echo "Open http://localhost:8080 in Chrome (with remote debugging)."
echo "In the console, type: forceSlot()"
echo "Orange/blue buttons will appear. Your bot (correct-monitor.js) will detect them if you update it to look for '.sim-slot-btn'."
echo "=========================================================="
