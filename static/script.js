const status = document.getElementById("status");
const runBtn = document.getElementById("run");
const spinner = runBtn.querySelector(".spinner");
const btnLabel = runBtn.querySelector(".btn-label");
const grid = document.getElementById("grid");
const meta = document.getElementById("meta");
const badge = document.getElementById("serviceBadge");

const slots = Array.from(document.querySelectorAll(".dz")).map(el => ({ el, file: null }));

function bindSlot(slot) {
  const input = slot.el.querySelector("input[type=file]");
  const img = slot.el.querySelector("img");
  const clearBtn = slot.el.querySelector(".dz-clear");

  function setFile(f) {
    if (!f || !f.type?.startsWith("image/")) return;
    slot.file = f;
    const r = new FileReader();
    r.onload = (e) => {
      img.src = e.target.result;
      slot.el.classList.add("has-image");
      clearBtn.hidden = false;
    };
    r.readAsDataURL(f);
  }
  function clearFile() {
    slot.file = null;
    img.src = "";
    slot.el.classList.remove("has-image");
    clearBtn.hidden = true;
    input.value = "";
  }

  slot.el.addEventListener("click", (e) => {
    if (e.target === input || e.target === clearBtn) return;
    input.click();
  });
  input.addEventListener("change", (e) => setFile(e.target.files[0]));
  clearBtn.addEventListener("click", (e) => { e.stopPropagation(); clearFile(); });

  ["dragenter","dragover"].forEach(ev => slot.el.addEventListener(ev, (e) => { e.preventDefault(); slot.el.classList.add("drag"); }));
  ["dragleave","drop"].forEach(ev => slot.el.addEventListener(ev, (e) => { e.preventDefault(); slot.el.classList.remove("drag"); }));
  slot.el.addEventListener("drop", (e) => {
    if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
  });
}
slots.forEach(bindSlot);

function setStatus(msg, kind="") {
  status.textContent = msg;
  status.className = "status" + (kind ? " " + kind : "");
}
function setLoading(on) {
  runBtn.disabled = on;
  spinner.hidden = !on;
  btnLabel.textContent = on ? "Calling 8407…" : "Run /run on 8407";
}

async function checkHealth() {
  try {
    const r = await fetch("/api/health");
    if (r.ok) {
      const j = await r.json();
      badge.textContent = `${j.service || "ok"} · live`;
      badge.className = "badge ok";
    } else {
      badge.textContent = `down · ${r.status}`;
      badge.className = "badge err";
    }
  } catch (e) {
    badge.textContent = "unreachable";
    badge.className = "badge err";
  }
}
checkHealth();
setInterval(checkHealth, 10000);

runBtn.addEventListener("click", async () => {
  const files = slots.filter(s => s.file).map(s => s.file);
  if (files.length === 0) return setStatus("Upload at least one image.", "error");
  if (files.length > 6) return setStatus("Upload at most 6 images.", "error");

  const fd = new FormData();
  files.forEach(f => fd.append("images", f));

  setLoading(true);
  grid.innerHTML = `<div class="placeholder"><div class="ph-glow"></div><div class="ph-text">Generating wireframe variant from ${files.length} input(s)…</div></div>`;
  setStatus(`Sending ${files.length} image(s) to /run…`);
  meta.hidden = true;

  try {
    const res = await fetch("/api/run", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      const detail = data.body ? "\n" + JSON.stringify(data.body, null, 2) : "";
      throw new Error((data.error || "request failed") + detail);
    }

    document.getElementById("m_in").textContent = data.input_count;
    document.getElementById("m_var").textContent = data.variant_count;
    document.getElementById("m_ok").textContent = data.success_count;
    document.getElementById("m_ms").textContent = (data.elapsed_ms || 0) + " ms";
    meta.hidden = false;

    grid.innerHTML = "";
    (data.variants || []).forEach(v => {
      const tile = document.createElement("div");
      tile.className = "tile" + (v.success ? "" : " failed");
      const promptText = (v.prompt || "").slice(0, 200);
      if (v.success && v.url) {
        tile.innerHTML = `
          <img src="${v.url}" alt="variant ${v.index}" />
          <div class="tile-prompt">#${v.index} · ${escapeHtml(promptText)}</div>
          <div class="tile-foot">
            <span>variant ${v.index}</span>
            <a href="${v.url}" target="_blank" rel="noopener">open</a>
          </div>`;
      } else {
        tile.innerHTML = `
          <div class="tile-prompt">#${v.index} · ${escapeHtml(promptText)}</div>
          <div class="tile-err">FAILED · ${escapeHtml(v.error || "no image returned")}</div>`;
      }
      grid.appendChild(tile);
    });

    setStatus(`Done. ${data.success_count}/${data.variant_count} succeeded.`, "ok");
  } catch (e) {
    setStatus(e.message, "error");
    grid.innerHTML = `<div class="placeholder"><div class="ph-text">No output</div></div>`;
  } finally {
    setLoading(false);
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
