// BGI QR site — everything you might need to change lives here.
window.BGI_CONFIG = {
  // Garden entrance (Williamsburg St West, between Kent & Flushing Aves)
  entrance: { lat: 40.699332, lon: -73.962632 },
  address: '63 Williamsburg St West',
  addressNote: 'between Kent & Flushing Aves',

  // Our hand-drawn map covers roughly a 20-minute walk around the entrance.
  // Beyond this distance (meters) the page shows the "too far" view instead.
  mapRadiusM: 2400, // ≈ 1.5 mi in a straight line
  // Within this distance (meters) of the entrance → "You're basically here".
  arriveRadiusM: 120,
  walkSpeedMps: 1.3, // ~3 mph

  // Street data: the page tries data/streets.json first (made with bake.html),
  // then falls back to fetching OpenStreetMap live from the visitor's phone.
  streetsUrl: 'data/streets.json',
  overpassUrl: 'https://overpass-api.de/api/interpreter',

  // Anonymous event log. Paste your Google Apps Script web-app URL here.
  // Leave empty to log to the browser console only.
  logUrl: '',

  // Opening hours. CONFIRM WITH BGI — these follow the published schedule.
  // Each rule: from/to as 'MM-DD' (inclusive), days 0=Sun … 6=Sat, hours 24h.
  hours: [
    { from: '11-23', to: '11-29', days: [], open: 10, close: 17, note: 'Closed Thanksgiving week' },
    { from: '11-30', to: '04-14', days: [0, 6], open: 10, close: 17, note: 'Weekends in winter' },
    { from: '04-15', to: '11-22', days: [0, 3, 4, 5, 6], open: 10, close: 17, note: 'Wed–Sun' }
  ],

  // Seasonal stamps: one per season.
  seasons: [
    { id: 'winter', label: 'Winter', months: [12, 1, 2], ink: '#0078BF' },
    { id: 'spring', label: 'Spring', months: [3, 4, 5], ink: '#FF48B0' },
    { id: 'summer', label: 'Summer', months: [6, 7, 8], ink: '#765BA7' },
    { id: 'fall', label: 'Fall', months: [9, 10, 11], ink: '#FF6C2F' }
  ],

  transit: [
    { line: 'G', stop: 'Classon Av', walk: '10 min walk' },
    { line: 'J M Z', stop: 'Marcy Av', walk: '11 min walk' },
    { line: 'G', stop: 'Flushing Av', walk: '13 min walk' },
    { line: 'B57 B62', stop: 'Flushing Av / Classon Av', walk: '2 min walk' },
    { line: 'B48', stop: 'Wallabout St / Wythe Av', walk: '5 min walk' }
  ]
};
