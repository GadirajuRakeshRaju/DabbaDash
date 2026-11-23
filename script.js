// ==========================================================
// DABBADASH - MANAGER DASHBOARD
// Depends on data.js (DD). State lives in localStorage and is
// shared with track.html so both views stay in sync.
// ==========================================================
"use strict";

const { esc, STAGES, MIN, BRANDS, SECTOR_NAMES, RIDERS } = DD;
const $ = id => document.getElementById(id);

let state = DD.loadState();
let lastRaw = DD.readRaw();
let trackedId = 104;                 // order shown in the tracking preview (demo order)
const justPacked = new Set();        // orders that just moved to Packed (highlight)
let clusterRadius = DD.CLUSTER_RADIUS_KM;

// ---------------- state helpers ----------------
function commit(mutator) {
    mutator(state);
    lastRaw = DD.saveState(state);
    renderAll();
}

function findOrder(id) {
    return state.orders.find(o => o.id === Number(id));
}

let toastTimer;
function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

const fmtRupee = n => "₹" + n.toFixed(2).replace(/\.00$/, "");
const timeOf = ms => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

// ---------------- KPI BAR ----------------
function kitchenMinutes(order, now) {
    return order.kitchenAt ? (now - order.kitchenAt) / MIN : 0;
}

function bottlenecks(now) {
    return state.orders.filter(o => o.status === "In Kitchen" &&
        kitchenMinutes(o, now) > DD.KITCHEN_ALERT_MIN);
}

function updateStats() {
    const now = Date.now();
    const o = state.orders;
    const done = o.filter(x => x.kitchenAt && x.packedAt);
    const avg = done.length
        ? done.reduce((s, x) => s + (x.packedAt - x.kitchenAt) / MIN, 0) / done.length : 0;
    const packed = o.filter(x => x.status === "Packed");
    const unassigned = packed.filter(x => !x.riderId).length;

    $("activeOrders").textContent = o.filter(x => x.status !== "Delivered").length;
    $("kitchenOrders").textContent = o.filter(x => x.status === "In Kitchen").length;
    $("avgPrep").textContent = Math.round(avg);
    $("avgPrepNote").textContent = done.length
        ? `Across ${done.length} completed kitchen tickets` : "No completed tickets yet";
    $("pendingOrders").textContent = packed.length;
    $("pendingNote").textContent = packed.length
        ? `${unassigned} still need a courier` : "No orders waiting";
    $("orderCount").textContent = o.length + " ORDERS";

    const late = bottlenecks(now);
    $("bottleneckCount").textContent = late.length;
    $("bottleneckCard").classList.toggle("danger", late.length > 0);

    const bar = $("alertBar");
    const sig = late.map(x => x.id + ":" + Math.floor(kitchenMinutes(x, now))).join("|");
    if (bar.dataset.sig !== sig) {
        bar.dataset.sig = sig;
        bar.hidden = late.length === 0;
        bar.innerHTML = late.length
            ? "<strong>⚠ Kitchen bottleneck:</strong> " + late.map(x =>
                `#DD${x.id} (${DD.brandOf(x.brandId).name}) has been cooking for ${Math.floor(kitchenMinutes(x, now))} min`).join(" • ")
            : "";
    }
}

// ---------------- BRANDS + MENU ----------------
function renderBrands() {
    $("brandGrid").innerHTML = BRANDS.map(b => {
        const mine = state.orders.filter(o => o.brandId === b.id);
        const active = mine.filter(o => o.status !== "Delivered").length;
        const revenue = mine.reduce((s, o) => s + DD.orderTotal(o), 0);
        const selected = $("brandFilter").value === b.id;
        return `
            <button type="button" class="brand-card ${selected ? "selected" : ""}" data-brand="${b.id}">
                <div class="brand-emoji">${b.emoji}</div>
                <div class="brand-text">
                    <strong>${esc(b.name)}</strong>
                    <small>${esc(b.cuisine)} • ${DD.MENU.filter(m => m.brandId === b.id).length} menu items</small>
                </div>
                <div class="brand-stats">
                    <strong>${active}</strong><small>active</small>
                    <em>₹${revenue}</em>
                </div>
            </button>`;
    }).join("");
}

function renderMenu() {
    $("menuColumns").innerHTML = BRANDS.map(b => `
        <div>
            <h4>${b.emoji} ${esc(b.name)}</h4>
            <ul>${DD.MENU.filter(m => m.brandId === b.id)
                .map(m => `<li><span>${esc(m.name)}</span><b>₹${m.price}</b></li>`).join("")}</ul>
        </div>`).join("");
}

// ---------------- KANBAN BOARD ----------------
const COLUMNS = [
    { status: "Received",         title: "Received",   icon: "📥" },
    { status: "In Kitchen",       title: "Cooking",    icon: "♨" },
    { status: "Packed",           title: "Packed",     icon: "📦" },
    { status: "Out for Delivery", title: "Dispatched", icon: "🛵" },
    { status: "Delivered",        title: "Delivered",  icon: "★" }
];

function visibleOrders() {
    const q = $("searchInput").value.trim().toLowerCase();
    const brand = $("brandFilter").value;
    const sector = $("sectorFilter").value;
    return state.orders.filter(o => {
        const hay = [("dd" + o.id), String(o.id), o.customer, DD.brandOf(o.brandId).name, DD.itemsText(o)]
            .join(" ").toLowerCase();
        return (!q || hay.includes(q)) &&
            (brand === "All" || o.brandId === brand) &&
            (sector === "All" || o.sector === sector);
    });
}

function timerHtml(o) {
    if (o.status === "Received") return `⏱ waiting <b data-since="${o.createdAt}">00:00</b>`;
    if (o.status === "In Kitchen") return `♨ cooking <b data-since="${o.kitchenAt}">00:00</b>`;
    if (o.status === "Packed") return `📦 packed <b data-since="${o.packedAt}">00:00</b> ago`;
    if (o.status === "Out for Delivery") return `🛵 ETA <b data-eta="${o.etaEndsAt}">--:--</b>`;
    return `✓ delivered ${timeOf(o.deliveredAt)}`;
}

function actionHtml(o) {
    const now = Date.now();
    if (o.status === "Received")
        return `<button class="order-action" data-action="advance" data-id="${o.id}">Start Cooking</button>`;
    if (o.status === "In Kitchen")
        return `<button class="order-action" data-action="advance" data-id="${o.id}">Mark Packed</button>`;
    if (o.status === "Out for Delivery")
        return `<button class="order-action" data-action="advance" data-id="${o.id}">Mark Delivered</button>`;
    if (o.status === "Delivered") return `<div class="done-note">Completed</div>`;

    // Packed
    if (o.riderId) {
        const r = DD.riderOf(o.riderId);
        return `
            <div class="assigned-note">✔ Courier <strong>${esc(r.name)}</strong> (${esc(r.vehicle)}) assigned</div>
            <div class="btn-row">
                <button class="order-action" data-action="dispatch" data-id="${o.id}">Dispatch</button>
                <button class="order-action subtle" data-action="unassign" data-id="${o.id}">Unassign</button>
            </div>`;
    }
    const recs = DD.recommendRiders(state, o, now);
    const best = recs[0] && recs[0].free > 0 ? recs[0] : null;
    const options = recs.map(r => {
        const full = r.free <= 0;
        const star = best && r.rider.id === best.rider.id ? "★ " : "";
        return `<option value="${r.rider.id}" ${full ? "disabled" : ""} ${star ? "selected" : ""}>
            ${star}${esc(r.rider.name)} · ${esc(r.rider.sector)} · ${r.km.toFixed(1)} km · ${full ? "FULL" : r.free + " free"}
        </option>`;
    }).join("");
    return `
        <div class="recommend ${justPacked.has(o.id) ? "pulse" : ""}">
            ${best
                ? `★ Recommended: <strong>${esc(best.rider.name)} (${esc(best.rider.sector)})</strong>
                   ${best.sameSector ? "same sector" : "nearest free"}, ${best.km.toFixed(1)} km away`
                : "No courier with free capacity right now"}
        </div>
        <div class="btn-row">
            <select data-assign-for="${o.id}" aria-label="Courier for order ${o.id}">${options}</select>
            <button class="order-action" data-action="assign" data-id="${o.id}" ${best ? "" : "disabled"}>Assign</button>
        </div>`;
}

function cardHtml(o) {
    const brand = DD.brandOf(o.brandId);
    const rider = DD.riderOf(o.riderId);
    const kitchenAttr = o.status === "In Kitchen" ? `data-kitchen-ts="${o.kitchenAt}"` : "";
    const late = o.status === "In Kitchen" && kitchenMinutes(o, Date.now()) > DD.KITCHEN_ALERT_MIN;
    return `
        <article class="order-card ${late ? "bottleneck" : ""} ${justPacked.has(o.id) ? "just-moved" : ""}" ${kitchenAttr} data-order="${o.id}">
            <div class="order-top">
                <span class="order-id">#DD${o.id}</span>
                <span class="brand-pill">${brand.emoji} ${esc(brand.name)}</span>
            </div>
            <span class="alert-chip">⚠ OVER 20 MIN IN KITCHEN</span>
            <div class="order-customer">${esc(o.customer)}</div>
            <div class="order-items">${esc(DD.itemsText(o))}</div>
            <div class="order-meta">
                <span>${esc(o.sector)}</span>
                <span>₹${DD.orderTotal(o)}</span>
                <span>${rider ? "🛵 " + esc(rider.name) : "No rider"}</span>
            </div>
            <div class="order-timer">${timerHtml(o)}</div>
            ${actionHtml(o)}
        </article>`;
}

function renderBoard() {
    const list = visibleOrders();
    $("kanban").innerHTML = COLUMNS.map(col => {
        const items = list.filter(o => o.status === col.status)
            .sort((a, b) => col.status === "Delivered" ? b.deliveredAt - a.deliveredAt : a.createdAt - b.createdAt);
        return `
            <div class="kan-col" data-status="${col.status}">
                <div class="kan-head">
                    <span>${col.icon} ${col.title}</span><b>${items.length}</b>
                </div>
                <div class="kan-body">
                    ${items.length ? items.map(cardHtml).join("") : '<div class="kan-empty">No orders</div>'}
                </div>
            </div>`;
    }).join("");
    updateTimers();   // avoid a 1s flash of 00:00 after every re-render
}

// ---------------- ORDER ACTIONS ----------------
function sms(order, text) { DD.pushSms(order, text); }

function advance(id) {
    const o = findOrder(id);
    if (!o) return;
    let message = "";
    let recommendation = null;

    commit(() => {
        const now = Date.now();
        if (o.status === "Received") {
            o.status = "In Kitchen"; o.kitchenAt = now;
            message = `#DD${o.id} sent to the kitchen`;
        } else if (o.status === "In Kitchen") {
            o.status = "Packed"; o.packedAt = now;
            justPacked.add(o.id);
            setTimeout(() => { justPacked.delete(o.id); renderBoard(); }, 4000);
            recommendation = DD.recommendRiders(state, o, now)[0];
            message = `#DD${o.id} packed.` + (recommendation && recommendation.free > 0
                ? ` Recommended courier: ${recommendation.rider.name} (${recommendation.rider.sector}).` : " No free courier yet.");
        } else if (o.status === "Out for Delivery") {
            o.status = "Delivered"; o.deliveredAt = now; o.etaEndsAt = null;
            sms(o, `Delivered! Thanks for ordering from ${DD.brandOf(o.brandId).name}, ${o.customer}.`);
            message = `#DD${o.id} delivered`;
        }
    });
    showToast(message);
}

function assign(id, riderId) {
    const o = findOrder(id);
    const r = DD.riderOf(riderId);
    if (!o || !r || o.status !== "Packed") return;
    if (DD.riderLoad(state, r) >= r.capacity) { showToast(`${r.name} is at full capacity (${r.capacity}).`); return; }
    commit(() => {
        o.riderId = r.id;
        sms(o, `Hi ${o.customer}, courier ${r.name} will pick up your ${DD.brandOf(o.brandId).name} order #DD${o.id} shortly.`);
    });
    showToast(`${r.name} assigned to #DD${o.id}`);
}

function dispatch(id) {
    const o = findOrder(id);
    if (!o || o.status !== "Packed" || !o.riderId) return;
    commit(() => {
        const now = Date.now();
        o.status = "Out for Delivery";
        o.dispatchedAt = now;
        o.etaEndsAt = now + o.transitMin * MIN;
        sms(o, `Your order #DD${o.id} is out for delivery with ${DD.riderOf(o.riderId).name}. ETA ${o.transitMin} min.`);
    });
    showToast(`#DD${o.id} dispatched with ${DD.riderOf(o.riderId).name}`);
}

function unassign(id) {
    const o = findOrder(id);
    if (!o) return;
    commit(() => { o.riderId = null; });
    showToast(`Courier removed from #DD${o.id}`);
}

$("kanban").addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;
    switch (btn.dataset.action) {
        case "advance": advance(id); break;
        case "dispatch": dispatch(id); break;
        case "unassign": unassign(id); break;
        case "assign": {
            const sel = document.querySelector(`select[data-assign-for="${id}"]`);
            assign(id, sel && sel.value);
            break;
        }
    }
});

["searchInput", "brandFilter", "sectorFilter"].forEach(id =>
    $(id).addEventListener(id === "searchInput" ? "input" : "change", () => { renderBoard(); renderBrands(); }));

$("brandGrid").addEventListener("click", e => {
    const card = e.target.closest("[data-brand]");
    if (!card) return;
    const f = $("brandFilter");
    f.value = f.value === card.dataset.brand ? "All" : card.dataset.brand;
    renderBoard(); renderBrands();
    $("orders").scrollIntoView({ behavior: "smooth" });
});

// ---------------- RIDER CONSOLE ----------------
function renderRiders() {
    $("riderGrid").innerHTML = RIDERS.map(r => {
        const load = DD.riderLoad(state, r);
        const mine = state.orders.filter(o => o.riderId === r.id && (o.status === "Packed" || o.status === "Out for Delivery"));
        const cls = load === 0 ? "" : load >= r.capacity ? "full" : "busy";
        const label = load === 0 ? "● AVAILABLE" : load >= r.capacity ? "● FULL" : "● PARTIAL";
        const delivered = state.orders.filter(o => o.riderId === r.id && o.status === "Delivered").length;
        return `
            <div class="rider-card">
                <div class="rider-top">
                    <div class="rider-avatar">${esc(r.name[0])}</div>
                    <div><strong>${esc(r.name)}</strong><small>${esc(r.vehicle)} • ${esc(r.sector)}</small></div>
                    <span class="rider-status ${cls}">${label}</span>
                </div>
                <div class="cap-row">
                    <small>CAPACITY ${load}/${r.capacity}</small>
                    <div class="cap-bar" role="img" aria-label="${load} of ${r.capacity} orders">
                        ${Array.from({ length: r.capacity }, (_, i) => `<i class="${i < load ? "on" : ""}"></i>`).join("")}
                    </div>
                </div>
                <div class="rider-details">
                    <div><small>CARRYING</small><strong>${mine.length ? mine.map(o => "#DD" + o.id).join(", ") : "None"}</strong></div>
                    <div><small>DELIVERED</small><strong>${delivered}</strong></div>
                </div>
            </div>`;
    }).join("");
}

// ---------------- ZONES + BATCHER ----------------
function renderZones() {
    $("zoneGrid").innerHTML = SECTOR_NAMES.map(name => {
        const s = DD.SECTORS[name];
        const active = state.orders.filter(o => o.sector === name && o.status !== "Delivered").length;
        const ready = state.orders.filter(o => o.sector === name && o.status === "Packed").length;
        const free = RIDERS.filter(r => r.sector === name && DD.riderLoad(state, r) < r.capacity).length;
        return `
            <div class="zone-card">
                <h3>◎ ${esc(name)}</h3>
                <small class="zone-area">${esc(s.area)}</small>
                <strong>${active}</strong>
                <small>active orders • ${ready} packed • ${free} riders free</small>
            </div>`;
    }).join("");
}

function suggestRider(batch) {
    const n = batch.orders.length;
    const cands = RIDERS.map(r => {
        const already = batch.orders.filter(o => o.riderId === r.id).length;
        const avail = r.capacity - DD.riderLoad(state, r) + already;   // seats usable for this batch
        return { r, avail, already, km: DD.kmBetween(DD.riderPosition(state, r, Date.now()), batch.center) };
    }).filter(c => c.avail > 0);
    cands.sort((a, b) =>
        ((b.avail >= n) - (a.avail >= n)) || (b.already - a.already) || (a.km - b.km));
    return cands[0] || null;
}

function computeBatches() {
    const packed = state.orders.filter(o => o.status === "Packed");
    return DD.clusterOrders(packed, clusterRadius);
}

function renderBatches() {
    const batches = computeBatches();
    $("radiusLabel").textContent = clusterRadius + " km";
    if (!batches.length) {
        $("batchList").innerHTML = `<div class="batch-empty">No packed orders to batch right now. Mark an order as Packed to see grouping.</div>`;
        return;
    }
    $("batchList").innerHTML = batches.map((b, i) => {
        const n = b.orders.length;
        const s = suggestRider(b);
        const allAssigned = b.orders.every(o => o.riderId);
        const sameRider = allAssigned && b.orders.every(o => o.riderId === b.orders[0].riderId);
        const avgDist = b.orders.reduce((t, o) => t + o.distKm, 0) / n;
        const saving = (n - 1) * (25 + 8 * avgDist);
        let action = "";
        if (sameRider) {
            action = `<button class="primary-btn" data-batch-dispatch="${b.orders.map(o => o.id).join(",")}">Dispatch batch with ${esc(DD.riderOf(b.orders[0].riderId).name)}</button>`;
        } else if (s) {
            action = `<button class="primary-btn" data-batch-assign="${b.orders.map(o => o.id).join(",")}" data-rider="${s.r.id}">Assign ${n > s.avail ? s.avail + " of " + n : "batch"} to ${esc(s.r.name)}</button>`;
        } else {
            action = `<span class="batch-warn">No courier has free capacity</span>`;
        }
        return `
            <div class="batch-card">
                <div class="batch-head">
                    <strong>Batch ${i + 1} · ${esc(b.sector)}</strong>
                    <span>${n} order${n > 1 ? "s" : ""} · spread ${b.spreadKm.toFixed(1)} km</span>
                </div>
                <div class="batch-orders">${b.orders.map(o =>
                    `<span class="chip">#DD${o.id} ${esc(o.customer)}${o.riderId ? " · 🛵 " + esc(DD.riderOf(o.riderId).name) : ""}</span>`).join("")}</div>
                <div class="batch-foot">
                    <small>${n > 1
                        ? `One trip instead of ${n}: saves about ${fmtRupee(saving)} in delivery cost.`
                        : "Single order in this area: no batching gain yet."}
                    ${s ? ` Suggested courier: <b>${esc(s.r.name)}</b> (${esc(s.r.vehicle)}, ${s.avail} seat${s.avail > 1 ? "s" : ""} free).` : ""}</small>
                    ${action}
                </div>
            </div>`;
    }).join("");
}

$("radiusRange").addEventListener("input", e => {
    clusterRadius = Number(e.target.value);
    renderBatches(); updateMap(true);
});

$("batchList").addEventListener("click", e => {
    const a = e.target.closest("[data-batch-assign]");
    const d = e.target.closest("[data-batch-dispatch]");
    if (a) {
        const r = DD.riderOf(a.dataset.rider);
        const ids = a.dataset.batchAssign.split(",").map(Number);
        let count = 0;
        commit(() => {
            ids.forEach(id => {
                const o = findOrder(id);
                if (o && !o.riderId && DD.riderLoad(state, r) < r.capacity) {
                    o.riderId = r.id; count++;
                    sms(o, `Hi ${o.customer}, courier ${r.name} will pick up your order #DD${o.id} shortly.`);
                }
            });
        });
        showToast(`${r.name} assigned to ${count} order${count === 1 ? "" : "s"} in the batch`);
    } else if (d) {
        const ids = d.dataset.batchDispatch.split(",").map(Number);
        ids.forEach(id => dispatch(id));
    }
});

// ---------------- MAP (Leaflet) ----------------
let map, hubLayer, riderMarkers = {}, orderMarkers = {}, clusterLayer, mapReady = false;
const STATUS_COLOR = { "Received": "#79b5ff", "In Kitchen": "#d6b5ff", "Packed": "#ffc16d", "Out for Delivery": "#48dfb0" };

function initMap() {
    const el = $("deliveryMap");
    if (typeof L === "undefined") { mapFallback(); return; }
    map = L.map("deliveryMap", { scrollWheelZoom: false }).setView([17.435, 78.44], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
    clusterLayer = L.layerGroup().addTo(map);
    L.marker([DD.HUB.lat, DD.HUB.lng], {
        icon: L.divIcon({ className: "pin pin-hub", html: "🍳", iconSize: [34, 34], iconAnchor: [17, 17] })
    }).addTo(map).bindPopup(`<strong>${esc(DD.HUB.name)}</strong><br>Commissary kitchen hub`);
    mapReady = true;
    setTimeout(() => map.invalidateSize(), 300);
    updateMap(true);
}

function mapFallback() {
    // Offline / CDN blocked: draw a simple coordinate plot so the section is never blank.
    const el = $("deliveryMap");
    el.classList.add("map-fallback");
    el.innerHTML = `<div class="fb-note">Map tiles unavailable (offline). Showing a simplified position plot.</div><svg id="fbSvg" viewBox="0 0 600 300" preserveAspectRatio="xMidYMid meet" aria-label="Simplified position plot"></svg>`;
}

function drawFallback() {
    const svg = $("fbSvg");
    if (!svg) return;
    const lat0 = 17.40, lat1 = 17.47, lng0 = 78.33, lng1 = 78.52;
    const px = p => [(p.lng - lng0) / (lng1 - lng0) * 560 + 20, (lat1 - p.lat) / (lat1 - lat0) * 260 + 20];
    let out = "";
    SECTOR_NAMES.forEach(n => { const [x, y] = px(DD.SECTORS[n]); out += `<text x="${x}" y="${y - 30}" fill="#9298a7" font-size="11" text-anchor="middle">${n}</text>`; });
    const [hx, hy] = px(DD.HUB);
    out += `<text x="${hx}" y="${hy}" font-size="16" text-anchor="middle">🍳</text>`;
    state.orders.filter(o => o.status !== "Delivered").forEach(o => {
        const [x, y] = px(o);
        out += `<circle cx="${x}" cy="${y}" r="5" fill="${STATUS_COLOR[o.status]}"><title>#DD${o.id} ${o.status}</title></circle>`;
    });
    RIDERS.forEach(r => {
        const [x, y] = px(DD.riderPosition(state, r, Date.now()));
        out += `<text x="${x}" y="${y}" font-size="14" text-anchor="middle">🛵<title>${esc(r.name)}</title></text>`;
    });
    svg.innerHTML = out;
}

let clusterSig = "";
function updateMap(force) {
    if (!mapReady) { drawFallback(); return; }
    const now = Date.now();

    // couriers
    RIDERS.forEach(r => {
        const pos = DD.riderPosition(state, r, now);
        const load = DD.riderLoad(state, r);
        const popup = `<strong>${esc(r.name)}</strong><br>${esc(r.vehicle)} · ${esc(r.sector)}<br>${load ? "Carrying " + load + " order(s)" : "Available"}`;
        if (!riderMarkers[r.id]) {
            riderMarkers[r.id] = L.marker([pos.lat, pos.lng], {
                icon: L.divIcon({ className: "pin pin-rider", html: "🛵", iconSize: [30, 30], iconAnchor: [15, 15] })
            }).addTo(map).bindPopup(popup);
        } else {
            riderMarkers[r.id].setLatLng([pos.lat, pos.lng]).setPopupContent(popup);
        }
    });

    // order pins
    const active = state.orders.filter(o => o.status !== "Delivered");
    Object.keys(orderMarkers).forEach(id => {
        if (!active.some(o => o.id === Number(id))) { map.removeLayer(orderMarkers[id]); delete orderMarkers[id]; }
    });
    active.forEach(o => {
        const popup = `<strong>#DD${o.id}</strong> ${esc(o.customer)}<br>${esc(DD.brandOf(o.brandId).name)}<br>${esc(o.status)} · ${esc(o.sector)}`;
        const style = { radius: 8, color: "#fff", weight: 1.5, fillColor: STATUS_COLOR[o.status], fillOpacity: 0.95 };
        if (!orderMarkers[o.id]) {
            orderMarkers[o.id] = L.circleMarker([o.lat, o.lng], style).addTo(map).bindPopup(popup);
        } else {
            orderMarkers[o.id].setStyle(style).setPopupContent(popup);
        }
    });

    // batch clusters
    const batches = computeBatches().filter(b => b.orders.length > 1);
    const sig = clusterRadius + "|" + batches.map(b => b.orders.map(o => o.id).join(",")).join(";");
    if (force || sig !== clusterSig) {
        clusterSig = sig;
        clusterLayer.clearLayers();
        batches.forEach((b, i) => {
            L.circle([b.center.lat, b.center.lng], {
                radius: Math.max(400, b.spreadKm * 1000 + 300),
                color: "#ff8b36", weight: 2, dashArray: "6 6", fillOpacity: 0.08
            }).addTo(clusterLayer).bindTooltip(`Batch ${i + 1}: ${b.orders.length} orders`);
        });
    }
}

// ---------------- CUSTOMER TRACKING + SMS ----------------
function renderTrackingOptions() {
    const sel = $("trackingSelect");
    sel.innerHTML = state.orders.map(o =>
        `<option value="${o.id}">#DD${o.id} - ${esc(o.customer)} (${esc(o.status)})</option>`).join("");
    if (!state.orders.some(o => o.id === trackedId)) trackedId = state.orders[0] ? state.orders[0].id : null;
    sel.value = String(trackedId);
    $("openTrackPage").href = "track.html?order=" + trackedId;
}

function renderTracker() {
    DD.updateTracker($("trackerRoot"), findOrder(trackedId), Date.now());
}

$("trackingSelect").addEventListener("change", e => {
    trackedId = Number(e.target.value);
    $("openTrackPage").href = "track.html?order=" + trackedId;
    renderTracker();
});

$("sendSmsBtn").addEventListener("click", () => {
    const o = findOrder(trackedId);
    if (!o) return;
    DD.pushSms(o, `Hi ${o.customer}, track your ${DD.brandOf(o.brandId).name} order #DD${o.id} live:`);
    renderSms();
    showToast(`Tracking SMS sent to ${o.phone}`);
});

function renderSms() {
    const log = DD.loadSms();
    $("smsList").innerHTML = log.length
        ? log.map(m => `
            <div class="sms">
                <div class="sms-meta">To ${esc(m.to)} · ${esc(m.phone)} · ${timeOf(m.at)}</div>
                <div class="sms-text">DabbaDash: ${esc(m.text)}
                    <a href="${esc(m.link)}" target="_blank" rel="noopener">${esc(m.link.replace(/^.*\//, ""))}</a></div>
            </div>`).join("")
        : `<div class="sms-empty">No messages yet. Assign or dispatch an order, or press "Send tracking SMS".</div>`;
}

// ---------------- PAYOUT ----------------
function initPayout() {
    $("payoutRider").innerHTML = RIDERS.map(r => `<option value="${r.id}">${esc(r.name)} (${esc(r.vehicle)})</option>`).join("");
    $("payoutRider").value = "3";
    ["payoutRider", "payoutBase", "payoutPerKm", "payoutSurge", "payoutBonus", "payoutDeductions"]
        .forEach(id => $(id).addEventListener(id === "payoutRider" || id === "payoutSurge" ? "change" : "input", renderPayout));
}

function num(id) { return Math.max(0, Number($(id).value) || 0); }

function renderPayout() {
    const rid = Number($("payoutRider").value);
    const base = num("payoutBase"), perKm = num("payoutPerKm");
    const bonus = num("payoutBonus"), ded = num("payoutDeductions");
    const mode = $("payoutSurge").value;
    const surge = DD.surgeActive(state, mode, Date.now());
    const mult = surge ? 1.5 : 1;

    const trips = state.orders.filter(o => o.riderId === rid &&
        (o.status === "Delivered" || o.status === "Out for Delivery"));
    const fare = o => (base + perKm * o.distKm) * mult;
    const paid = trips.filter(o => o.status === "Delivered");
    const earnings = paid.reduce((s, o) => s + fare(o), 0);
    const total = Math.max(0, earnings + bonus - ded);

    $("completedDeliveries").textContent = paid.length;
    $("payoutKm").textContent = paid.reduce((s, o) => s + o.distKm, 0).toFixed(1) + " km";
    $("payoutSurgeState").textContent = surge ? "ON ×1.5" : "Off";
    $("totalPayout").textContent = "₹" + total.toFixed(2);
    $("tripRows").innerHTML = trips.length
        ? trips.map(o => `<tr><td>#DD${o.id}</td><td>${esc(o.sector)}</td><td>${o.distKm.toFixed(1)} km</td>
            <td>${fmtRupee(fare(o))}</td><td>${o.status === "Delivered" ? "Paid" : "On the road"}</td></tr>`).join("")
        : `<tr><td colspan="5" class="sms-empty">No trips for this rider yet.</td></tr>`;
}

// ---------------- SIMULATE NEW ORDER / RESET / LOGOUT ----------------
const NAMES = ["Aarav Mehta", "Ishita Nair", "Farhan Ali", "Lakshmi Devi", "Tarun Gupta", "Zoya Khan", "Bharat Yadav", "Nisha Iyer"];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

$("newOrderBtn").addEventListener("click", () => {
    const brand = pick(BRANDS);
    const menu = DD.MENU.filter(m => m.brandId === brand.id).sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 3));
    const sector = pick(SECTOR_NAMES);
    const pt = DD.offsetPoint(DD.SECTORS[sector], (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6);
    const dist = DD.kmBetween(DD.HUB, pt);
    const now = Date.now();
    const order = {
        id: Math.max(...state.orders.map(o => o.id)) + 1,
        customer: pick(NAMES), phone: "+91 9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"),
        brandId: brand.id, items: menu.map(m => ({ menuId: m.id, qty: 1 + Math.floor(Math.random() * 2) })),
        sector, lat: pt.lat, lng: pt.lng, distKm: Math.round(dist * 10) / 10,
        status: "Received", riderId: null,
        createdAt: now, kitchenAt: null, packedAt: null, dispatchedAt: null, deliveredAt: null,
        transitMin: DD.transitMinutes(dist), etaEndsAt: null
    };
    commit(s => s.orders.push(order));
    showToast(`New ${brand.name} order #DD${order.id} received`);
});

$("resetBtn").addEventListener("click", () => {
    if (!confirm("Reset all orders and SMS messages to the original demo data?")) return;
    state = DD.resetState();
    lastRaw = DD.readRaw();
    trackedId = 104;
    justPacked.clear();
    renderAll();
    showToast("Demo data reset");
});

$("logoutLink").addEventListener("click", e => {
    e.preventDefault();
    try { sessionStorage.removeItem("dabbaDashLoggedIn"); } catch (err) { /* ignore */ }
    window.location.href = "login.html";
});

// active nav highlight
const navLinks = document.querySelectorAll(".nav-link");
navLinks.forEach(l => l.addEventListener("click", () => {
    navLinks.forEach(x => x.classList.remove("active")); l.classList.add("active");
}));

// ---------------- RENDER / LIVE LOOPS ----------------
function renderAll() {
    updateStats();
    renderBrands();
    renderBoard();
    renderRiders();
    renderZones();
    renderBatches();
    renderTrackingOptions();
    renderTracker();
    renderSms();
    renderPayout();
    updateMap(false);
    updateTimers();
}

function updateTimers() {
    const now = Date.now();
    document.querySelectorAll("[data-since]").forEach(el => {
        el.textContent = DD.fmtClock(now - Number(el.dataset.since));
    });
    document.querySelectorAll("[data-eta]").forEach(el => {
        const left = Number(el.dataset.eta) - now;
        el.textContent = left > 0 ? DD.fmtClock(left) : "Arriving";
    });
    document.querySelectorAll(".order-card[data-kitchen-ts]").forEach(card => {
        card.classList.toggle("bottleneck", (now - Number(card.dataset.kitchenTs)) / MIN > DD.KITCHEN_ALERT_MIN);
    });
}

// every second: timers, KPIs, bottleneck flags, tracker countdown, moving couriers
setInterval(() => { updateTimers(); updateStats(); renderTracker(); updateMap(false); }, 1000);

// every 3 seconds: pick up changes made in another tab (e.g. the customer page)
function poll() {
    const raw = DD.readRaw();
    if (raw && raw !== lastRaw) {
        const parsed = DD.parseState(raw);
        if (parsed) { state = parsed; lastRaw = raw; renderAll(); }
    }
}
setInterval(poll, 3000);
window.addEventListener("storage", poll);

// ---------------- START ----------------
(function init() {
    BRANDS.forEach(b => $("brandFilter").insertAdjacentHTML("beforeend", `<option value="${b.id}">${esc(b.name)}</option>`));
    SECTOR_NAMES.forEach(s => $("sectorFilter").insertAdjacentHTML("beforeend", `<option value="${s}">${s}</option>`));
    DD.buildTracker($("trackerRoot"));
    renderMenu();
    initPayout();
    initMap();
    renderAll();
})();
