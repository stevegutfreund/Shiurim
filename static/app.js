"use strict";

/* ===================== exact fractions (BigInt) ===================== */
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
function rat(n, d = 1n) {
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
const div = (a, b) => rat(a.n * b.d, a.d * b.n);
const sub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const floorDiv = (a, b) => (a.n * b.d) / (a.d * b.n);   // BigInt floor of a/b (both positive)
const toNum = r => Number(r.n) / Number(r.d);

// "57.6" / "3" / "1/24" / "1 1/2" / "½" -> rational, or null if not a positive number.
const VULGAR = { "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅕": "1/5", "⅙": "1/6", "⅛": "1/8" };
function parseDecimal(s) {
  const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
  if (!m || (m[1] === "" && !m[2])) return null;
  const frac = m[2] || "";
  return rat(BigInt((m[1] || "0") + frac), 10n ** BigInt(frac.length));
}
function parseAmount(raw) {
  let s = String(raw).trim().replace(/,/g, "");
  for (const [k, v] of Object.entries(VULGAR)) s = s.replace(k, (/\d$/.test(s.split(k)[0]) ? " " : "") + v);
  s = s.replace(/\s+/g, " ").trim();
  let m;
  if ((m = /^(\d+) (\d+)\/(\d+)$/.exec(s))) {
    const d = BigInt(m[3]); if (d === 0n) return null;
    return rat(BigInt(m[1]) * d + BigInt(m[2]), d);
  }
  if ((m = /^(\d*\.?\d+)\/(\d*\.?\d+)$/.exec(s))) {
    const a = parseDecimal(m[1]), b = parseDecimal(m[2]);
    if (!a || !b || b.n === 0n) return null;
    return div(a, b);
  }
  return parseDecimal(s);
}
const ratFromNumber = x => parseDecimal(Number(x).toFixed(10).replace(/\.?0+$/, "")) || rat(0n);

/* ===================== formatting ===================== */
function fmt(x) {
  if (!isFinite(x)) return "–";
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a < 1e-6 || a >= 1e12) return x.toExponential(3);
  const digits = a >= 1000 ? 2 : a >= 1 ? 4 : Math.min(8, 2 - Math.floor(Math.log10(a)) + 2);
  return x.toLocaleString("en-US", { maximumFractionDigits: digits });
}
// Mixed fraction text ("2 1/4"), or null when the value is whole or the denominator is unwieldy.
function fracText(r, maxDen = 100000n) {
  if (r.d === 1n || r.d > maxDen) return null;
  const whole = r.n / r.d, rest = r.n % r.d;
  return (whole ? whole.toLocaleString("en-US") + " " : "") + rest + "/" + r.d;
}
// Short "nice" form: whole numbers and simple fractions exactly, otherwise a decimal.
function nice(r) {
  if (r.d === 1n) return Number(r.n).toLocaleString("en-US");
  const f = fracText(r, 1000n);
  return f || fmt(toNum(r));
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// <bdi dir="ltr"> keeps "6 1/2" in order inside Hebrew text (CSS direction alone didn't).
// Period tag (e.g. גרה = תורה, מעה = חז"ל) shown next to a unit name.
const eraTag = u => u.era ? ` <span class="era">${esc(u.era)}</span>` : "";
const numSpan = t => `<bdi class="num" dir="ltr">${esc(t)}</bdi>`;

/* ===================== data model ===================== */
let DATA = null;          // from /api/units
const CATS = {};          // key -> category with parsed rationals

function prepare(data) {
  DATA = data;
  for (const c of data.categories) {
    c.units.forEach(u => { u.r = parseAmount(u.base); });
    c.byName = Object.fromEntries(c.units.map(u => [u.name, u]));
    c.refR = c.byName[c.ref].r;
    c.modernUnits = [{ name: c.modern.small, factor: 1 }].concat(
      c.modern.steps.map(s => ({ name: s.unit, factor: s.factor })));
    CATS[c.key] = c;
  }
}
const shitaLabel = key => DATA.shitot.find(s => s.key === key).label;
const isModern = (c, name) => c.modernUnits.some(m => m.name === name);

// Value of one `name` in the category's base unit. Modern units depend on the shita.
function baseOf(c, name, shita) {
  const u = c.byName[name];
  if (u) return u.r;
  const m = c.modernUnits.find(x => x.name === name);
  // 1 small modern unit = ref / value  (e.g. 1 ml = 1/57.6 ביצה)
  const perSmall = div(c.refR, ratFromNumber(c.values[shita]));
  return mul(perSmall, rat(BigInt(m.factor)));
}
// Amount (in base units) -> {small, best:{val,unit}, alt:{val,unit}|null} for a shita.
function modernOf(c, baseAmt, shita) {
  const small = toNum(div(baseAmt, c.refR)) * c.values[shita];
  let best = c.modernUnits[0];
  for (const m of c.modernUnits) if (small >= m.factor) best = m;
  const primary = { val: small / best.factor, unit: best.name };
  const altUnit = best.factor === 1 ? c.modernUnits[1] : c.modernUnits[0];
  const alt = altUnit ? { val: small / altUnit.factor, unit: altUnit.name } : null;
  return { small, primary, alt };
}

/* ===================== state ===================== */
const DEFAULT_SEL = {
  volume: { from: "רביעית", to: "ביצה" },
  length: { from: "אמה", to: "טפח" },
  coins: { from: "דינר צורי / זוז", to: "פונדיון צורי" },
};
let state = { tab: "calc", cat: "volume", shita: "rcn", modern: false, amount: "1", sel: structuredClone(DEFAULT_SEL), bd: {} };
try {
  const saved = JSON.parse(localStorage.getItem("shiurim.state") || "null");
  if (saved && typeof saved === "object") state = { ...state, ...saved, sel: { ...state.sel, ...(saved.sel || {}) } };
} catch (e) { /* storage unavailable */ }
const persist = () => { try { localStorage.setItem("shiurim.state", JSON.stringify(state)); } catch (e) { /* ignore */ } };

/* ===================== DOM ===================== */
const $ = id => document.getElementById(id);
const el = {
  amount: $("amount"), from: $("fromUnit"), to: $("toUnit"),
  resultEq: $("resultEq"), resultNum: $("resultNum"), resultUnit: $("resultUnit"),
  resultFrac: $("resultFrac"), modernCols: $("modernCols"), allUnits: $("allUnits"),
  breakdown: $("breakdown"), ladder: $("ladder"), modernBox: $("modernBox"),
};

// Units the breakdown splits into: the user's pick for this category, else the main chain.
// Always largest first.
const isCustomBd = c => (state.bd[c.key] || []).some(n => c.byName[n]);
function bdUnits(c) {
  const names = isCustomBd(c) ? state.bd[c.key].filter(n => c.byName[n]) : c.chain;
  return [...names].sort((a, b) => toNum(c.byName[b].r) - toNum(c.byName[a].r));
}
function toggleBdUnit(c, name) {
  const cur = new Set(bdUnits(c));
  if (cur.has(name)) { if (cur.size === 1) return; cur.delete(name); } else cur.add(name);
  const same = cur.size === c.chain.length && c.chain.every(n => cur.has(n));
  if (same) delete state.bd[c.key]; else state.bd[c.key] = [...cur];
}
let bdOpen = false;   // unit picker panel open

// Greedy split into the breakdown units (e.g. 7 קב -> 1 סאה + 1 קב). The remainder
// below the smallest one is kept as an exact fraction of it.
function decompose(c, baseAmt) {
  let rem = baseAmt;
  const parts = [];
  const names = bdUnits(c);
  names.forEach((name, i) => {
    const u = c.byName[name];
    if (i === names.length - 1) {
      const r = div(rem, u.r);
      if (r.n > 0n) parts.push({ amt: r, name });
      return;
    }
    const q = floorDiv(rem, u.r);
    if (q > 0n) { parts.push({ amt: rat(q), name }); rem = sub(rem, mul(rat(q), u.r)); }
  });
  return parts;
}

function renderLadder() {
  const c = CATS[state.cat], sel = state.sel[state.cat];
  el.ladder.innerHTML = c.chain.slice(0, -1).map((big, i) => {
    const small = c.chain[i + 1];
    const k = div(c.byName[big].r, c.byName[small].r);
    const on = sel.from === big && sel.to === small;
    return `<button type="button" class="rung${on ? " on" : ""}" data-rung-from="${esc(big)}" data-rung-to="${esc(small)}">
      <span class="rung-big">1 ${esc(big)}</span>
      <span class="rung-eq">=</span>
      <span class="rung-small">${numSpan(nice(k))} ${esc(small)}</span>
    </button>`;
  }).join("");
}

function renderModernCtl() {
  $("modernToggle").checked = state.modern;
  $("shitaSwitch").hidden = !state.modern;
  $("settingsTabBtn").hidden = !state.modern;
  el.modernBox.hidden = !state.modern;
}
function renderShitaSwitch() {
  $("shitaSwitch").innerHTML = DATA.shitot.map(s =>
    `<button type="button" data-shita="${s.key}" class="${s.key === state.shita ? "on" : ""}">${esc(s.label)}</button>`).join("");
}
function renderCatSwitch() {
  // While searching, the tables tab shows matches from every category, so no button is selected there.
  const searching = $("search").value.trim() !== "";
  const html = active => DATA.categories.map(c => {
    const on = active && c.key === state.cat;
    return `<button type="button" role="radio" aria-checked="${on}" data-cat="${c.key}" class="${on ? "on" : ""}"><span class="ico">${c.icon}</span>${esc(c.label)}</button>`;
  }).join("");
  $("catSwitch").innerHTML = html(true);
  $("tableCatSwitch").innerHTML = html(!searching);
}
function fillSelects() {
  const c = CATS[state.cat];
  const opts = `<optgroup label="יחידות ${esc(c.label)}">` +
    c.units.map(u => `<option value="${esc(u.name)}">${esc(u.name)}</option>`).join("") +
    `</optgroup>` + (state.modern ? `<optgroup label="יחידות מודרניות">` +
    c.modernUnits.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join("") + `</optgroup>` : "");
  el.from.innerHTML = opts; el.to.innerHTML = opts;
  const sel = state.sel[state.cat];
  const valid = n => c.byName[n] || (state.modern && isModern(c, n));
  if (!valid(sel.from)) sel.from = DEFAULT_SEL[state.cat].from;
  if (!valid(sel.to)) sel.to = DEFAULT_SEL[state.cat].to;
  el.from.value = sel.from; el.to.value = sel.to;
  $("presets").innerHTML = c.presets.map((p, i) => `<button type="button" class="chip" data-preset="${i}">${esc(p.label)}</button>`).join("");
  $("allCatName").textContent = c.label;
}

function renderCalc() {
  const c = CATS[state.cat];
  const sel = state.sel[state.cat];
  const amt = parseAmount(state.amount);
  el.amount.classList.toggle("bad", !amt);
  if (!amt) {
    el.resultEq.textContent = "יש להזין כמות חיובית";
    el.resultNum.textContent = "–"; el.resultUnit.textContent = ""; el.resultFrac.textContent = "";
    el.modernCols.innerHTML = ""; el.allUnits.innerHTML = ""; el.breakdown.innerHTML = "";
    renderLadder();
    return;
  }
  const shita = state.shita;
  const baseAmt = mul(amt, baseOf(c, sel.from, shita));
  const res = div(baseAmt, baseOf(c, sel.to, shita));
  const usesModern = isModern(c, sel.from) || isModern(c, sel.to);

  el.resultEq.innerHTML = `${numSpan(nice(amt))} ${esc(sel.from)}` +
    (usesModern ? ` <span class="tag">לפי ${esc(shitaLabel(shita))}</span>` : "") + " =";
  el.resultNum.textContent = fmt(toNum(res));
  el.resultUnit.textContent = sel.to;
  // Fractions are exact only between the ancient units; via ml/cm/g they're just noise.
  const ft = usesModern ? null : fracText(res);
  el.resultFrac.innerHTML = ft && ft !== fmt(toNum(res)) ? `כשבר: ${numSpan(ft)}` : "";

  const parts = decompose(c, baseAmt);
  const custom = isCustomBd(c);
  const chosen = new Set(bdUnits(c));
  const picker = !bdOpen ? "" : `<div class="bd-picker">
      <span class="hint">בחרו לאילו יחידות לפרק. השארית מוצגת כשבר של הקטנה שבהן.</span>
      <div class="chips">${c.units.map(u => `<button type="button" class="chip${chosen.has(u.name) ? " on" : ""}" aria-pressed="${chosen.has(u.name)}" data-bd-unit="${esc(u.name)}">${esc(u.name)}</button>`).join("")}</div>
      ${custom ? `<button type="button" class="bd-link" data-bd-reset="1">ברירת מחדל (${c.chain.map(esc).join(", ")})</button>` : ""}
    </div>`;
  el.breakdown.innerHTML = (parts.length < 2 && !custom && !bdOpen) ? `<div class="bd-head"><span></span><button type="button" class="bd-link" data-bd-toggle="1">פירוט ליחידות…</button></div>` : `
    <div class="bd-head">
      <span class="field-label">בפירוט${custom ? ` <span class="tag">יחידות שבחרת</span>` : ""}</span>
      <button type="button" class="bd-link" data-bd-toggle="1">${bdOpen ? "סגירה" : "בחירת יחידות"}</button>
    </div>
    <div class="bd-parts">${parts.map(p => `<span class="bd-part">${numSpan(nice(p.amt))} ${esc(p.name)}</span>`).join('<span class="bd-plus">+</span>')}</div>
    ${picker}`;
  // Base-unit equivalent and the sheet's notes for both units.
  const facts = [];
  if (c.byName[sel.from] && c.byName[sel.to] && sel.from !== c.base && sel.to !== c.base)
    facts.push(`ב${esc(c.base)} (יחידת הבסיס): ${numSpan(nice(baseAmt))}`);
  [sel.from, sel.to].forEach(n => { const u = c.byName[n]; if (u && u.note) facts.push(`${esc(u.name)}: ${esc(u.note)}`); });
  el.breakdown.innerHTML += facts.length ? `<ul class="facts">${facts.map(f => `<li>${f}</li>`).join("")}</ul>` : "";
  renderLadder();

  // Modern size under each shita.
  // Modern size under each shita (only when the modern toggle is on).
  if (!state.modern) el.modernCols.innerHTML = "";
  const vals = DATA.shitot.map(s => ({ s, m: modernOf(c, baseAmt, s.key) }));
  const same = DATA.shitot.every(s => c.values[s.key] === c.values[DATA.shitot[0].key]);
  const col = ({ s, m }, label) => `
    <button type="button" class="modern-col ${s.key === shita && !same ? "on" : ""}" data-shita="${s.key}">
      <div class="who">${esc(label)}</div>
      <div class="val">${numSpan(fmt(m.primary.val))} ${esc(m.primary.unit)}</div>
      ${m.alt ? `<div class="sub">${numSpan(fmt(m.alt.val))} ${esc(m.alt.unit)}</div>` : ""}
    </button>`;
  if (state.modern) el.modernCols.innerHTML = same
    ? col(vals[0], DATA.shitot.map(s => s.label).join(" · ")) + `<div class="modern-same">בשיעור זה אין מחלוקת בין השיטות</div>`
    : vals.map(v => col(v, v.s.label)).join("");

  // Every unit in the category.
  el.allUnits.innerHTML = c.units.map(u => {
    const r = div(baseAmt, u.r);
    const m = modernOf(c, u.r, shita);
    const cls = (u.name === sel.to ? " is-to" : "") + (u.name === sel.from ? " is-from" : "");
    return `<button type="button" class="u-row${cls}" data-to="${esc(u.name)}">
      <div class="u-top"><span class="u-name">${esc(u.name)}${eraTag(u)}</span><span class="u-val num">${esc(nice(r))}</span></div>
      <div class="u-sub"><span>${esc(u.note || "")}</span>${u.name !== c.base ? `<span>ב${esc(c.base)}: ${numSpan(nice(u.r))}</span>` : ""}</div>
      ${state.modern ? `<div class="u-modern">כל אחד: ${numSpan(fmt(m.primary.val))} ${esc(m.primary.unit)}</div>` : ""}
    </button>`;
  }).join("");
}

function renderTables() {
  const q = $("search").value.trim();
  let shown = 0;
  // One category at a time (the switch), or every category while searching.
  const cats = q ? DATA.categories : [CATS[state.cat]];
  $("refTables").innerHTML = cats.map(c => {
    const units = c.units.filter(u => !q || u.name.includes(q) || (u.note || "").includes(q));
    shown += units.length;
    if (!units.length) return "";
    const showRef = c.ref !== c.base;
    const logs = c.units.map(u => Math.log10(toNum(u.r)));
    const lo = Math.min(...logs), hi = Math.max(...logs);
    const head = `<tr><th>יחידה</th><th>ב${esc(c.base)}</th>${showRef ? `<th>ב${esc(c.ref)}</th>` : ""}` +
      (state.modern ? DATA.shitot.map(s => `<th class="${s.key === state.shita ? "cur" : ""}">${esc(s.label)}</th>`).join("") : "") +
      `<th>הערה</th><th>גודל יחסי</th><th></th></tr>`;
    const rows = units.map(u => {
      const w = 6 + 94 * (Math.log10(toNum(u.r)) - lo) / ((hi - lo) || 1);
      const cells = !state.modern ? "" : DATA.shitot.map(s => {
        const m = modernOf(c, u.r, s.key);
        return `<td data-label="${esc(s.label)}" class="${s.key === state.shita ? "cur" : ""}">${numSpan(fmt(m.primary.val))} ${esc(m.primary.unit)}</td>`;
      }).join("");
      return `<tr>
        <td class="name-cell"><span class="u-name">${esc(u.name)}</span>${eraTag(u)}</td>
        <td data-label="ב${esc(c.base)}">${numSpan(nice(u.r))}</td>
        ${showRef ? `<td data-label="ב${esc(c.ref)}">${numSpan(nice(div(u.r, c.refR)))}</td>` : ""}
        ${cells}
        <td data-label="הערה" class="hint">${esc(u.note || "")}</td>
        <td class="bar-cell"><div class="bar"><span data-w="${w.toFixed(1)}"></span></div></td>
        <td data-label=""><button type="button" class="go" data-go-cat="${c.key}" data-go-unit="${esc(u.name)}">לחשב ←</button></td>
      </tr>`;
    }).join("");
    const refVals = DATA.shitot.map(s => `${esc(s.label)}: ${numSpan(fmt(c.values[s.key]))} ${esc(c.modern.small)}`).join(" · ");
    const chainTxt = c.chain.slice(0, -1).map((big, i) =>
      `<span class="chain-step">1 ${esc(big)} = ${numSpan(nice(div(c.byName[big].r, c.byName[c.chain[i + 1]].r)))} ${esc(c.chain[i + 1])}</span>`).join("");
    return `<div class="card">
      <div class="ref-head"><span class="ico">${c.icon}</span><h2>${esc(c.label)}</h2></div>
      <div class="ref-meta">יחידת בסיס: <b>${esc(c.base)}</b>${state.modern ? ` · ${esc(c.ref)} = ${refVals}` : ""}</div>
      <div class="ref-chain">${chainTxt}</div>
      <table class="ref"><thead>${head}</thead><tbody>${rows}</tbody></table>
      ${state.modern ? `<div class="ref-note">${esc(c.note)}${c.link ? ` <a href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">מקור</a>` : ""}</div>` : ""}
    </div>`;
  }).join("");
  // CSP forbids inline style attributes; setting style from script is allowed.
  document.querySelectorAll("#refTables .bar > span").forEach(s => { s.style.width = s.dataset.w + "%"; });
  $("searchCount").textContent = q ? `${shown} תוצאות` : "";
  if (q && !shown) $("refTables").innerHTML = `<div class="card hint">לא נמצאה יחידה בשם "${esc(q)}"</div>`;
}

function renderSettings() {
  $("modernForm").innerHTML = DATA.categories.map(c => `
    <div class="m-row">
      <div class="m-cat">${c.icon} ${esc(c.label)}<span class="hint">${esc(c.ref)} ב${esc(c.modern.small)}</span></div>
      ${DATA.shitot.map(s => `
        <label class="field"><span class="field-label">${esc(s.label)}
          <span class="hint">(בגיליון: ${c.defaults[s.key]})</span></span>
          <input type="number" step="any" min="0" data-cat="${c.key}" data-shita="${s.key}" value="${c.values[s.key]}">
        </label>`).join("")}
    </div>`).join("");
}

function renderAll() {
  renderModernCtl(); renderShitaSwitch(); renderCatSwitch(); fillSelects(); renderCalc(); renderTables();
}

function showTab(tab) {
  state.tab = tab; persist();
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p => { p.hidden = p.id !== "tab-" + tab; });
  if (tab === "settings") renderSettings();
}

/* ===================== events ===================== */
function setShita(key) { state.shita = key; persist(); renderShitaSwitch(); renderCalc(); renderTables(); }

document.addEventListener("click", e => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.tab) showTab(t.dataset.tab);
  else if (t.dataset.shita && !t.closest("#modernForm")) setShita(t.dataset.shita);
  else if (t.dataset.cat) {
    state.cat = t.dataset.cat;
    if (t.closest("#tableCatSwitch")) $("search").value = "";   // picking a category ends the search
    persist(); renderCatSwitch(); fillSelects(); renderCalc(); renderTables();
  }
  else if (t.dataset.to) { state.sel[state.cat].to = t.dataset.to; el.to.value = t.dataset.to; persist(); renderCalc(); }
  else if (t.dataset.bdToggle) { bdOpen = !bdOpen; renderCalc(); }
  else if (t.dataset.bdUnit) { toggleBdUnit(CATS[state.cat], t.dataset.bdUnit); persist(); renderCalc(); }
  else if (t.dataset.bdReset) { delete state.bd[state.cat]; persist(); renderCalc(); }
  else if (t.dataset.rungFrom) {
    const sel = state.sel[state.cat];
    sel.from = t.dataset.rungFrom; sel.to = t.dataset.rungTo; state.amount = el.amount.value = "1";
    fillSelects(); persist(); renderCalc();
  }
  else if (t.dataset.preset) {
    const p = CATS[state.cat].presets[+t.dataset.preset];
    state.amount = p.amount; el.amount.value = p.amount;
    const sel = state.sel[state.cat];
    if (sel.to === p.unit) sel.to = sel.from;
    sel.from = p.unit; fillSelects(); persist(); renderCalc();
  } else if (t.dataset.goCat) {
    state.cat = t.dataset.goCat;
    const c = CATS[state.cat], sel = state.sel[state.cat];
    sel.from = t.dataset.goUnit;
    // Target: the category's base unit, or its smallest unit when starting from the base.
    sel.to = sel.from !== c.base ? c.base : c.units[c.units.length - 1].name; state.amount = "1"; el.amount.value = "1";
    renderCatSwitch(); fillSelects(); renderCalc(); showTab("calc"); window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

el.amount.addEventListener("input", () => { state.amount = el.amount.value; persist(); renderCalc(); });
function step(delta) {
  const r = parseAmount(state.amount);
  let v = r ? toNum(r) : 0;
  v = Math.max(0, (Number.isInteger(v) ? v : Math.floor(v)) + delta);
  if (v === 0) v = delta > 0 ? 1 : 0.5;
  state.amount = el.amount.value = String(v); persist(); renderCalc();
}
$("amtPlus").addEventListener("click", () => step(1));
$("amtMinus").addEventListener("click", () => step(-1));
el.from.addEventListener("change", () => { state.sel[state.cat].from = el.from.value; persist(); renderCalc(); });
el.to.addEventListener("change", () => { state.sel[state.cat].to = el.to.value; persist(); renderCalc(); });
$("swap").addEventListener("click", () => {
  const sel = state.sel[state.cat];
  [sel.from, sel.to] = [sel.to, sel.from];
  el.from.value = sel.from; el.to.value = sel.to; persist(); renderCalc();
});
$("search").addEventListener("input", () => { renderCatSwitch(); renderTables(); });
$("modernToggle").addEventListener("change", e => {
  state.modern = e.target.checked;
  if (!state.modern && state.tab === "settings") showTab("calc");
  persist(); renderAll();
});

async function sendModern(method, body) {
  const status = $("saveStatus");
  status.className = "save-status"; status.textContent = "שומר…";
  try {
    const r = await fetch("api/modern", {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "השמירה נכשלה");
    prepare(data); renderAll(); renderSettings();
    status.className = "save-status ok"; status.textContent = method === "DELETE" ? "הוחזרו ערכי הגיליון ✓" : "נשמר ✓";
  } catch (err) {
    status.className = "save-status err"; status.textContent = err.message;
  }
}
$("saveModern").addEventListener("click", () => {
  const body = {};
  let bad = false;
  document.querySelectorAll("#modernForm input").forEach(i => {
    const v = parseFloat(i.value);
    if (!(v > 0)) bad = true;
    (body[i.dataset.cat] ||= {})[i.dataset.shita] = v;
  });
  if (bad) { $("saveStatus").className = "save-status err"; $("saveStatus").textContent = "כל הערכים צריכים להיות מספרים חיוביים"; return; }
  sendModern("PUT", body);
});
$("resetModern").addEventListener("click", () => sendModern("DELETE"));

/* ===================== boot ===================== */
fetch("api/units").then(r => r.json()).then(data => {
  prepare(data);
  if (!CATS[state.cat]) state.cat = DATA.categories[0].key;
  if (!DATA.shitot.some(s => s.key === state.shita)) state.shita = DATA.shitot[0].key;
  el.amount.value = state.amount;
  if (!state.modern && state.tab === "settings") state.tab = "calc";
  renderAll();
  showTab(state.tab || "calc");
}).catch(() => {
  document.querySelector("main").innerHTML = `<div class="card">לא ניתן לטעון את הנתונים מהשרת.</div>`;
});
