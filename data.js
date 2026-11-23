// ==========================================================
// DABBADASH - SHARED DATA LAYER
// Used by BOTH the manager dashboard (index.html) and the
// customer tracking page (track.html). Both pages read/write
// the same localStorage state, so a status change in one is
// seen in the other within 3 seconds (polling) or instantly
// (storage event).
// ==========================================================
"use strict";

const DD = (function () {

    const STORAGE_KEY = "dabbaDashStateV2";
    const SMS_KEY = "dabbaDashSmsV2";
    const STAGES = ["Received", "In Kitchen", "Packed", "Out for Delivery", "Delivered"];
    const KITCHEN_ALERT_MIN = 20;          // bottleneck threshold (brief)
    const CLUSTER_RADIUS_KM = 2.5;         // batching radius (brief)
    const HUB = { name: "DabbaDash Central Kitchen", lat: 17.4440, lng: 78.4670 };

    // ---------- 1. BRANDS (3) ----------
    const BRANDS = [
        { id: "biryani", name: "Biryani Box", emoji: "🍛", cuisine: "Indian Cuisine" },
        { id: "burger",  name: "Burger Den",  emoji: "🍔", cuisine: "Fast Food" },
        { id: "chai",    name: "Chai Point",  emoji: "☕", cuisine: "Beverages & Snacks" }
    ];

    // ---------- 2. MENU ITEMS (20, each tagged with brandId) ----------
    const MENU = [
        { id: "b1", brandId: "biryani", name: "Chicken Biryani", price: 249 },
        { id: "b2", brandId: "biryani", name: "Mutton Biryani",  price: 299 },
        { id: "b3", brandId: "biryani", name: "Veg Biryani",     price: 179 },
        { id: "b4", brandId: "biryani", name: "Paneer Biryani",  price: 219 },
        { id: "b5", brandId: "biryani", name: "Egg Biryani",     price: 199 },
        { id: "b6", brandId: "biryani", name: "Raita",           price: 39 },
        { id: "b7", brandId: "biryani", name: "Double Ka Meetha", price: 79 },
        { id: "g1", brandId: "burger",  name: "Cheese Burger",   price: 199 },
        { id: "g2", brandId: "burger",  name: "Chicken Burger",  price: 229 },
        { id: "g3", brandId: "burger",  name: "Veg Burger",      price: 159 },
        { id: "g4", brandId: "burger",  name: "Double Burger",   price: 279 },
        { id: "g5", brandId: "burger",  name: "Fries",           price: 99 },
        { id: "g6", brandId: "burger",  name: "Peri Peri Wings", price: 189 },
        { id: "g7", brandId: "burger",  name: "Coke",            price: 49 },
        { id: "c1", brandId: "chai",    name: "Masala Chai",     price: 49 },
        { id: "c2", brandId: "chai",    name: "Ginger Tea",      price: 59 },
        { id: "c3", brandId: "chai",    name: "Cold Coffee",     price: 129 },
        { id: "c4", brandId: "chai",    name: "Samosa (2 pcs)",  price: 40 },
        { id: "c5", brandId: "chai",    name: "Bun Maska",       price: 60 },
        { id: "c6", brandId: "chai",    name: "Veg Puff",        price: 45 }
    ];

    // ---------- 3. DELIVERY SECTORS (4) ----------
    const SECTORS = {
        "Sector A": { area: "Banjara Hills", lat: 17.4156, lng: 78.4347 },
        "Sector B": { area: "Secunderabad",  lat: 17.4399, lng: 78.4983 },
        "Sector C": { area: "Madhapur",      lat: 17.4486, lng: 78.3908 },
        "Sector D": { area: "Gachibowli",    lat: 17.4401, lng: 78.3489 }
    };
    const SECTOR_NAMES = Object.keys(SECTORS);

    // ---------- 4. RIDERS (6) - capacity depends on vehicle ----------
    // off = resting offset (km east, km north) from sector centre
    const RIDERS = [
        { id: 1, name: "Ramesh", sector: "Sector B", vehicle: "Bike",    capacity: 2, off: [0.3, 0.2] },
        { id: 2, name: "Suresh", sector: "Sector A", vehicle: "Scooter", capacity: 3, off: [0.2, -0.3] },
        { id: 3, name: "Arjun",  sector: "Sector C", vehicle: "Bike",    capacity: 2, off: [-0.3, 0.3] },
        { id: 4, name: "Kiran",  sector: "Sector D", vehicle: "Bike",    capacity: 2, off: [0.3, 0.3] },
        { id: 5, name: "Rahul",  sector: "Sector A", vehicle: "Scooter", capacity: 3, off: [-0.5, 0.4] },
        { id: 6, name: "Vikram", sector: "Sector B", vehicle: "Bike",    capacity: 2, off: [1.2, 0.9] }
    ];

    // ---------- helpers ----------
    const brandOf = id => BRANDS.find(b => b.id === id);
    const menuOf = id => MENU.find(m => m.id === id);
    const riderOf = id => RIDERS.find(r => r.id === Number(id)) || null;

    function esc(value) {
        return String(value).replace(/[&<>"']/g, c => (
            { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function kmBetween(a, b) {
        const R = 6371, rad = d => d * Math.PI / 180;
        const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
        const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function offsetPoint(base, dxKm, dyKm) {
        return {
            lat: base.lat + dyKm / 111,
            lng: base.lng + dxKm / (111 * Math.cos(base.lat * Math.PI / 180))
        };
    }

    function orderTotal(order) {
        return order.items.reduce((sum, i) => sum + (menuOf(i.menuId)?.price || 0) * i.qty, 0);
    }

    function itemsText(order) {
        return order.items.map(i => `${i.qty}× ${menuOf(i.menuId)?.name || i.menuId}`).join(", ");
    }

    function transitMinutes(distKm) {
        return Math.min(15, Math.max(6, Math.round(4 + distKm * 1.5)));
    }

    const MIN = 60000;

    // ---------- 5. SEED: 15 orders ----------
    // [id, customer, brandId, items, sector, dx, dy, status, riderId,
    //  createdAgo, kitchenAgo, packedAgo, dispatchedAgo, deliveredAgo]
    function makeSeed(now) {
        const rows = [
            [101, "Rahul Sharma", "biryani", [["b1", 1], ["b6", 1]], "Sector A", 0.3, 0.2, "Received", null, 3, null, null, null, null],
            [102, "Priya Reddy",  "burger",  [["g1", 1], ["g5", 1]], "Sector B", 0.4, -0.3, "In Kitchen", null, 14, 12, null, null, null],
            [103, "Arjun Kumar",  "chai",    [["c1", 2], ["c4", 1]], "Sector C", 0.3, 0.2, "Packed", null, 22, 17, 8, null, null],
            [104, "Vishal Reddy", "burger",  [["g1", 2], ["g5", 1]], "Sector B", 0.5, 0.4, "In Kitchen", null, 17, 15, null, null, null],
            [105, "Sneha Rao",    "biryani", [["b3", 1], ["b7", 1]], "Sector A", -0.4, 0.3, "Received", null, 2, null, null, null, null],
            [106, "Karthik Raju", "chai",    [["c2", 1], ["c4", 1]], "Sector D", 0.2, -0.2, "Out for Delivery", 4, 30, 25, 15, 4, null],
            [107, "Ananya Das",   "burger",  [["g2", 1], ["g5", 1]], "Sector C", -0.6, 0.5, "Packed", null, 31, 25, 6, null, null],
            [108, "Sai Charan",   "biryani", [["b2", 1]],            "Sector B", -0.3, 0.3, "In Kitchen", null, 24, 22, null, null, null],
            [109, "Meghana",      "chai",    [["c3", 1]],            "Sector A", 0.2, -0.4, "Delivered", 2, 55, 50, 40, 35, 22],
            [110, "Nikhil",       "burger",  [["g3", 1], ["g7", 1]], "Sector D", 0.4, 0.3, "Packed", null, 28, 22, 6, null, null],
            [111, "Pooja",        "biryani", [["b1", 1]],            "Sector C", 0.5, -0.4, "Delivered", 3, 70, 65, 50, 45, 30],
            [112, "Manoj",        "chai",    [["c2", 1]],            "Sector B", -0.2, 0.5, "Delivered", 1, 60, 56, 48, 44, 33],
            [113, "Divya",        "burger",  [["g4", 1], ["g5", 1]], "Sector A", 0.1, 0.5, "In Kitchen", null, 21, 19, null, null, null],
            [114, "Rohit",        "biryani", [["b3", 1], ["b6", 1]], "Sector D", -0.5, -0.6, "Packed", null, 26, 22, 10, null, null],
            [115, "Keerthi",      "chai",    [["c2", 1], ["c6", 1]], "Sector C", 0.2, 0.1, "Out for Delivery", 3, 20, 16, 8, 6, null]
        ];
        const ago = m => (m == null ? null : now - m * MIN);

        return rows.map(r => {
            const pt = offsetPoint(SECTORS[r[4]], r[5], r[6]);
            const distKm = kmBetween(HUB, pt);
            const transit = transitMinutes(distKm);
            const dispatchedAt = ago(r[12]);
            return {
                id: r[0], customer: r[1], phone: "+91 98" + String(r[0] * 7919).padStart(8, "0").slice(-8),
                brandId: r[2], items: r[3].map(i => ({ menuId: i[0], qty: i[1] })),
                sector: r[4], lat: pt.lat, lng: pt.lng, distKm: Math.round(distKm * 10) / 10,
                status: r[7], riderId: r[8],
                createdAt: ago(r[9]), kitchenAt: ago(r[10]), packedAt: ago(r[11]),
                dispatchedAt, deliveredAt: ago(r[13]),
                transitMin: transit,
                etaEndsAt: r[7] === "Out for Delivery" ? dispatchedAt + transit * MIN : null
            };
        });
    }

    // ---------- 6. STATE (localStorage with safe fallback) ----------
    let memoryRaw = null;

    function readRaw() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return memoryRaw; }
    }

    function writeRaw(raw) {
        memoryRaw = raw;
        try { localStorage.setItem(STORAGE_KEY, raw); } catch (e) { /* private mode */ }
    }

    function parseState(raw) {
        try {
            const s = JSON.parse(raw);
            if (s && s.version === 2 && Array.isArray(s.orders)) return s;
        } catch (e) { /* fall through */ }
        return null;
    }

    function freshState() {
        return { version: 2, orders: makeSeed(Date.now()) };
    }

    function loadState() {
        const raw = readRaw();
        const parsed = raw && parseState(raw);
        if (parsed) return parsed;
        const s = freshState();
        writeRaw(JSON.stringify(s));
        return s;
    }

    function saveState(state) {
        const raw = JSON.stringify(state);
        writeRaw(raw);
        return raw;
    }

    function resetState() {
        try { localStorage.removeItem(SMS_KEY); } catch (e) { /* ignore */ }
        const s = freshState();
        saveState(s);
        return s;
    }

    // ---------- 7. SMS LOG ----------
    function loadSms() {
        try { return JSON.parse(localStorage.getItem(SMS_KEY)) || []; } catch (e) { return []; }
    }

    function trackLink(orderId) {
        const base = location.href.replace(/[^/]*([?#].*)?$/, "");
        return base + "track.html?order=" + orderId;
    }

    function pushSms(order, text) {
        const log = loadSms();
        log.unshift({ at: Date.now(), orderId: order.id, to: order.customer, phone: order.phone, text, link: trackLink(order.id) });
        try { localStorage.setItem(SMS_KEY, JSON.stringify(log.slice(0, 30))); } catch (e) { /* ignore */ }
    }

    // ---------- 8. RIDER LOGIC ----------
    function riderLoad(state, rider) {
        return state.orders.filter(o => o.riderId === rider.id &&
            (o.status === "Packed" || o.status === "Out for Delivery")).length;
    }

    function riderPosition(state, rider, now) {
        const home = offsetPoint(SECTORS[rider.sector], rider.off[0], rider.off[1]);
        const live = state.orders.find(o => o.riderId === rider.id && o.status === "Out for Delivery");
        if (live) {
            const total = (live.etaEndsAt - live.dispatchedAt) || 1;
            const f = Math.min(1, Math.max(0, (now - live.dispatchedAt) / total));
            return { lat: HUB.lat + (live.lat - HUB.lat) * f, lng: HUB.lng + (live.lng - HUB.lng) * f };
        }
        if (state.orders.some(o => o.riderId === rider.id && o.status === "Packed")) return { lat: HUB.lat, lng: HUB.lng };
        return home;
    }

    // Courier recommendation: rank by delivery-sector proximity and vehicle capacity.
    function recommendRiders(state, order, now) {
        return RIDERS.map(rider => {
            const load = riderLoad(state, rider);
            const free = rider.capacity - load;
            const km = kmBetween(riderPosition(state, rider, now), order);
            const sameSector = rider.sector === order.sector;
            return { rider, load, free, km, sameSector };
        }).sort((a, b) => {
            if ((b.free > 0) - (a.free > 0)) return (b.free > 0) - (a.free > 0);
            if (b.sameSector - a.sameSector) return b.sameSector - a.sameSector;
            return a.km - b.km;
        });
    }

    // ---------- 9. HYPERLOCAL BATCHER (radius clustering) ----------
    // Greedy: take the first unclustered order, pull in every order within
    // `radius` km of the growing centroid, repeat. Result: groups of orders
    // that one courier can serve on a single multi-drop trip.
    function clusterOrders(orders, radiusKm) {
        const left = orders.slice().sort((a, b) => a.id - b.id);
        const clusters = [];
        while (left.length) {
            const group = [left.shift()];
            let grew = true;
            while (grew) {
                grew = false;
                const c = centroid(group);
                for (let i = left.length - 1; i >= 0; i--) {
                    if (kmBetween(c, left[i]) <= radiusKm) { group.push(left.splice(i, 1)[0]); grew = true; }
                }
            }
            const c = centroid(group);
            const counts = {};
            group.forEach(o => { counts[o.sector] = (counts[o.sector] || 0) + 1; });
            const sector = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
            clusters.push({
                orders: group.sort((a, b) => a.id - b.id), center: c, sector,
                spreadKm: Math.max(...group.map(o => kmBetween(c, o)))
            });
        }
        return clusters;
    }

    function centroid(group) {
        return {
            lat: group.reduce((s, o) => s + o.lat, 0) / group.length,
            lng: group.reduce((s, o) => s + o.lng, 0) / group.length
        };
    }

    // ---------- 10. PAYOUT ----------
    function isPeakHour(date) {
        const h = date.getHours();
        return (h >= 12 && h < 15) || (h >= 19 && h < 23);
    }

    function surgeActive(state, mode, now) {
        if (mode === "on") return true;
        if (mode === "off") return false;
        const pending = state.orders.filter(o => o.status === "Packed").length;
        return isPeakHour(new Date(now)) || pending >= 4;
    }

    // ---------- 11. CUSTOMER STATUS TEXT ----------
    function statusHeadline(order) {
        const rider = riderOf(order.riderId);
        const brand = brandOf(order.brandId)?.name || "the kitchen";
        switch (order.status) {
            case "Received": return `${brand} has received your order.`;
            case "In Kitchen": return "Your food is being freshly prepared.";
            case "Packed": return rider
                ? `Courier Assigned - ${rider.name} is picking up your food!`
                : "Your order is packed and waiting for a courier.";
            case "Out for Delivery": return `${rider ? rider.name : "Your courier"} is on the way to you!`;
            case "Delivered": return "Delivered. Enjoy your meal!";
            default: return "";
        }
    }

    function fmtClock(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }

    // ---------- 12. SHARED TRACKER WIDGET (dashboard + customer page) ----------
    function buildTracker(root) {
        root.innerHTML = `
            <div class="tracking-header">
                <div>
                    <span class="tracking-label">TRACK YOUR ORDER</span>
                    <h2 data-t="id">#DD---</h2>
                </div>
                <span class="tracking-status" data-t="status">-</span>
            </div>
            <p class="tracking-headline" data-t="headline" aria-live="polite"></p>
            <div class="delivery-animation">
                <div class="track-line"><div class="track-progress" data-t="progress"></div></div>
                <div class="scooter" data-t="scooter" aria-hidden="true">🛵</div>
                <div class="home-pin" aria-hidden="true">🏠</div>
            </div>
            <div class="tracking-steps">
                ${["✓|Received", "♨|In Kitchen", "▣|Packed", "🛵|On the way", "★|Delivered"]
                    .map(s => `<div class="step"><div class="step-icon">${s.split("|")[0]}</div><span>${s.split("|")[1]}</span></div>`).join("")}
            </div>
            <div class="tracking-footer">
                <div><small>DELIVERY PARTNER</small><strong data-t="rider">Not assigned yet</strong></div>
                <div><small>ORDER</small><strong data-t="items">-</strong></div>
                <div><small data-t="etaLabel">ESTIMATED DELIVERY</small><strong class="eta" data-t="eta">-</strong></div>
            </div>`;
    }

    function updateTracker(root, order, now) {
        const q = k => root.querySelector(`[data-t="${k}"]`);
        if (!order) { q("headline").textContent = "Order not found."; return; }
        const rider = riderOf(order.riderId);
        const idx = STAGES.indexOf(order.status);
        let pct = idx * 25;
        let eta, etaLabel = "ESTIMATED DELIVERY";

        if (order.status === "Out for Delivery") {
            const total = (order.etaEndsAt - order.dispatchedAt) || 1;
            const f = Math.min(1, Math.max(0, (now - order.dispatchedAt) / total));
            pct = 75 + 25 * f * 0.96;                    // vehicle glides from "on the way" to the door
            const left = order.etaEndsAt - now;
            eta = left > 0 ? fmtClock(left) + " min remaining" : "Arriving now";
        } else if (order.status === "Delivered") {
            eta = "Delivered at " + new Date(order.deliveredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
            etaLabel = "DELIVERED";
        } else if (order.status === "In Kitchen") {
            const cooked = (now - (order.kitchenAt || now)) / MIN;
            eta = "About " + Math.round(Math.max(2, 18 - cooked) + order.transitMin) + " min";
        } else if (order.status === "Packed") {
            eta = "About " + (order.transitMin + (rider ? 2 : 5)) + " min";
        } else {
            eta = "About " + (18 + order.transitMin) + " min";
        }

        q("id").textContent = "#DD" + order.id;
        q("status").textContent = order.status === "Out for Delivery" ? "Out for Delivery" : order.status;
        q("headline").textContent = statusHeadline(order);
        q("progress").style.width = pct + "%";
        q("scooter").style.left = pct + "%";
        q("rider").textContent = rider ? `${rider.name} (${rider.vehicle}, ${rider.sector})` : "Not assigned yet";
        q("items").textContent = itemsText(order);
        q("eta").textContent = eta;
        q("etaLabel").textContent = etaLabel;

        root.querySelectorAll(".tracking-steps .step").forEach((step, i) => {
            step.classList.toggle("completed", i < idx || order.status === "Delivered");
            step.classList.toggle("current", i === idx && order.status !== "Delivered");
        });
    }

    return {
        STAGES, KITCHEN_ALERT_MIN, CLUSTER_RADIUS_KM, HUB, BRANDS, MENU, SECTORS, SECTOR_NAMES, RIDERS, MIN,
        brandOf, menuOf, riderOf, esc, kmBetween, offsetPoint, orderTotal, itemsText, transitMinutes,
        readRaw, loadState, saveState, resetState, parseState, loadSms, pushSms, trackLink,
        riderLoad, riderPosition, recommendRiders, clusterOrders, centroid,
        surgeActive, isPeakHour, statusHeadline, fmtClock, buildTracker, updateTracker
    };
})();
