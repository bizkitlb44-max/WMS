// WMS 대시보드 데모 r1 — 순수 JavaScript (라이브러리 없음)
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const fmt = (n) => Number(n).toLocaleString("ko-KR");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const STATUS_CLASS = {
  "출고완료": "b-ok", "적치완료": "b-ok", "완료": "b-ok", "검수완료": "b-info",
  "피킹중": "b-out", "포장중": "b-out", "검수대기": "b-warn", "승인대기": "b-warn", "대기": "b-gray",
};
const TYPE_CLASS = { "입고": "b-info", "출고": "b-out", "이동": "b-gray", "재고조정": "b-bad" };
const ORDER_FLOW = { "대기": 0, "피킹중": 1, "포장중": 2, "출고완료": 3 };
const badge = (t, map) => `<span class="badge ${map[t] || "b-gray"}">${esc(t)}</span>`;
const ratioColor = (r) => (r < 1 ? "var(--bad)" : r < 1.3 ? "var(--warn)" : "var(--ok)");
const fillBar = (r) => `<span class="fill"><i style="width:${Math.min(r, 2) / 2 * 100}%;background:${ratioColor(r)}"></i></span><span class="pct" style="color:${ratioColor(r)}">${(r * 100).toFixed(0)}%</span>`;

let DB = null;
const state = {
  inv: { key: "sku", asc: true, group: "" },
  order: { key: "dueTime", asc: true },
  txType: "",
};

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
  DB.low = DB.items.filter((i) => i.ratio < 1).sort((a, b) => a.ratio - b.ratio);
  $("#meta").textContent = `${DB.meta.warehouse} · 기준일 ${DB.meta.baseDate} · ${DB.meta.note}`;

  renderBanner(); renderKpis(); renderIO(); renderShortage();
  setupOrders(); renderOrders(); renderZones(); renderTrend();
  setupInventory(); renderInventory(); setupTx(); renderTx();
}

/* ③ 안전재고 미달 강조 배너 */
function renderBanner() {
  const b = $("#alertBanner");
  if (!DB.low.length) { b.hidden = true; return; }
  const gap = DB.low.reduce((s, i) => s + (i.safetyStock - i.qty), 0);
  b.hidden = false;
  b.innerHTML = `<div class="ico">⚠</div>
    <div class="txt"><div class="ttl">안전재고 미달 ${DB.low.length}개 품목 · 총 부족 ${fmt(gap)} EA</div>
    <div class="names">${DB.low.map((i) => `<span>${esc(i.name)} ${(i.ratio * 100).toFixed(0)}%</span>`).join("")}</div></div>
    <a href="#shortage">부족 자재 보기 →</a>`;
}

function renderKpis() {
  const items = DB.items, tx = DB.transactions;
  const inTx = tx.filter((t) => t.type === "입고"), outTx = tx.filter((t) => t.type === "출고");
  const totalVal = items.reduce((s, i) => s + i.value, 0);
  const used = DB.locations.reduce((s, l) => s + l.used, 0), cap = DB.locations.reduce((s, l) => s + l.capacity, 0);
  const cards = [
    ["", "보유 SKU", items.length, "종", `업체 ${new Set(items.map((i) => i.supplier)).size}곳 · 유형 ${new Set(items.map((i) => i.category)).size}종`],
    ["k-in", "금일 입고", inTx.length, "건", `${fmt(inTx.reduce((s, t) => s + t.qty, 0))} EA`],
    ["k-out", "금일 출고", outTx.length, "건", `${fmt(outTx.reduce((s, t) => s + t.qty, 0))} EA`],
    ["k-bad", "안전재고 미달", DB.low.length, "품목", "즉시 보충 필요"],
    ["", "재고 금액", (totalVal / 1e8).toFixed(2), "억원", "단가 × 현재고"],
    ["", "재고 정확도", DB.kpi.inventoryAccuracy, "%", `정시 출고율 ${DB.kpi.onTimeShipment}%`],
    ["", "로케이션 사용률", ((used / cap) * 100).toFixed(1), "%", `${used} / ${cap} 셀`],
  ];
  $("#kpis").innerHTML = cards.map(([c, l, v, u, f]) => `
    <div class="kpi ${c}"><div class="label">${l}</div><div class="value">${v}<small>${u}</small></div><div class="foot">${f}</div></div>`).join("");
}

/* ① 금일 입·출고 한눈에 */
function renderIO() {
  [["입고", "in"], ["출고", "out"]].forEach(([type, k]) => {
    const list = DB.transactions.filter((t) => t.type === type);
    const qty = list.reduce((s, t) => s + t.qty, 0);
    $(`#${k}Sum`).innerHTML = `<b>${list.length}</b>건 · <b>${fmt(qty)}</b>EA`;
    const cnt = {}; list.forEach((t) => (cnt[t.status] = (cnt[t.status] || 0) + 1));
    $(`#${k}Status`).innerHTML = Object.entries(cnt).map(([s, n]) => `<span>${s} ${n}</span>`).join("");
    $(`#${k}Body`).innerHTML = list.map((t) => `<tr><td>${t.time}</td><td>${esc(t.name)}</td><td>${esc(t.partner)}</td>
      <td class="r"><b>${fmt(t.qty)}</b></td><td>${badge(t.status, STATUS_CLASS)}</td></tr>`).join("");
  });
}

/* ⑤ 안전재고 부족 자재 */
function renderShortage() {
  $("#shortCount").textContent = DB.low.length;
  $("#shortBody").innerHTML = DB.low.length ? DB.low.map((i) => {
    const rec = Math.ceil((i.safetyStock * 1.5 - i.qty) / 10) * 10;
    return `<tr><td>${i.sku}</td><td><b>${esc(i.name)}</b></td><td>${esc(i.category)}</td><td>${esc(i.supplier)}</td><td>${i.location}</td>
      <td class="r">${fmt(i.qty)}</td><td class="r">${fmt(i.safetyStock)}</td><td class="r gap">−${fmt(i.safetyStock - i.qty)}</td>
      <td>${fillBar(i.ratio)}</td><td class="r rec">${fmt(rec)}</td></tr>`;
  }).join("") : `<tr><td colspan="10" class="muted">안전재고 미달 품목이 없습니다.</td></tr>`;
}

/* ④ 금일 출고 주문 정렬 */
function setupOrders() {
  $("#orderKey").addEventListener("change", (e) => { state.order.key = e.target.value; renderOrders(); });
  $("#orderDir").addEventListener("click", () => { state.order.asc = !state.order.asc; renderOrders(); });
  $$("#orderHead th[data-k]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    state.order.asc = state.order.key === k ? !state.order.asc : true;
    state.order.key = k; renderOrders();
  }));
}
function renderOrders() {
  const { key, asc } = state.order, o = DB.orders;
  const cnt = {}; o.forEach((x) => (cnt[x.status] = (cnt[x.status] || 0) + 1));
  $("#orderStatus").innerHTML = Object.keys(ORDER_FLOW).map((s) => `<span>${s}<b>${cnt[s] || 0}</b></span>`).join("")
    + `<span>완료율<b>${(((cnt["출고완료"] || 0) / o.length) * 100).toFixed(0)}%</b></span>`;
  const val = (x) => (key === "status" ? ORDER_FLOW[x.status] : x[key]);
  const rows = [...o].sort((a, b) => cmp(val(a), val(b)) * (asc ? 1 : -1));
  $("#orderKey").value = key;
  $("#orderDir").textContent = asc ? "▲ 오름차순" : "▼ 내림차순";
  markSort("#orderHead", key, asc);
  $("#orderBody").innerHTML = rows.map((x) => `<tr><td>${x.orderNo}</td><td>${esc(x.customer)}</td><td class="r">${x.lines}</td>
    <td class="r">${fmt(x.qty)}</td><td><b>${x.dueTime}</b></td><td>${badge(x.status, STATUS_CLASS)}</td></tr>`).join("");
}

function cmp(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "ko");
}
function markSort(headSel, key, asc) {
  $$(`${headSel} th[data-k]`).forEach((th) => {
    th.querySelector(".arr")?.remove();
    if (th.dataset.k === key) th.insertAdjacentHTML("beforeend", `<span class="arr">${asc ? "▲" : "▼"}</span>`);
  });
}

/* ② 재고 현황: 업체별 / 자재유형별 */
function setupInventory() {
  const uniq = (k) => [...new Set(DB.items.map((i) => i[k]))].sort((a, b) => a.localeCompare(b, "ko"));
  uniq("supplier").forEach((s) => $("#supFilter").insertAdjacentHTML("beforeend", `<option>${esc(s)}</option>`));
  uniq("category").forEach((c) => $("#catFilter").insertAdjacentHTML("beforeend", `<option>${esc(c)}</option>`));
  ["#search", "#supFilter", "#catFilter", "#lowOnly"].forEach((s) => $(s).addEventListener("input", renderInventory));
  $("#resetBtn").addEventListener("click", () => {
    $("#search").value = ""; $("#supFilter").value = ""; $("#catFilter").value = ""; $("#lowOnly").checked = false; renderInventory();
  });
  $$("#groupSeg button").forEach((b) => b.addEventListener("click", () => {
    $$("#groupSeg button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
    state.inv.group = b.dataset.g; renderInventory();
  }));
  $$("#invHead th[data-k]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    state.inv.asc = state.inv.key === k ? !state.inv.asc : true;
    state.inv.key = k; renderInventory();
  }));
}

function filteredItems() {
  const q = $("#search").value.trim().toLowerCase(), sup = $("#supFilter").value, cat = $("#catFilter").value, low = $("#lowOnly").checked;
  return DB.items.filter((i) => (!sup || i.supplier === sup) && (!cat || i.category === cat) && (!low || i.ratio < 1) &&
    (!q || [i.sku, i.name, i.location].some((v) => v.toLowerCase().includes(q))));
}

function renderInventory() {
  const { key, asc, group } = state.inv;
  const rows = filteredItems().sort((a, b) => cmp(a[key], b[key]) * (asc ? 1 : -1));
  markSort("#invHead", key, asc);
  const row = (i) => `<tr class="${i.ratio < 1 ? "low" : ""}"><td>${i.sku}</td><td>${esc(i.name)}</td><td>${esc(i.category)}</td>
    <td>${esc(i.supplier)}</td><td>${i.location}</td><td class="r"><b>${fmt(i.qty)}</b></td><td class="r">${fmt(i.safetyStock)}</td>
    <td>${fillBar(i.ratio)}</td><td class="r">${fmt(i.value)}</td></tr>`;

  // 그룹 요약 칩 (전체 데이터 기준) — 누르면 해당 업체/유형으로 필터
  const chips = $("#groupChips");
  if (group) {
    const sel = group === "supplier" ? $("#supFilter").value : $("#catFilter").value;
    const g = groupBy(DB.items, group);
    chips.innerHTML = Object.entries(g).map(([name, list]) => {
      const lowN = list.filter((i) => i.ratio < 1).length;
      return `<button class="chip ${sel === name ? "on" : ""}" data-v="${esc(name)}"><div class="cn">${esc(name)}</div>
        <div class="cm">${list.length}품목 · ${(list.reduce((s, i) => s + i.value, 0) / 1e6).toFixed(1)}백만원</div>
        ${lowN ? `<div class="cb">⚠ 미달 ${lowN}</div>` : ""}</button>`;
    }).join("");
    chips.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
      const f = group === "supplier" ? $("#supFilter") : $("#catFilter");
      f.value = f.value === c.dataset.v ? "" : c.dataset.v; renderInventory();
    }));
  } else chips.innerHTML = "";

  if (!rows.length) { $("#invBody").innerHTML = `<tr><td colspan="9" class="muted">조건에 맞는 품목이 없습니다.</td></tr>`; return; }
  if (!group) { $("#invBody").innerHTML = rows.map(row).join(""); return; }

  const g = groupBy(rows, group);
  $("#invBody").innerHTML = Object.entries(g).map(([name, list]) => {
    const lowN = list.filter((i) => i.ratio < 1).length;
    const val = list.reduce((s, i) => s + i.value, 0);
    return `<tr class="grp"><td colspan="9">${group === "supplier" ? "🏭" : "📦"} ${esc(name)}
      <span class="gmeta">${list.length}품목 · 재고 ${fmt(list.reduce((s, i) => s + i.qty, 0))} EA · ${fmt(val)}원</span>
      ${lowN ? `<span class="gbad">⚠ 안전재고 미달 ${lowN}</span>` : ""}</td></tr>` + list.map(row).join("");
  }).join("");
}

function groupBy(list, k) {
  const g = {};
  list.forEach((i) => (g[i[k]] = g[i[k]] || []).push(i));
  return Object.fromEntries(Object.entries(g).sort((a, b) => a[0].localeCompare(b[0], "ko")));
}

/* 존 / 추이 */
function renderZones() {
  $("#zoneBars").innerHTML = DB.locations.map((z) => {
    const p = (z.used / z.capacity) * 100;
    const c = p >= 90 ? "var(--bad)" : p >= 75 ? "var(--warn)" : "var(--ok)";
    return `<div class="zone"><div class="row"><span><b>${z.zone}</b> ${esc(z.name)}</span>
      <span>${z.used}/${z.capacity} 셀 · <b style="color:${c}">${p.toFixed(0)}%</b></span></div>
      <div class="bar"><div style="width:${p}%;background:${c}"></div></div></div>`;
  }).join("");
}

function renderTrend() {
  const d = DB.trend, W = 520, H = 190, P = { l: 28, r: 6, t: 10, b: 22 };
  const max = Math.ceil(Math.max(...d.flatMap((x) => [x.inbound, x.outbound])) / 5) * 5;
  const gw = (W - P.l - P.r) / d.length, bw = gw * 0.36;
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  let s = "";
  for (let g = 0; g <= max; g += max / 5) {
    s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(g)}" y2="${y(g)}" stroke="#e1e6ee"/><text x="${P.l - 5}" y="${y(g) + 4}" text-anchor="end">${g}</text>`;
  }
  d.forEach((x, i) => {
    const cx = P.l + gw * i + gw / 2, last = i === d.length - 1;
    s += `<rect x="${cx - bw - 1}" y="${y(x.inbound)}" width="${bw}" height="${H - P.b - y(x.inbound)}" rx="2" fill="var(--in)" opacity="${last ? 1 : .75}"><title>${x.date} 입고 ${x.inbound}건</title></rect>`;
    s += `<rect x="${cx + 1}" y="${y(x.outbound)}" width="${bw}" height="${H - P.b - y(x.outbound)}" rx="2" fill="var(--out)" opacity="${last ? 1 : .75}"><title>${x.date} 출고 ${x.outbound}건</title></rect>`;
    if (i % 2 === 1 || last) s += `<text x="${cx}" y="${H - 6}" text-anchor="middle" ${last ? 'font-weight="700"' : ""}>${last ? "오늘" : x.date.slice(5)}</text>`;
  });
  $("#trendChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${s}</svg>`;
}

/* 전체 이력 */
function setupTx() {
  $$("#txTabs button").forEach((b) => b.addEventListener("click", () => {
    $$("#txTabs button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); state.txType = b.dataset.t; renderTx();
  }));
}
function renderTx() {
  $("#txBody").innerHTML = DB.transactions.filter((t) => !state.txType || t.type === state.txType).map((t) =>
    `<tr><td>${t.time}</td><td>${badge(t.type, TYPE_CLASS)}</td><td>${t.id}</td><td>${esc(t.name)}</td>
     <td class="r">${fmt(t.qty)}</td><td>${t.location}</td><td>${esc(t.partner)}</td><td>${badge(t.status, STATUS_CLASS)}</td></tr>`).join("");
}

function tick() { $("#clock").textContent = new Date().toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "medium" }); }
tick(); setInterval(tick, 1000);
$$(".sidebar nav a").forEach((a) => a.addEventListener("click", () => {
  $$(".sidebar nav a").forEach((x) => x.classList.remove("active")); a.classList.add("active");
}));
init();
