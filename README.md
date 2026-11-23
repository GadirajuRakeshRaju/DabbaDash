# DabbaDash v2 - LastMile Bite Battle

Hyperlocal delivery dashboard for a multi-brand cloud kitchen. Plain HTML/CSS/JS, no build step.

## Run
1. Open `login.html` (any valid email + 4+ character password), or run `python3 -m http.server` in this folder and open http://localhost:8000/login.html (recommended: two-tab live sync is most reliable over http).
2. Internet is only needed for the Leaflet map tiles and fonts. Without it the map section shows a simplified plot and everything else works.

## Files
| File | Purpose |
|---|---|
| `data.js` | Shared data: 3 brands, 20 menu items, 4 sectors, 6 riders, 15 orders, clustering, courier recommendation, tracker widget |
| `index.html`, `script.js` | Manager dashboard |
| `track.html`, `track.js` | Customer tracking page (opened from SMS link) |
| `style.css`, `login.*` | Styling and sign-in |

## Brief coverage
Core: multi-brand feed (brandId on every order/menu item) / 5-state lifecycle / courier assignment by sector proximity + vehicle capacity / radius batcher (2.5 km, adjustable) / customer tracker with moving scooter + ETA countdown / live KPIs (avg prep time is computed).
Stretch: Leaflet map with couriers, order pins, batch circles / kitchen bottleneck flashing red at >20 min / payout calculator with distance + surge / SMS tracking-link simulator.

## Data model (localStorage key `dabbaDashStateV2`)
Order: id, brandId, customer, items[{menuId, qty}], sector, lat, lng, distKm, status, riderId, createdAt, kitchenAt, packedAt, dispatchedAt, deliveredAt, transitMin, etaEndsAt.
Brands, MenuItems, Riders and Sectors are constants in `data.js`.

## Note on tech stack
The brief *suggests* React/TypeScript/Express. This project deliberately stays vanilla (file is an HTML project) and replaces the backend with localStorage + 3-second polling + `storage` events, which the brief lists as acceptable.
