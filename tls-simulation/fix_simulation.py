#!/usr/bin/env python3
import re

html_path = "index.html"
with open(html_path, "r") as f:
    content = f.read()

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

    // Use the actual classes from the real TLScontact HTML
    function getTargetContainer() {
        // The "no slots" message is inside div.style-180
        const noSlotsDiv = document.querySelector('.style-180');
        if (noSlotsDiv) {
            // The container for everything is div.style-179
            const card = noSlotsDiv.closest('.style-179');
            if (card) return { parent: card, noSlotsMsg: noSlotsDiv };
        }
        console.error("[SIM] Container .style-179 not found");
        return null;
    }

    const slotGrid = document.createElement("div");
    slotGrid.id = "sim-slot-grid";
    slotGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;justify-content:center;padding:16px;margin:0 auto;max-width:560px";

    function rand(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }

    function showSlots() {
        if (slotsVisible) return;
        const target = getTargetContainer();
        if (!target) return;

        slotsVisible = true;
        slotsAppearTs = Date.now();
        target.noSlotsMsg.style.display = "none";

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
        target.parent.prepend(slotGrid);

        fetch("/log-event", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ type:"slot_appeared", data:{ slots:selected, duration } }) }).catch(()=>{});
        slotExpireTimer = setTimeout(() => hideSlots("expired"), duration);
    }

    function hideSlots(reason) {
        if (!slotsVisible) return;
        slotsVisible = false;
        if (slotExpireTimer) clearTimeout(slotExpireTimer);
        if (slotGrid.parentNode) slotGrid.remove();
        const target = getTargetContainer();
        if (target) target.noSlotsMsg.style.display = "";
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
    console.log("[SIM] Running. Use forceSlot() in console.");
})();
</script>'''

# Find the old script block (the one containing "forceSlot")
pattern = r'(<script>[\s\S]*?forceSlot[\s\S]*?</script>)'
if re.search(pattern, content):
    new_content = re.sub(pattern, new_script, content)
    with open(html_path, "w") as f:
        f.write(new_content)
    print("✅ Simulation script fixed.")
else:
    print("Could not find old script – appending new script before </body>")
    new_content = content.replace("</body>", new_script + "\n</body>")
    with open(html_path, "w") as f:
        f.write(new_content)
    print("✅ Script appended.")
