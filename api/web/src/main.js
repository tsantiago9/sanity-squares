// api/web/src/main.js
import "./style.css";

const API_BASE = "/api";

const qs = new URLSearchParams(window.location.search);
const boardId = qs.get("boardId") || "test-board";

const state = {
  board: null,
  squares: [],
  selected: new Set(), // store keys like "001".."100"
  logoDataUrl: "",
};

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);

  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (typeof v === "function" && k.startsWith("on")) n[k.toLowerCase()] = v;
    else n.setAttribute(k, v);
  }

  for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

/** sets --accent and --accent-rgb (r g b) */
function setAccent(color) {
  const root = document.documentElement;
  root.style.setProperty("--accent", color);

  // parse rgb(...) OR #rrggbb
  let r, g, b;
  if (typeof color === "string" && color.startsWith("#")) {
    const hex = color.replace("#", "").trim();
    if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  } else {
    const m = String(color).match(/(\d+)\D+(\d+)\D+(\d+)/);
    if (m) {
      r = Number(m[1]); g = Number(m[2]); b = Number(m[3]);
    }
  }
  if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
    root.style.setProperty("--accent-rgb", `${r} ${g} ${b}`);
  }
}

function setLogoWatermark(dataUrlOrEmpty) {
  const root = document.documentElement;
  if (dataUrlOrEmpty) root.style.setProperty("--logo-url", `url("${dataUrlOrEmpty}")`);
  else root.style.setProperty("--logo-url", "none");
}

function extractAverageColor(img) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = 80;
  canvas.height = 80;
  ctx.drawImage(img, 0, 0, 80, 80);

  const data = ctx.getImageData(0, 0, 80, 80).data;
  let r = 0, g = 0, b = 0, count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue;

    const rr = data[i], gg = data[i + 1], bb = data[i + 2];
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const sat = max - min;

    if (max < 35) continue;
    if (min > 235) continue;
    if (sat < 18) continue;

    r += rr; g += gg; b += bb;
    count++;
  }

  if (!count) return "#c9a227";
  r = Math.round(r / count);
  g = Math.round(g / count);
  b = Math.round(b / count);

  const lift = 60;
  r = Math.min(255, Math.max(r, lift));
  g = Math.min(255, Math.max(g, lift));
  b = Math.min(255, Math.max(b, lift));

  return `rgb(${r}, ${g}, ${b})`;
}

async function apiGetBoard() {
  const r = await fetch(`${API_BASE}/board/${encodeURIComponent(boardId)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || "Failed to load board");
  return j;
}

async function apiClaim(displayName, squares) {
  const r = await fetch(`${API_BASE}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boardId, displayName, squares }),
  });
  const j = await r.json();
  if (!r.ok) throw j;
  return j;
}

function keyForSquare(sq) {
  // keys like "001".."100"
  const raw = sq?.id ?? sq?.squareNumber;
  return String(raw).padStart(3, "0");
}

function statusOf(sq) {
  return String(sq?.status ?? "open").trim().toLowerCase();
}

function updateSelectedLine() {
  const node = document.querySelector("#selectedLineValue");
  if (!node) return;
  const list = Array.from(state.selected).sort((a, b) => Number(a) - Number(b));
  node.textContent = list.length ? list.join(", ") : "None";
}

function applyBtnVisual(btn, sq) {
  const st = statusOf(sq);
  const key = keyForSquare(sq);
  const selected = state.selected.has(key);

  btn.dataset.key = key;
  btn.dataset.status = st;

  btn.classList.remove("selected", "taken", "open");
  btn.classList.add(st === "taken" ? "taken" : "open");
  if (selected) btn.classList.add("selected");

  btn.disabled = st !== "open";

  const nameEl = btn.querySelector(".name");
  if (!nameEl) return;

  if (st === "taken") nameEl.textContent = sq.displayName || "Taken";
  else nameEl.textContent = selected ? "Selected" : "";
}

function render() {
  const root = document.querySelector("#app");
  root.innerHTML = "";

  const header = el("div", { class: "header" }, [
    el("div", { class: "title", text: state.board?.title || "Loading..." }),
    el("div", { class: "subtitle", text: state.board?.teamName ? `Team: ${state.board.teamName}` : "" }),
  ]);

  const brandRow = el("div", { class: "pay" }, [
    el("div", { class: "payLine", text: "Logo + colors (optional):" }),
    el("div", { class: "btnRow" }, [
      el("input", {
        class: "input",
        type: "file",
        accept: "image/*",
        onchange: async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;

          const dataUrl = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = rej;
            fr.readAsDataURL(file);
          });

          state.logoDataUrl = dataUrl;
          setLogoWatermark(dataUrl);

          const img = new Image();
          img.onload = () => {
            setAccent(extractAverageColor(img));
            render();
          };
          img.src = dataUrl;
        },
      }),
      el("button", {
        class: "btn",
        type: "button",
        onclick: () => {
          state.logoDataUrl = "";
          setLogoWatermark("");
          setAccent("#c9a227");
          render();
        },
      }, ["Reset Theme"]),
    ]),
    state.logoDataUrl
      ? el("img", {
          src: state.logoDataUrl,
          style:
            "max-height:52px; margin-top:10px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); padding:8px;",
        })
      : el("div", { class: "payLine", text: "" }),
  ]);

  const pay = el("div", { class: "pay" }, [
    el("div", { class: "payLine", text: `Price: $${state.board?.pricePerSquare ?? ""} per square` }),
    el("div", { class: "payLine", text: state.board?.paymentHandle ? `Pay: ${state.board.paymentLabel || "Venmo"} @${state.board.paymentHandle}` : "" }),
  ]);

  const grid = el("div", { class: "grid", id: "grid" });

  // Build buttons once; clicks handled by ONE listener (delegation)
  for (const sq of state.squares) {
    const btn = el("button", { class: "cell", type: "button" }, [
      el("div", { class: "num", text: String(sq.squareNumber) }),
      el("div", { class: "name", text: "" }),
    ]);
    applyBtnVisual(btn, sq);
    grid.appendChild(btn);
  }

  // ONE click handler for entire grid (do not change this)
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("button.cell");
    if (!btn) return;

    const st = String(btn.dataset.status || "").toLowerCase();
    if (st !== "open") return;

    const key = btn.dataset.key;
    if (!key) return;

    if (state.selected.has(key)) state.selected.delete(key);
    else state.selected.add(key);

    const sq = state.squares.find((x) => keyForSquare(x) === key);
    if (sq) applyBtnVisual(btn, sq);
    updateSelectedLine();
  });

  const form = el("div", { class: "form" });

  const selectedLine = el("div", { class: "selectedLine" }, [
    el("span", { class: "muted", text: "Selected: " }),
    el("span", { id: "selectedLineValue", text: "None" }),
  ]);

  const nameInput = el("input", { class: "input", id: "name", placeholder: "Your name", autocomplete: "name" });

  const submitBtn = el("button", {
    class: "btn primary",
    type: "button",
    onclick: async () => {
      const displayName = nameInput.value.trim();
      const squares = Array.from(state.selected)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => Number(k)); // "023" -> 23

      if (!displayName) return alert("Name required");
      if (!squares.length) return alert("Select at least 1 square");

      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";

      try {
        await apiClaim(displayName, squares);
        await load();
        nameInput.value = "";
        state.selected.clear();
        alert("Claimed. Send payment now.");
      } catch (e) {
        alert(e?.error || e?.message || "Claim failed");
        await load();
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Claim Squares";
      }
    },
  }, ["Claim Squares"]);

  const clearBtn = el("button", {
    class: "btn",
    type: "button",
    onclick: () => {
      state.selected.clear();
      document.querySelectorAll(".cell.selected").forEach((b) => b.classList.remove("selected"));
      document.querySelectorAll(".cell.open .name").forEach((n) => (n.textContent = ""));
      updateSelectedLine();
    },
  }, ["Clear"]);

  form.appendChild(selectedLine);
  form.appendChild(nameInput);
  form.appendChild(el("div", { class: "btnRow" }, [submitBtn, clearBtn]));

  root.appendChild(header);
  root.appendChild(brandRow);
  root.appendChild(pay);
  root.appendChild(grid);
  root.appendChild(form);

  updateSelectedLine();
}

async function load() {
  const data = await apiGetBoard();
  state.board = data.board;
  state.squares = data.squares || [];
  render();
}

// defaults
setAccent("#c9a227");
setLogoWatermark("");
render();

load().catch((e) => {
  document.querySelector("#app").textContent = e?.message || "Failed to load";
});
