// BGI QR site — screens, location, logging, stamps. Runs entirely on the phone.
(function () {
  'use strict';
  var C = window.BGI_CONFIG, M = window.BGIMap, ENT = C.entrance;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);

  // ---------- tiny storage helpers (storage can be blocked in private mode) ----------
  function get(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k) { try { sessionStorage.setItem(k, '1'); } catch (e) { /* ignore */ } }

  // ---------- where the card came from ----------
  var src = params.get('src');
  if (src) { src = src.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40); set('bgi_src_last', src); if (!get('bgi_src_first')) set('bgi_src_first', src); }
  var firstSrc = get('bgi_src_first', null), lastSrc = src || get('bgi_src_last', null);

  // ---------- anonymous logging (no coordinates, ever) ----------
  function log(e, extra, once) {
    if (once) { if (sget('bgi_logged_' + e)) return; sset('bgi_logged_' + e); }
    var payload = Object.assign({ e: e, src: lastSrc || 'direct', t: new Date().toISOString() }, extra || {});
    if (!C.logUrl) { console.log('[bgi log]', payload); return; }
    var body = JSON.stringify(payload);
    try {
      if (!(navigator.sendBeacon && navigator.sendBeacon(C.logUrl, body))) {
        fetch(C.logUrl, { method: 'POST', mode: 'no-cors', body: body, keepalive: true });
      }
    } catch (err) { /* logging must never break the page */ }
  }

  // ---------- screens ----------
  var current = null, previous = null;
  function show(name) {
    ['landing', 'seek', 'arrow', 'route', 'arrive', 'far', 'noloc', 'gate'].forEach(function (n) { $('s-' + n).hidden = n !== name; });
    if (current !== name) previous = current;
    current = name; window.scrollTo(0, 0);
  }
  function say(t) { $('live').textContent = t; }

  // ---------- hours ----------
  function md(d) { return (d.getMonth() + 1) * 100 + d.getDate(); }
  function parseMD(s) { var p = s.split('-'); return +p[0] * 100 + +p[1]; }
  function ruleFor(d) {
    var x = md(d);
    for (var i = 0; i < C.hours.length; i++) {
      var r = C.hours[i], a = parseMD(r.from), b = parseMD(r.to);
      if (a <= b ? (x >= a && x <= b) : (x >= a || x <= b)) return r;
    }
    return null;
  }
  function hoursStatus(now) {
    now = now || new Date();
    var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var r = ruleFor(now), h = now.getHours() + now.getMinutes() / 60;
    if (r && r.days.indexOf(now.getDay()) >= 0 && h >= r.open && h < r.close) {
      return { open: true, text: 'Open now · until ' + fmtHour(r.close) };
    }
    for (var i = 0; i < 21; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      var rr = ruleFor(d);
      if (!rr || rr.days.indexOf(d.getDay()) < 0) continue;
      if (i === 0 && h >= rr.open) continue;
      var when = i === 0 ? 'today' : i === 1 ? 'tomorrow' : i < 7 ? names[d.getDay()] : names[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
      return { open: false, text: 'Closed now · opens ' + when + ' ' + fmtHour(rr.open) };
    }
    return { open: false, text: 'Check hours before you go' };
  }
  function fmtHour(h) { return (h > 12 ? h - 12 : h) + (h >= 12 ? 'pm' : 'am'); }

  // ---------- street data ----------
  var streetsP = null, graph = null;
  function loadStreets() {
    if (streetsP) return streetsP;
    streetsP = fetch(C.streetsUrl, { cache: 'no-cache' }) // revalidates via ETag: cheap, never stale
      .then(function (r) { if (!r.ok) throw new Error('no baked file'); return r.json(); })
      .catch(function () {
        var cached = get('bgi_streets_v1', null);
        if (cached) return cached;
        return fetch(C.overpassUrl, { method: 'POST', body: 'data=' + encodeURIComponent(M.overpassQuery(ENT, C.mapRadiusM + 300)) })
          .then(function (r) { if (!r.ok) throw new Error('overpass ' + r.status); return r.json(); })
          .then(function (raw) { var d = M.compact(raw); set('bgi_streets_v1', d); return d; });
      })
      .catch(function (err) { console.warn('street data unavailable', err); return null; });
    return streetsP;
  }
  var EMPTY = { nodes: {}, ways: [], areas: [] };

  function draw(el, opts, data) {
    el.innerHTML = M.render(data || EMPTY, Object.assign({ entrance: ENT, w: el.clientWidth, h: el.clientHeight }, opts));
  }
  function drawLoading(el, opts) {
    draw(el, opts, null);
    var l = document.createElement('div'); l.className = 'loading'; l.innerHTML = '<span>drawing your map…</span>';
    el.appendChild(l);
  }

  // ---------- location ----------
  var you = null, plan = null, planAt = { t: 0, pos: null }, watchId = null, arrived = false;
  function toLL(pos) { return { lat: pos.coords.latitude, lon: pos.coords.longitude }; }

  // ---------- compass heading (which way the phone faces) ----------
  // iOS only lets a page read the compass after a tap, so this runs inside the button's click.
  var heading = null, headingListeners = [];
  function startHeading() {
    function onOrient(e) {
      var h = null;
      if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;          // iOS
      else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;        // Android
      if (h === null) return;
      heading = heading === null ? h : heading + (((h - heading + 540) % 360) - 180) * 0.25; // smooth, wrap-safe
      headingListeners.forEach(function (f) { f(); });
    }
    function listen() {
      window.addEventListener('deviceorientationabsolute', onOrient);
      window.addEventListener('deviceorientation', onOrient);
    }
    if (startHeading.on) return;
    startHeading.on = true;
    try {
      // Listen everywhere (Android sends events without asking); iOS also needs the permission prompt.
      if (window.DeviceOrientationEvent) listen();
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().catch(function () {});
      }
    } catch (e) { /* no compass: the arrow just shows north-up */ }
  }

  // ---------- A2 · the compass finding its way ----------
  var SEEK_LINES = ['Finding you…', 'Sniffing the air for moss…', 'Checking which way the trees lean…', 'Asking the pigeons…', 'Almost…'];
  var seekTimer = null;
  function startSeek() {
    show('seek');
    var needle = $('seek-needle'), i = 0;
    needle.classList.remove('locked'); needle.classList.add('searching'); needle.style.transform = '';
    $('seek-compass').classList.remove('found');
    $('seek-line').textContent = SEEK_LINES[0];
    clearInterval(seekTimer);
    seekTimer = setInterval(function () { i = Math.min(i + 1, SEEK_LINES.length - 1); $('seek-line').textContent = SEEK_LINES[i]; }, 1100);
  }
  function lockSeek(deg, trueBearing, then) {
    clearInterval(seekTimer);
    var needle = $('seek-needle');
    // freeze the spin where it is, then swing (with a little overshoot) to the garden
    var cur = getComputedStyle(needle).transform, start = 0;
    if (cur && cur !== 'none') { var m = cur.match(/matrix\(([^,]+),\s*([^,]+)/); if (m) start = Math.atan2(+m[2], +m[1]) * 180 / Math.PI; }
    needle.classList.remove('searching');
    needle.style.transform = 'rotate(' + start + 'deg)';
    var target = start + (((deg - start) % 360) + 360) % 360 + 360; // one more spin, then land
    void needle.getBoundingClientRect();
    needle.classList.add('locked');
    needle.style.transform = 'rotate(' + target + 'deg)';
    $('seek-line').textContent = 'Got it. The garden is ' + M.cardinal(trueBearing) + '.';
    $('seek-compass').classList.add('found');
    say($('seek-line').textContent);
    setTimeout(then, 1500);
  }

  function askLocation() {
    if (!navigator.geolocation) { log('location', { result: 'unsupported' }); return showNoloc('unsupported'); }
    startSeek();
    loadStreets(); // start drawing materials while we look
    var t0 = Date.now(), MIN_SEEK = 2600;
    navigator.geolocation.getCurrentPosition(function (pos) {
      you = toLL(pos);
      var d = M.haversine(you, ENT);
      var b = M.bearing(you, ENT);
      var faceDeg = heading === null ? b : b - heading;
      setTimeout(function () {
        lockSeek(faceDeg, b, function () {
          if (d > C.mapRadiusM) { log('location', { result: 'far', zone: zone() }); return showFar(); }
          log('location', { result: 'yes', zone: zone() });
          if (d <= C.arriveRadiusM) showArrive(); else showArrow();
          startWatch();
        });
      }, Math.max(0, MIN_SEEK - (Date.now() - t0)));
    }, function (err) {
      clearInterval(seekTimer);
      log('location', { result: err.code === 1 ? 'denied' : 'error' });
      showNoloc(err.code === 1 ? 'denied' : 'error');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  // ---------- rough area (never the exact spot) ----------
  // Direction from the garden + distance band, e.g. "NE · ½–1 mi". 8 × 5 = 40 possible zones.
  function zone() {
    if (!you) return 'unknown';
    var d = M.haversine(ENT, you) / 1609;
    var dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(M.bearing(ENT, you) / 45) % 8];
    var band = d < 0.25 ? '0–¼ mi' : d < 0.5 ? '¼–½ mi' : d < 1 ? '½–1 mi' : d < 1.5 ? '1–1½ mi' : '1½+ mi';
    return dir + ' · ' + band;
  }

  // ---------- A3 · the big arrow ----------
  function arrowDeg() {
    var b = M.bearing(you, ENT);
    return heading === null ? b : b - heading;
  }
  function paintArrow() {
    if (current !== 'arrow' || !you) return;
    var deg = arrowDeg();
    $('arrow-rot').style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
    $('arrow-mode').textContent = heading === null ? 'north is up' : 'live compass';
    $('bigarrow').setAttribute('aria-label', 'Arrow pointing ' + M.cardinal(M.bearing(you, ENT)) + ' toward the garden');
  }
  headingListeners.push(paintArrow);
  function showArrow() {
    log('arrow_shown', { zone: zone() }, true);
    show('arrow');
    var d = M.haversine(you, ENT), b = M.bearing(you, ENT);
    var mins = Math.max(1, Math.round(d * 1.3 / C.walkSpeedMps / 60));
    $('arrow-h').textContent = (d < 400 ? Math.round(d) + ' m ' : (d / 1609).toFixed(1) + ' mi ') + M.cardinal(b) + '.';
    $('arrow-sub').textContent = 'About ' + mins + ' min on foot. ' + (heading === null ? 'North is up on this arrow.' : 'Turn until the arrow points straight up, then walk.');
    var svg = $('bigarrow');
    svg.style.setProperty('--rot', arrowDeg().toFixed(0) + 'deg');
    svg.classList.remove('enter'); void svg.getBoundingClientRect(); svg.classList.add('enter');
    setTimeout(function () { svg.classList.remove('enter'); paintArrow(); }, 750);
    paintArrow();
    $('arrow-gmaps').href = gmaps('walking');
  }
  function gmaps(mode) { return 'https://www.google.com/maps/dir/?api=1&destination=' + ENT.lat + ',' + ENT.lon + '&travelmode=' + mode; }

  function startWatch() {
    if (watchId !== null || !navigator.geolocation) return;
    var lastDraw = 0;
    watchId = navigator.geolocation.watchPosition(function (pos) {
      you = toLL(pos);
      var d = M.haversine(you, ENT);
      if (d <= C.arriveRadiusM && current === 'route') return showArrive();
      if (current === 'arrive') { $('arrive-dist').textContent = '~' + Math.round(d) + ' m to the entrance'; }
      if (current === 'arrow') return paintArrow();
      if (current === 'far') return paintFar();
      if (current !== 'route') return;
      var now = Date.now();
      if (now - lastDraw < 2000 || now < drawingUntil) return; // let the pen finish
      lastDraw = now;
      var moved = planAt.pos ? M.haversine(planAt.pos, you) : Infinity;
      if (now - planAt.t > 15000 || moved > 30) computePlan();
      paintRoute();
    }, function () { $('gps-state').textContent = 'location paused'; }, { enableHighAccuracy: true, maximumAge: 5000 });
  }

  function computePlan() {
    if (!graph || !you) return;
    plan = M.routeTo(graph, you, ENT);
    planAt = { t: Date.now(), pos: you };
  }

  // ---------- B · route ----------
  var mapNo = null, drawingUntil = 0;
  function showRoute(animate) {
    show('route');
    var el = $('m-route');
    drawLoading(el, { mode: 'route', you: you });
    $('ext-walk').href = gmaps('walking');
    loadStreets().then(function (data) {
      if (data && !graph) graph = M.buildGraph(data, ENT);
      computePlan();
      paintRoute(animate);
      log('route_shown', { ok: !!plan }, true);
    });
  }

  function paintRoute(animate) {
    var el = $('m-route');
    loadStreets().then(function (data) {
      var drawS = +M.mergeStyle().route.drawSeconds || 2.4;
      if (animate) drawingUntil = Date.now() + (drawS + 1.8) * 1000;
      draw(el, { mode: 'route', you: you, plan: plan, topPx: 90, animate: !!animate, alt: 'Walking route from you to the garden entrance' }, data);
      var tk = $('ticket');
      if (animate || !tk.textContent) {
        var now = new Date();
        mapNo = mapNo || String(1000 + Math.floor(Math.random() * 9000));
        var hh = now.getHours() % 12 || 12, mm = String(now.getMinutes()).padStart(2, '0');
        tk.innerHTML = 'Map Nº ' + mapNo + '<br>drawn for you · ' + hh + ':' + mm + (now.getHours() < 12 ? 'am' : 'pm');
        tk.classList.remove('anim'); void tk.getBoundingClientRect();
        tk.style.setProperty('--ticket-delay', (drawS + 0.8) + 's');
        if (animate) tk.classList.add('anim');
      }
      var meters = plan ? plan.meters : M.haversine(you, ENT) * 1.3;
      var mins = Math.max(1, Math.round(meters / C.walkSpeedMps / 60));
      $('eta-min').textContent = mins + ' min';
      $('eta-dist').textContent = (meters / 1609).toFixed(1) + ' mi · on foot';
      var list = plan && plan.steps.length ? plan.steps : [
        { text: 'Head toward Kent Ave' }, { text: 'Turn onto Williamsburg St West' }
      ];
      var ol = $('steps'); ol.innerHTML = '';
      list.forEach(function (s, i) {
        var li = document.createElement('li');
        var t = document.createElement('span'); t.textContent = s.text;
        li.appendChild(t);
        if (s.meters) { var m = document.createElement('span'); m.className = 'm'; m.textContent = s.meters + ' m'; li.appendChild(m); }
        ol.appendChild(li);
      });
      var li = document.createElement('li'); li.textContent = 'Entrance is between Kent & Flushing. Look for the green code.';
      ol.appendChild(li);
    });
  }

  // ---------- C · arrive ----------
  function showArrive() {
    if (!arrived) { arrived = true; log('near_gate', {}, true); }
    show('arrive');
    var d = you ? Math.round(M.haversine(you, ENT)) : null;
    $('arrive-dist').textContent = d !== null ? '~' + d + ' m to the entrance' : 'nearly there';
    $('arrive-hours').textContent = hoursStatus().text;
    say('You are almost at the entrance.');
    loadStreets().then(function (data) { draw($('m-arrive'), { mode: 'close', you: you, alt: 'Close-up map of the garden entrance' }, data); });
  }

  // ---------- D · far ----------
  function paintFar() {
    if (current !== 'far' || !you) return;
    $('needle').setAttribute('transform', 'rotate(' + arrowDeg().toFixed(0) + ' 150 150)');
  }
  headingListeners.push(paintFar);
  function showFar() {
    show('far');
    var d = M.haversine(you, ENT), b = M.bearing(you, ENT);
    paintFar();
    $('compass').setAttribute('aria-label', 'Arrow pointing ' + M.cardinal(b) + ' toward the garden');
    $('far-h').textContent = (d / 1609).toFixed(1) + ' mi ' + M.cardinal(b) + '.';
    var ul = $('transit'); ul.innerHTML = '';
    C.transit.forEach(function (t) {
      var li = document.createElement('li');
      var a = document.createElement('span'); a.innerHTML = '<b></b> · '; a.firstChild.textContent = t.line; a.appendChild(document.createTextNode(t.stop));
      var w = document.createElement('span'); w.textContent = t.walk;
      li.appendChild(a); li.appendChild(w); ul.appendChild(li);
    });
    $('ext-transit').href = 'https://www.google.com/maps/dir/?api=1&destination=' + ENT.lat + ',' + ENT.lon + '&travelmode=transit';
  }

  function remindMe() {
    var now = new Date(), start = null;
    for (var i = 1; i < 21 && !start; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      var r = ruleFor(d);
      if (r && r.days.indexOf(d.getDay()) >= 0 && (d.getDay() === 0 || d.getDay() === 6)) start = d;
    }
    start = start || new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    var p = function (n) { return String(n).padStart(2, '0'); };
    var stamp = function (d, h) { return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + 'T' + p(h) + '0000'; };
    var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BGI//Garden//EN', 'BEGIN:VEVENT',
      'UID:' + Date.now() + '@bgi-garden', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
      'DTSTART:' + stamp(start, 11), 'DTEND:' + stamp(start, 13),
      'SUMMARY:Quiet time at Greenway Botanical Garden',
      'LOCATION:' + C.address + '\\, Brooklyn NY (' + C.addressNote + ')',
      'DESCRIPTION:Enter from Kent Ave onto Williamsburg St West. ' + location.origin + location.pathname,
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = 'bgi-garden.ics';
    document.body.appendChild(a); a.click(); a.remove();
    log('remind_me');
  }

  // ---------- E · no location ----------
  function showNoloc(reason) {
    show('noloc');
    $('retry').hidden = !!you; // already located: this is just the landmark view
    var why = $('noloc-why');
    why.hidden = !reason;
    why.textContent = reason === 'denied' ? 'Location is off for this page. No problem.' : reason ? 'Couldn’t find you just now.' : '';
    $('addr-text').innerHTML = '';
    $('addr-text').appendChild(document.createTextNode(C.address));
    $('addr-text').appendChild(document.createElement('br'));
    $('addr-text').appendChild(document.createTextNode(hoursStatus().text));
    var el = $('m-noloc');
    drawLoading(el, { mode: 'static' });
    loadStreets().then(function (data) { draw(el, { mode: 'static', alt: 'Map of the streets around the garden entrance' }, data); });
  }

  // ---------- F · gate: stamp + rating ----------
  function seasonNow(d) {
    var m = d.getMonth() + 1;
    var s = C.seasons.filter(function (x) { return x.months.indexOf(m) >= 0; })[0];
    var year = d.getFullYear() + (m === 12 ? 1 : 0);
    return { s: s, year: year, key: year + '-' + s.id };
  }
  function stampSVG(ink, locked, size) {
    if (locked) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 180 180" aria-hidden="true"><circle cx="90" cy="90" r="80" fill="none" stroke="#1F3D30" stroke-width="2.5" stroke-dasharray="6 8"/><path d="M70 72C70 50 112 50 110 74C108 92 90 90 90 110M90 128L90 132" fill="none" stroke="#1F3D30" stroke-width="7" stroke-linecap="round" opacity=".55"/></svg>';
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 180 180" aria-hidden="true">' +
      '<circle cx="90" cy="90" r="76" fill="' + ink + '" style="mix-blend-mode:multiply"/>' +
      '<circle cx="90" cy="90" r="85" fill="none" stroke="' + ink + '" stroke-width="5" stroke-dasharray="1 9" stroke-linecap="round"/>' +
      '<g transform="translate(4 -3)"><path d="M90 26C136 58 138 118 90 152C44 118 46 58 90 26Z" fill="#00A95C" style="mix-blend-mode:multiply"/>' +
      '<path d="M90 34L90 148M90 70L112 56M90 92L68 76M90 114L114 98" fill="none" stroke="#F4EFE4" stroke-width="4" stroke-linecap="round"/></g>' +
      '<circle cx="132" cy="44" r="16" fill="#FFE800" style="mix-blend-mode:multiply"/></svg>';
  }
  function showGate() {
    show('gate');
    var now = new Date(), cur = seasonNow(now);
    var stamps = get('bgi_stamps', {}), had = !!stamps[cur.key];
    var today = now.toISOString().slice(0, 10), last = get('bgi_last_visit', null);
    var visits = get('bgi_visits', 0);
    if (last !== today) { visits += 1; set('bgi_visits', visits); set('bgi_last_visit', today); log('visit', { first_src: firstSrc || 'none', season: cur.s.id, repeat: visits > 1 }); }
    if (!had) { stamps[cur.key] = { date: today }; set('bgi_stamps', stamps); }
    var yy = "’" + String(cur.year).slice(2);
    $('visit-n').textContent = 'visit ' + visits;
    $('gate-h').textContent = had ? 'Welcome back.' : 'You made it.';
    $('gate-sub').textContent = had ? 'You already have the ' + cur.s.label + ' ' + yy + ' stamp. Come back next season for the next one.' : cur.s.label + ' ' + yy + ' stamp is saved to this phone.';
    $('stamp-hero').innerHTML = '<div class="stamp" role="img" aria-label="' + cur.s.label + ' stamp, collected">' + stampSVG(cur.s.ink, false, 170) + '<span>' + cur.s.label + ' ' + yy + '</span></div>';
    // this season and the next three
    var book = $('book'); book.innerHTML = '';
    for (var k = 0; k < 4; k++) {
      var sn = seasonNow(new Date(now.getFullYear(), now.getMonth() + 3 * k, 1)), s = sn.s;
      var got = !!stamps[sn.key], lab = s.label + " ’" + String(sn.year).slice(2);
      var div = document.createElement('div'); div.className = 'stamp';
      div.setAttribute('role', 'img'); div.setAttribute('aria-label', lab + ' stamp, ' + (got ? 'collected' : 'not yet'));
      div.innerHTML = stampSVG(s.ink, !got, 112) + '<span>' + lab + '</span>';
      book.appendChild(div);
    }
    var picked = get('bgi_rated_' + today, null);
    Array.prototype.forEach.call(document.querySelectorAll('#rating .opt'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.r === picked));
      b.onclick = function () {
        if (get('bgi_rated_' + today, null) === b.dataset.r) return;
        set('bgi_rated_' + today, b.dataset.r);
        log('rating', { r: b.dataset.r });
        Array.prototype.forEach.call(document.querySelectorAll('#rating .opt'), function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        $('rating-state').textContent = 'logged · thanks';
        say('Thanks, logged.');
      };
    });
    if (picked) $('rating-state').textContent = 'logged · thanks';
  }

  // ---------- wiring ----------
  function landing() {
    show('landing');
    var st = hoursStatus();
    var chip = $('open-chip'); chip.classList.toggle('open', st.open); chip.lastElementChild.textContent = st.text;
    $('src-label').textContent = lastSrc ? 'via ' + lastSrc : '';
    var el = $('m-landing');
    drawLoading(el, { mode: 'static' });
    loadStreets().then(function (data) { draw(el, { mode: 'static', alt: 'Map of the streets around the garden entrance' }, data); });
  }

  function go() { log('seek_start'); startHeading(); askLocation(); }
  $('go').onclick = go;
  $('retry').onclick = go;
  $('landmarks').onclick = function () { log('location', { result: 'skipped' }); showNoloc(null); };
  $('draw-map').onclick = function () {
    var mins = Math.max(1, Math.round(M.haversine(you, ENT) * 1.3 / C.walkSpeedMps / 60));
    log('map_drawn', { zone: zone(), mins: mins }, true);
    showRoute(true);
  };
  $('arrow-landmarks').onclick = function () { log('landmarks_view'); showNoloc(null); };
  $('route-landmarks').onclick = function () { log('landmarks_view'); showNoloc(null); };
  $('arrow-gmaps').addEventListener('click', function () { log('opened_maps', { mode: 'walk', from: 'arrow' }); });
  $('recenter').onclick = function () { computePlan(); paintRoute(); };
  $('remind').onclick = remindMe;
  $('ext-walk').addEventListener('click', function () { log('opened_maps', { mode: 'walk' }); });
  $('ext-transit').addEventListener('click', function () { log('opened_maps', { mode: 'transit' }); });
  $('copy').onclick = function () {
    var b = this, txt = C.address + ', Brooklyn, NY (' + C.addressNote + ')';
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { b.textContent = 'Copied'; b.classList.add('done'); }, function () { b.textContent = 'Copy failed'; });
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) {
    b.onclick = function () {
      var g = b.dataset.go;
      if (g === 'prev') g = previous || 'landing';
      if (g === 'route' && you) return showRoute(false);
      if (g === 'arrow' && you) return showArrow();
      if (g === 'far' && you) return showFar();
      landing();
    };
  });
  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { if (current === 'route') paintRoute(); }, 250);
  });

  if (params.get('at') === 'gate') { log('gate_scan'); showGate(); }
  else { log('scan', {}, true); landing(); }

  // exposed for testing
  window.BGIApp = {
    hoursStatus: hoursStatus, seasonNow: seasonNow,
    // used by tune.js (?tune=1) to preview map styles on a laptop
    tune: {
      at: function (lat, lon) { you = { lat: lat, lon: lon }; },
      route: function (animate) { if (current === 'route') paintRoute(animate); else showRoute(animate); },
      current: function () { return current; }
    }
  };
  if (params.has('tune')) { // any ?tune link works, even with stray punctuation
    var tsc = document.createElement('script');
    tsc.src = 'tune.js?v=' + Date.now();
    document.body.appendChild(tsc);
  }
})();
