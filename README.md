# BGI — QR site

A static web page for Greenway Botanical Garden. Scan a card → the phone's browser opens → our own riso map walks you to the Williamsburg St West entrance → scan the green code there → seasonal stamp + one-tap "how quiet was it?".

No app, no accounts, no server of our own. Routing runs on the visitor's phone over OpenStreetMap streets.

## Files

| file | what it is |
|---|---|
| `index.html`, `style.css` | the screens |
| `app.js` | screens, location, near-the-entrance check, stamps, logging |
| `map.js` | streets → walking graph → shortest route → riso SVG |
| `config.js` | **everything you'd change**: entrance pin, hours, log URL, seasons, transit |
| `bake.html` | one-time tool that saves the streets as `data/streets.json` |
| `apps-script.gs` | Google Sheet logger (paste into Apps Script) |
| `make_qr.py`, `qr/` | QR codes for cards (`?src=…`) and the entrance (`?at=gate`) |

## Go live (about 20 minutes)

1. **GitHub Pages.** Make a repo called `bgi-garden`, upload these files, then Settings → Pages → Deploy from branch → `main` / root. Your URL will be `https://<your-username>.github.io/bgi-garden/`.
2. **Bake the map.** Open `https://<…>/bgi-garden/bake.html`, press *Fetch streets*, check the preview, download `streets.json`, and upload it into the repo's `data/` folder. (Without it the page still works: each phone fetches the streets from OpenStreetMap on first load.)
3. **Logging.** New Google Sheet → Extensions → Apps Script → paste `apps-script.gs` → Deploy → Web app (Execute as *Me*, access *Anyone*). Paste the URL into `config.js` → `logUrl`. Run `makeFunnel` once for a per-card summary tab.
4. **QR codes.** `python make_qr.py https://<…>/bgi-garden/ pratt-library cafe-kent …` — one code per handout spot, plus `qr/gate.svg` for the entrance sign. The included `qr/` files assume `fuismylastnamepoo.github.io/bgi-garden`; regenerate if your URL differs.
5. **Check before printing.** Confirm hours with BGI (`config.js` → `hours`). Walk one route with your phone and see that the steps match the street.

## Try it

- `…/bgi-garden/?src=test` — card flow
- `…/bgi-garden/?at=gate` — what the entrance code shows

Location needs HTTPS, which GitHub Pages gives you. On a laptop, Chrome DevTools → Sensors lets you fake a location.

## What gets logged

`scan`, `location` (yes / no / far / skipped), `route_shown`, `opened_maps`, `near_gate`, `gate_scan`, `visit` (with the card it came from), `rating`, `remind_me`. Each one has the card tag (`src`) and a time stamp. Coordinates, names and device IDs are never sent. Stamps live only in the phone's own storage.

## Known limits

- If someone scans the card in one browser and the gate in another (e.g. an in-app scanner), the visit shows as `first_src: none`.
- Routes follow OpenStreetMap. Paths inside the Navy Yard tagged private are skipped, but check the first few routes in person.
- Ad blockers may block the log call. Counts are approximate, not exact.
