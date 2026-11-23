// DABBADASH - CUSTOMER TRACKING PAGE
// Reads the same localStorage state as the manager dashboard.
"use strict";

const root = document.getElementById("trackerRoot");
const params = new URLSearchParams(location.search);
const orderId = Number(params.get("order")) || 104;

let state = DD.loadState();
let lastRaw = DD.readRaw();

DD.buildTracker(root);

function render() {
    const order = state.orders.find(o => o.id === orderId);
    DD.updateTracker(root, order, Date.now());
    if (order) document.title = `#DD${order.id} - ${order.status} | DabbaDash`;
}

function poll() {
    const raw = DD.readRaw();
    if (raw && raw !== lastRaw) {
        const parsed = DD.parseState(raw);
        if (parsed) { state = parsed; lastRaw = raw; render(); }
    }
}

setInterval(poll, 3000);                 // lightweight polling (every 3 s)
window.addEventListener("storage", poll); // instant when another tab saves
setInterval(render, 1000);                // smooth countdown + moving scooter
render();
