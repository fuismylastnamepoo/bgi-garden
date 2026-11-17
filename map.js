// BGI map: OpenStreetMap streets → walking graph → route → riso SVG.
// Everything runs on the visitor's phone. No server of our own.
(function (root) {
  'use strict';

  var WALK = {
    residential: 1, primary: 1, primary_link: 1, secondary: 1, secondary_link: 1,
    tertiary: 1, tertiary_link: 1, unclassified: 1, living_street: 1, pedestrian: 1,
    footway: 1, path: 1, steps: 1, cycleway: 1, service: 1, track: 1
  };
  var WIDTH_PX = {
    motorway: 7, trunk: 7, primary: 7, secondary: 6, tertiary: 5, residential: 4,
    unclassified: 4, living_street: 4, service: 2.5, pedestrian: 3, footway: 1.6,
    path: 1.6, steps: 1.6, cycleway: 2.4, track: 1.6
  };

  // ---------- Overpass ----------
  function overpassQuery(center, radiusM) {
    var dLat = radiusM / 110574;
    var dLon = radiusM / (111320 * Math.cos(center.lat * Math.PI / 180));
    var bb = [center.lat - dLat, center.lon - dLon, center.lat + dLat, center.lon + dLon]
      .map(function (v) { return v.toFixed(5); }).join(',');
    return '[out:json][timeout:25];(' +
      'way["highway"](' + bb + ');' +
      'way["leisure"~"park|garden|nature_reserve|playground"](' + bb + ');' +
      'way["landuse"~"grass|cemetery|meadow"](' + bb + ');' +
      'way["natural"~"water|wood|scrub"](' + bb + ');' +
      ');out body;>;out skel qt;';
  }

  function walkable(tags) {
    var hw = tags.highway;
    if (!hw || !WALK[hw]) return false;
    if (tags.foot === 'no') return false;
    if ((tags.access === 'private' || tags.access === 'no') && tags.foot !== 'yes' && tags.foot !== 'designated') return false;
    if (hw === 'cycleway' && !(tags.foot === 'yes' || tags.foot === 'designated' || tags.segregated)) return false;
    return true;
  }

  // Turn raw Overpass JSON into a small file we can ship (data/streets.json).
  function compact(raw) {
    var coords = {};
    raw.elements.forEach(function (el) {
      if (el.type === 'node') coords[el.id] = [+el.lat.toFixed(5), +el.lon.toFixed(5)];
    });
    var used = {}, ways = [], areas = [];
    raw.elements.forEach(function (el) {
      if (el.type !== 'way' || !el.nodes) return;
      var t = el.tags || {};
      var ids = el.nodes.filter(function (id) { return coords[id]; });
      if (ids.length < 2) return;
      // NYC maps every sidewalk and crosswalk as its own path; the street itself is enough
      if (t.footway === 'sidewalk' || t.footway === 'crossing' || t.footway === 'traffic_island' ||
          t.highway === 'corridor' || t.highway === 'elevator' || t.highway === 'platform') return;
      if (t.highway) {
        ways.push({ n: ids, name: t.name || '', hw: t.highway, w: walkable(t) ? 1 : 0 });
        ids.forEach(function (id) { used[id] = 1; });
      } else {
        var kind = (t.natural === 'water') ? 'water' : 'green';
        areas.push({ k: kind, c: ids.map(function (id) { return coords[id]; }) });
      }
    });
    var nodes = {};
    Object.keys(used).forEach(function (id) { nodes[id] = coords[id]; });
    return { v: 1, made: new Date().toISOString(), nodes: nodes, ways: ways, areas: areas };
  }

  // ---------- geometry ----------
  function makeProj(origin) {
    var kx = 111320 * Math.cos(origin.lat * Math.PI / 180), ky = 110574;
    return function (lat, lon) { return [(lon - origin.lon) * kx, -(lat - origin.lat) * ky]; };
  }
  function haversine(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function bearing(a, b) { // degrees from north, clockwise
    var r = Math.PI / 180;
    var y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
    var x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  function cardinal(deg) {
    return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(deg / 45) % 8];
  }

  // ---------- graph + route ----------
  function buildGraph(data, origin) {
    var proj = makeProj(origin), xy = {}, adj = {};
    function p(id) { if (!xy[id]) { var c = data.nodes[id]; xy[id] = proj(c[0], c[1]); } return xy[id]; }
    data.ways.forEach(function (w) {
      if (!w.w) return;
      for (var i = 0; i < w.n.length - 1; i++) {
        var a = w.n[i], b = w.n[i + 1];
        if (!data.nodes[a] || !data.nodes[b]) continue;
        var pa = p(a), pb = p(b);
        var d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
        (adj[a] = adj[a] || []).push({ to: b, d: d, name: w.name, hw: w.hw });
        (adj[b] = adj[b] || []).push({ to: a, d: d, name: w.name, hw: w.hw });
      }
    });
    return { adj: adj, xy: xy, proj: proj, data: data };
  }

  function nearestNode(g, lat, lon, filter) {
    var q = g.proj(lat, lon), best = null, bd = Infinity;
    Object.keys(g.adj).forEach(function (id) {
      if (filter && !filter(id)) return;
      var p = g.xy[id], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < bd) { bd = d; best = id; }
    });
    return best ? { id: best, d: bd } : null;
  }

  function dijkstra(g, from, to) {
    var dist = {}, prev = {}, heap = [[0, from]];
    dist[from] = 0;
    function push(item) {
      heap.push(item); var i = heap.length - 1;
      while (i > 0) { var j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; var t = heap[i]; heap[i] = heap[j]; heap[j] = t; i = j; }
    }
    function pop() {
      var top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; var i = 0;
        for (;;) {
          var l = 2 * i + 1, r = l + 1, m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break; var t = heap[i]; heap[i] = heap[m]; heap[m] = t; i = m;
        }
      }
      return top;
    }
    while (heap.length) {
      var cur = pop(), d = cur[0], u = cur[1];
      if (d > dist[u]) continue;
      if (u === to) break;
      (g.adj[u] || []).forEach(function (e) {
        // small penalty on steps and service roads, so we prefer calm streets
        var cost = e.d * (e.hw === 'steps' ? 1.5 : e.hw === 'service' ? 1.3 : 1);
        var nd = d + cost;
        if (dist[e.to] === undefined || nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = { from: u, edge: e }; push([nd, e.to]); }
      });
    }
    if (dist[to] === undefined) return null;
    var nodes = [to], edges = [];
    for (var v = to; v !== from; v = prev[v].from) { edges.unshift(prev[v].edge); nodes.unshift(prev[v].from); }
    return { nodes: nodes, edges: edges };
  }

  function label(e) {
    if (e.name) return e.name;
    return { footway: 'the footpath', path: 'the path', steps: 'the steps', cycleway: 'the greenway', pedestrian: 'the plaza', service: 'the lane' }[e.hw] || 'the street';
  }

  // Group the route into named legs and describe each turn.
  function steps(g, route) {
    if (!route || !route.edges.length) return [];
    var legs = [], cur = null;
    route.edges.forEach(function (e, i) {
      var name = label(e);
      if (!cur || cur.name !== name) { cur = { name: name, d: 0, i0: i, i1: i }; legs.push(cur); }
      cur.d += e.d; cur.i1 = i;
    });
    // fold tiny legs (< 15 m, e.g. a crossing) into the next one
    legs = legs.filter(function (l, k) { return l.d >= 15 || k === legs.length - 1; });
    function ll(id) { var c = g.data.nodes[id]; return { lat: c[0], lon: c[1] }; }
    function legBearing(l, atStart) {
      var a = atStart ? route.nodes[l.i0] : route.nodes[Math.max(l.i0, l.i1)];
      var b = atStart ? route.nodes[Math.min(l.i0 + 1, l.i1 + 1)] : route.nodes[l.i1 + 1];
      return bearing(ll(a), ll(b));
    }
    return legs.map(function (l, k) {
      var text;
      if (k === 0) text = 'Head ' + cardinal(legBearing(l, true)) + ' on ' + l.name;
      else {
        var delta = ((legBearing(l, true) - legBearing(legs[k - 1], false) + 540) % 360) - 180;
        var turn = Math.abs(delta) < 30 ? 'Continue onto ' : (delta > 0 ? 'Turn right onto ' : 'Turn left onto ');
        if (Math.abs(delta) >= 30 && Math.abs(delta) < 60) turn = (delta > 0 ? 'Bear right onto ' : 'Bear left onto ');
        text = turn + l.name;
      }
      return { text: text, name: l.name, meters: Math.round(l.d), at: route.nodes[l.i0] };
    });
  }

  // Full pipeline: from where you are to the entrance.
  function routeTo(g, you, entrance) {
    var target = nearestNode(g, entrance.lat, entrance.lon, function (id) {
      return (g.adj[id] || []).some(function (e) { return /williamsburg st(reet)? w/i.test(e.name); });
    }) || nearestNode(g, entrance.lat, entrance.lon);
    if (!target) return null;
    // only start from streets that connect to the entrance (skips cut-off campus paths)
    if (!g.reach || g.reachFrom !== target.id) {
      g.reach = {}; g.reachFrom = target.id;
      var stack = [target.id]; g.reach[target.id] = 1;
      while (stack.length) {
        (g.adj[stack.pop()] || []).forEach(function (e) { if (!g.reach[e.to]) { g.reach[e.to] = 1; stack.push(e.to); } });
      }
    }
    var start = nearestNode(g, you.lat, you.lon, function (id) { return g.reach[id]; });
    if (!start) return null;
    var r = dijkstra(g, start.id, target.id);
    if (!r) return null;
    var meters = r.edges.reduce(function (s, e) { return s + e.d; }, 0) + start.d;
    return { route: r, meters: meters, steps: steps(g, r), startGap: start.d };
  }

  // ---------- riso SVG ----------
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // opts: { mode: 'route'|'close'|'static', you, plan, entrance, w, h }
  function render(data, opts) {
    var ent = opts.entrance, proj = makeProj(ent), W = opts.w, H = opts.h;
    var pts = [[0, 0]];
    if (opts.you) pts.push(proj(opts.you.lat, opts.you.lon));
    if (opts.plan && opts.mode === 'route') opts.plan.route.nodes.forEach(function (id) { var c = data.nodes[id]; pts.push(proj(c[0], c[1])); });
    var minSpan = opts.mode === 'close' ? 260 : opts.mode === 'static' ? 900 : 420;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    if (opts.mode === 'close') { x0 = y0 = x1 = y1 = 0; }
    var pad = 0.18, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var spanW = Math.max((x1 - x0) * (1 + pad * 2), minSpan), spanH = Math.max((y1 - y0) * (1 + pad * 2), minSpan * H / W);
    if (spanW / spanH < W / H) spanW = spanH * W / H; else spanH = spanW * H / W;
    var u = spanW / W; // meters per CSS px
    // leave room at the top for the pin and the buttons that float over the map
    var topRoom = (opts.topPx || 0) * u;
    if (topRoom) { spanH += topRoom; spanW = spanH * W / H; u = spanW / W; cy -= topRoom / 2; }
    var vx = cx - spanW / 2, vy = cy - spanH / 2;

    function inView(c) { var p = proj(c[0], c[1]); return p[0] > vx - 200 && p[0] < vx + spanW + 200 && p[1] > vy - 200 && p[1] < vy + spanH + 200; }
    function line(cs) { return cs.map(function (c, i) { var p = proj(c[0], c[1]); return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' '); }

    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg"' + (opts.animate ? ' class="anim"' : '') + ' viewBox="' + [vx, vy, spanW, spanH].map(function (n) { return n.toFixed(1); }).join(' ') + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(opts.alt || 'Map to the garden') + '">');
    out.push('<defs><pattern id="mDots" width="' + (8 * u) + '" height="' + (8 * u) + '" patternUnits="userSpaceOnUse"><circle cx="' + (4 * u) + '" cy="' + (4 * u) + '" r="' + (1.3 * u) + '" fill="#00A95C"/></pattern>' +
      '<pattern id="mShade" width="' + (5 * u) + '" height="' + (5 * u) + '" patternUnits="userSpaceOnUse"><circle cx="' + (2.5 * u) + '" cy="' + (2.5 * u) + '" r="' + (1.1 * u) + '" fill="#1F3D30"/></pattern></defs>');
    out.push('<rect x="' + vx + '" y="' + vy + '" width="' + spanW + '" height="' + spanH + '" fill="#F4EFE4"/>');
    out.push('<rect x="' + vx + '" y="' + vy + '" width="' + spanW + '" height="' + spanH + '" fill="url(#mDots)" opacity="0.35"/>');

    (data.areas || []).forEach(function (a) {
      if (!a.c.some(inView)) return;
      var fill = a.k === 'water' ? '#0078BF' : '#00A95C';
      out.push('<path d="' + line(a.c) + ' Z" fill="' + fill + '" opacity="' + (a.k === 'water' ? 0.55 : 0.75) + '" style="mix-blend-mode:multiply"/>');
    });

    var streets = [], casing = [];
    (data.ways || []).forEach(function (w) {
      var cs = w.n.map(function (id) { return data.nodes[id]; }).filter(Boolean);
      if (cs.length < 2 || !cs.some(inView)) return;
      var wpx = WIDTH_PX[w.hw] || 2, d = line(cs);
      var col = (w.hw === 'motorway' || w.hw === 'trunk') ? '#FF6C2F' : (w.hw === 'cycleway' ? '#00A95C' : '#FFE800');
      streets.push('<path d="' + d + '" stroke="' + col + '" stroke-width="' + (wpx * u * 2.2) + '" style="mix-blend-mode:multiply"/>');
      if (wpx >= 5) casing.push('<path d="' + d + '" stroke="#1F3D30" stroke-width="' + (0.8 * u) + '" opacity="0.6"/>');
    });
    out.push('<g class="m-streets" fill="none" stroke-linecap="round" stroke-linejoin="round">' + streets.join('') + casing.join('') + '</g>');

    if (opts.plan) {
      var rc = opts.plan.route.nodes.map(function (id) { return data.nodes[id]; });
      if (opts.you) rc.unshift([opts.you.lat, opts.you.lon]);
      var rd = line(rc);
      // pathLength=1 lets CSS draw the route like a pen stroke (see .anim .m-route)
      out.push('<path class="m-route" pathLength="1" d="' + rd + '" fill="none" stroke="#FF48B0" stroke-width="' + (9 * u) + '" stroke-linecap="round" stroke-linejoin="round" style="mix-blend-mode:multiply"/>');
      out.push('<path class="m-route2" d="' + rd + '" fill="none" stroke="#1F3D30" stroke-width="' + (1.6 * u) + '" stroke-dasharray="' + (3 * u) + ' ' + (5 * u) + '" stroke-linecap="round" transform="translate(' + (3 * u) + ' ' + (-2 * u) + ')"/>');
      // numbered turns pop in as the pen passes them
      var nAll = opts.plan.route.nodes.length;
      opts.plan.steps.forEach(function (s, i) {
        var c = data.nodes[s.at]; if (!c) return;
        var p = proj(c[0], c[1]);
        var at = Math.max(0, opts.plan.route.nodes.indexOf(s.at)) / Math.max(1, nAll - 1);
        out.push('<g class="m-pop" style="animation-delay:' + (0.7 + 2.4 * at).toFixed(2) + 's">' +
          '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (11 * u) + '" fill="#F4EFE4" stroke="#1F3D30" stroke-width="' + (2 * u) + '"/>' +
          '<text x="' + p[0] + '" y="' + (p[1] + 4 * u) + '" text-anchor="middle" font-family="DM Mono, monospace" font-size="' + (11 * u) + '" fill="#1F3D30">' + (i + 1) + '</text></g>');
      });
    }

    // entrance pin
    var s = u * 1.1;
    out.push('<g class="m-pin"><g transform="translate(0 0) scale(' + s + ')">' +
      (opts.mode === 'close' ? '<circle cx="0" cy="0" r="12" fill="none" stroke="#FF48B0" stroke-width="3"><animate attributeName="r" values="10;38" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="1.8s" repeatCount="indefinite"/></circle>' : '') +
      '<path d="M0 -42 C 14 -42, 22 -30, 14 -18 L 0 0 L -14 -18 C -22 -30, -14 -42, 0 -42 Z" fill="#00A95C" style="mix-blend-mode:multiply"/>' +
      '<path d="M3 -39 C 17 -39, 25 -27, 17 -15 L 3 3 L -11 -15 C -19 -27, -11 -39, 3 -39 Z" fill="none" stroke="#1F3D30" stroke-width="2"/>' +
      '<path d="M0 -36 C 7 -32, 7 -24, 0 -20 C -7 -24, -7 -32, 0 -36 Z" fill="#F4EFE4"/>' +
      '<rect x="20" y="-40" width="40" height="18" fill="#F4EFE4"/><text x="24" y="-26" font-family="Bricolage Grotesque, sans-serif" font-weight="800" font-size="14" fill="#1F3D30">BGI</text></g></g>');

    if (opts.you) {
      var y = proj(opts.you.lat, opts.you.lon);
      out.push('<g class="m-you"><circle cx="' + y[0] + '" cy="' + y[1] + '" r="' + (18 * u) + '" fill="#FF48B0" opacity="0.35" style="mix-blend-mode:multiply"/>' +
        '<circle cx="' + y[0] + '" cy="' + y[1] + '" r="' + (9 * u) + '" fill="#1F3D30"/>' +
        '<circle cx="' + y[0] + '" cy="' + y[1] + '" r="' + (3.5 * u) + '" fill="#F4EFE4"/></g>');
    }
    out.push('</svg>');
    return out.join('');
  }

  root.BGIMap = {
    overpassQuery: overpassQuery, compact: compact, buildGraph: buildGraph, routeTo: routeTo,
    render: render, haversine: haversine, bearing: bearing, cardinal: cardinal, nearestNode: nearestNode
  };
})(typeof window !== 'undefined' ? window : globalThis);
