// WMS 대시보드 데모 — 순수 JavaScript (라이브러리 없음)
const $ = (s) => document.querySelector(s);
const fmt = (n) => Number(n).toLocaleString("ko-KR");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const STATUS_CLASS = {
  "출고완료": "b-ok", "적치완료": "b-ok", "완료": "b-ok",
  "피킹중": "b-info", "포장중": "b-info",
  "검수대기": "b-warn", "승인대기": "b-warn", "대기": "b-gray",
};
const TYPE_CLASS = { "입고": "b-info", "출고": "b-warn", "이동": "b-gray", "재고조정": "b-bad" };
const badge = (t, map) => `<span class="badge ${map[t] || "b-gray"}">${esc(t)}</span>`;

let DB = null;
const state = { sortKey: "sku", sortAsc: true, txType: "" };

async function init() {
  try {
    const res = await fetch("data/wms-data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    DB = await res.json();
  } catch (e) {
    $("#meta").textContent = "데이터를 불러오지 못했습니다. 웹 서버(GitHub Pages 등)에서 열어 주세요.";
    return;
  }
  DB.items.forEach((it) => { it.value = it.qty * it.unitPrice; it.ratio = it.qty / it.safetyStock; });
  $("#meta").textContent = `${DB.meta.warehouse} · 기준일 ${DB.meta.baseDate} · ${DB.meta.note}`;

  renderKpis(); renderTrend(); renderZones(); renderOrders(); renderAlerts();
  setupInventory(); renderInventory(); setupTx(); renderTx();
}

function renderKpis() {
  const k = DB.kpi, items = DB.items;
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const totalVal = items.reduce((s, i) => s + i.value, 0);
  const low = items.filter((i) => i.ratio < 1).length;
  const today = DB.trend[DB.trend.length - 1];
  const used = DB.locations.reduce((s, l) => s + l.used, 0);
  const cap = DB.locations.reduce((s, l) => s + l.capacity, 0);
  const cards = [
    ["보유 SKU", items.length, "종", `총 ${fmt(totalQty)} EA`],
    ["재고 금액", (totalVal / 1e6).toFixed(1), "백만원", "단가 × 현재고"],
    ["금일 입고", today.inbound, "건", `출고 ${today.outbound}건`],
    ["재고 정확도", k.inventoryAccuracy, "%", "실사 대비 전산"],
    ["정시 출고율", k.onTimeShipment, "%", `주문 충족률 ${k.orderFillRate}%`],
    ["로케이션 사용률", ((used / cap) * 100).toFixed(1), "%", `${used} / ${cap} 셀`],
    ["안전재고 미달", low, "품목", "즉시 보충 필요", low > 0],
  ];
  $("#kpis").innerHTML = cards.map(([l, v, u, f, alert]) => `
    <div class="kpi${alert ? " alert" : ""}"><div class="label">${l}</div>
    <div class="value">${v}<small>${u}</small></div><div class="foot">${f}</div></div>`).join("");
}

function renderTrend() {
  const d = DB.trend, W = 640, H = 230, P = { l: 34, r: 10, t: 12, b: 26 };
  const max = Math.ceil(Math.max(...d.flatMap((x) => [x.inbound, x.outbound])) / 20) * 20;
  const gw = (W - P.l - P.r) / d.length, bw = gw * 0.34;
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  let s = "";
  for (let g = 0; g <= max; g += max / 4) {
    s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(g)}" y2="${y(g)}" stroke="#e4e8ef"/>`;
    s += `<text x="${P.l - 6}" y="${y(g) + 3}" text-anchor="end">${g}</text>`;
  }
  d.forEach((x, i) => {
    const cx = P.l + gw * i + gw / 2;
    s += `<rect x="${cx - bw - 1}" y="${y(x.inbound)}" width="${bw}" height="${H - P.b - y(x.inbound)}" rx="2" fill="var(--in)"><title>${x.date} 입고 ${x.inbound}건</title></rect>`;
    s += `<rect x="${cx + 1}" y="${y(x.outbound)}" width="${bw}" height="${H - P.b - y(x.outbound)}" rx="2" fill="var(--out)"><title>${x.date} 출고 ${x.outbound}건</title></rect>`;
    if (i % 2 === 1 || i === d.length - 1) s += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${x.date.slice(5)}</text>`;
  });
  $("#trendChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${s}</svg>`;
}

function renderZones() {
  $("#zoneBars").innerHTML = DB.locations.map((z) => {
    const p = (z.used / z.capacity) * 100;
    const c = p >= 90 ? "var(--bad)" : p >= 75 ? "var(--warn)" : "var(--ok)";
    return `<div class="zone"><div class="row"><span><b>${z.zone}</b> ${esc(z.name)}</span>
      <span>${z.used}/${z.capacity} 셀 · <b>${p.toFixed(0)}%</b></span></div>
      <div class="bar"><div style="width:${p}%;background:${c}"></div></div></div>`;
  }).join("") + `<p class="muted">90% 이상 빨강 · 75% 이상 노랑</p>`;
}

function renderOrders() {
  const o = DB.orders, cnt = {};
  o.forEach((x) => (cnt[x.status] = (cnt[x.status] || 0) + 1));
  const done = cnt["출고완료"] || 0;
  $("#orderSummary").textContent = `완료 ${done} / ${o.length}건 (${((done / o.length) * 100).toFixed(0)}%)`;
  $("#orderStatus").innerHTML = ["대기", "피킹중", "포장중", "출고완료"].map((s) => `<span>${s}<b>${cnt[s] || 0}</b></span>`).join("");
  $("#orderBody").innerHTML = [...o].sort((a, b) => a.dueTime.localeCompare(b.dueTime)).map((x) =>
    `<tr><td>${x.orderNo}</td><td>${esc(x.customer)}</td><td class="r">${x.lines}</td><td>${x.dueTime}</td><td>${badge(x.status, STATUS_CLASS)}</td></tr>`).join("");
}

function renderAlerts() {
  const low = DB.items.filter((i) => i.ratio < 1).sort((a, b) => a.ratio - b.ratio);
  $("#alertCount").textContent = low.length;
  $("#alerts").innerHTML = low.length ? low.map((i) => `
    <li><div><div class="nm">${esc(i.name)}</div><div class="loc">${i.sku} · ${i.location} · 현재 ${fmt(i.qty)} / 안전 ${fmt(i.safetyStock)}</div></div>
    <div class="gap">−${fmt(i.safetyStock - i.qty)}</div></li>`).join("")
    : `<li class="muted">미달 품목이 없습니다.</li>`;
}

function setupInventory() {
  const zf = $("#zoneFilter");
  DB.locations.forEach((z) => zf.insertAdjacentHTML("beforeend", `<option value="${z.zone}">${z.zone} · ${esc(z.name)}</option>`));
  ["#search", "#zoneFilter", "#lowOnly"].forEach((s) => $(s).addEventListener("input", renderInventory));
  document.querySelectorAll("th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.sort;
    state.sortAsc = state.sortKey === k ? !state.sortAsc : true;
    state.sortKey = k; renderInventory();
  }));
}

function renderInventory() {
  const q = $("#search").value.trim().toLowerCase(), z = $("#zoneFilter").value, low = $("#lowOnly").checked;
  const k = state.sortKey, dir = state.sortAsc ? 1 : -1;
  const rows = DB.items
    .filter((i) => (!z || i.zone === z) && (!low || i.ratio < 1) &&
      (!q || [i.sku, i.name, i.location, i.category].some((v) => v.toLowerCase().includes(q))))
    .sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
  $("#invBody").innerHTML = rows.map((i) => {
    const p = Math.min(i.ratio, 2) / 2 * 100;
    const c = i.ratio < 1 ? "var(--bad)" : i.ratio < 1.3 ? "var(--warn)" : "var(--ok)";
    return `<tr><td>${i.sku}</td><td>${esc(i.name)}</td><td>${esc(i.category)}</td><td>${i.location}</td>
      <td class="r">${fmt(i.qty)}</td><td class="r">${fmt(i.safetyStock)}</td>
      <td class="r"><span class="fill"><i style="width:${p}%;background:${c}"></i></span>${(i.ratio * 100).toFixed(0)}%</td>
      <td class="r">${fmt(i.value)}</td></tr>`;
  }).join("") || `<tr><td colspan="8" class="muted">조건에 맞는 품목이 없습니다.</td></tr>`;
}

function setupTx() {
  document.querySelectorAll("#txTabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#txTabs button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); state.txType = b.dataset.t; renderTx();
  }));
}

function renderTx() {
  $("#txBody").innerHTML = DB.transactions.filter((t) => !state.txType || t.type === state.txType).map((t) =>
    `<tr><td>${t.time}</td><td>${badge(t.type, TYPE_CLASS)}</td><td>${t.id}</td><td>${esc(t.name)}</td>
     <td class="r">${fmt(t.qty)}</td><td>${t.location}</td><td>${esc(t.partner)}</td><td>${badge(t.status, STATUS_CLASS)}</td></tr>`).join("");
}

function tick() {
  $("#clock").textContent = new Date().toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "medium" });
}
tick(); setInterval(tick, 1000);
document.querySelectorAll(".sidebar nav a").forEach((a) => a.addEventListener("click", () => {
  document.querySelectorAll(".sidebar nav a").forEach((x) => x.classList.remove("active")); a.classList.add("active");
}));
init();
