// BGI map tuner. Open the site with ?tune=1 (best on a laptop).
// Drag sliders, pick colors, replay the drawing, then "Copy settings" and paste into config.js.
(function () {
  'use strict';
  var C = window.BGI_CONFIG, M = window.BGIMap, T = window.BGIApp && window.BGIApp.tune;
  if (!C || !M || !T) return;

  var START = {
    'Pratt (0.6 mi)': [40.6913, -73.9633],
    'Marcy Av J/M/Z': [40.7084, -73.9578],
    '1.3 mi east': [40.7000, -73.9380],
    'Flushing Av G': [40.7004, -73.9503]
  };
  var PRESETS = {
    'Quiet': {},
    'Loud riso': { dots: { opacity: 0.35 }, streets: { opacity: 1, width: 1 }, bigRoads: { opacity: 1 }, greenway: { opacity: 1 }, parks: { opacity: 0.75 }, water: { opacity: 0.55 }, outlines: 0.6 },
    'Ink only': { dots: { opacity: 0.1 }, streets: { color: '#1F3D30', opacity: 0.18, width: 0.5 }, bigRoads: { color: '#1F3D30', opacity: 0.12 }, greenway: { opacity: 0.35 }, parks: { opacity: 0.3 }, water: { opacity: 0.2 }, outlines: 0 }
  };

  // what the panel edits: [section, key, label, type, min, max, step]
  var FIELDS = [
    ['route', 'color', 'Route color', 'color'],
    ['route', 'opacity', 'Route opacity', 'range', 0, 1, 0.05],
    ['route', 'width', 'Route thickness', 'range', 3, 22, 1],
    ['route', 'drawSeconds', 'Drawing time (s)', 'range', 0.5, 8, 0.1],
    ['route', 'dashes', 'Dashed ink line', 'check'],
    ['pin', 'color', 'Pin color', 'color'],
    ['pin', 'size', 'Pin size', 'range', 0.8, 2.6, 0.1],
    ['pin', 'pulse', 'Pulse + bob', 'check'],
    ['pin', 'pulseColors.0', 'Pulse ring 1', 'color'],
    ['pin', 'pulseColors.1', 'Pulse ring 2', 'color'],
    ['streets', 'color', 'Streets', 'color'],
    ['streets', 'opacity', 'Streets opacity', 'range', 0, 1, 0.05],
    ['streets', 'width', 'Street thickness', 'range', 0.2, 2, 0.05],
    ['bigRoads', 'color', 'Highways (BQE)', 'color'],
    ['bigRoads', 'opacity', 'Highways opacity', 'range', 0, 1, 0.05],
    ['greenway', 'color', 'Greenway', 'color'],
    ['greenway', 'opacity', 'Greenway opacity', 'range', 0, 1, 0.05],
    ['parks', 'color', 'Parks', 'color'],
    ['parks', 'opacity', 'Parks opacity', 'range', 0, 1, 0.05],
    ['water', 'color', 'Water', 'color'],
    ['water', 'opacity', 'Water opacity', 'range', 0, 1, 0.05],
    ['dots', 'color', 'Halftone dots', 'color'],
    ['dots', 'opacity', 'Dots opacity', 'range', 0, 1, 0.05],
    ['', 'outlines', 'Street edges', 'range', 0, 1, 0.05],
    ['', 'paper', 'Paper', 'color']
  ];

  var style = M.mergeStyle(); // current config + defaults
  function getv(sec, key) {
    var o = sec ? style[sec] : style, ks = key.split('.');
    return ks.length > 1 ? o[ks[0]][+ks[1]] : o[key];
  }
  function setv(sec, key, v) {
    var o = sec ? style[sec] : style, ks = key.split('.');
    if (ks.length > 1) o[ks[0]][+ks[1]] = v; else o[key] = v;
  }
  function apply(animate) {
    C.mapStyle = JSON.parse(JSON.stringify(style));
    T.route(!!animate);
  }

  // ---------- panel ----------
  var css = document.createElement('style');
  css.textContent =
    '.tune{position:fixed;z-index:200;top:12px;right:12px;bottom:12px;width:300px;overflow:auto;background:#F4EFE4;border:2px solid #1F3D30;box-shadow:5px 5px 0 #FF48B0;font:12px/1.4 "DM Mono",ui-monospace,monospace;color:#1F3D30;padding:14px}' +
    '.tune h2{font:800 20px/1.1 "Bricolage Grotesque",system-ui,sans-serif;margin:0 0 4px}' +
    '.tune .sec{margin:12px 0 4px;text-transform:uppercase;letter-spacing:.08em;font-size:10px;opacity:.7}' +
    '.tune label{display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px 10px;margin:6px 0}' +
    '.tune input[type=range]{grid-column:1/-1;width:100%;accent-color:#FF48B0}' +
    '.tune input[type=color]{width:44px;height:28px;border:1.5px solid #1F3D30;padding:0;background:none}' +
    '.tune .row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}' +
    '.tune button,.tune select{font:inherit;border:1.5px solid #1F3D30;background:#F4EFE4;padding:7px 9px;min-height:36px;cursor:pointer;color:#1F3D30}' +
    '.tune button.primary{background:#FFE800;font-weight:500}' +
    '.tune textarea{width:100%;height:150px;font:11px/1.4 "DM Mono",monospace;border:1.5px solid #1F3D30;background:#fff}' +
    '.tune .x{position:absolute;top:8px;right:8px;min-height:30px}' +
    '@media (max-width:820px){.tune{top:auto;left:8px;right:8px;width:auto;height:46vh}}';
  document.head.appendChild(css);

  var p = document.createElement('div');
  p.className = 'tune';
  p.setAttribute('role', 'region');
  p.setAttribute('aria-label', 'Map style tuner');
  p.innerHTML = '<button class="x" aria-label="Hide tuner">×</button><h2>Map tuner</h2><div>Changes show instantly. Copy settings into config.js when you like it.</div>';
  document.body.appendChild(p);
  p.querySelector('.x').onclick = function () { p.remove(); };

  function el(tag, attrs, text) { var e = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (text) e.textContent = text; return e; }

  // start point + presets + replay
  var row = el('div', { class: 'row' });
  var sel = el('select', { 'aria-label': 'Start from' });
  Object.keys(START).forEach(function (k) { sel.appendChild(el('option', { value: k }, k)); });
  sel.onchange = function () { var s = START[sel.value]; T.at(s[0], s[1]); apply(true); };
  var replay = el('button', { class: 'primary' }, 'Replay drawing');
  replay.onclick = function () { apply(true); };
  row.appendChild(sel); row.appendChild(replay);
  p.appendChild(row);

  var pr = el('div', { class: 'row' });
  Object.keys(PRESETS).forEach(function (name) {
    var b = el('button', {}, name);
    b.onclick = function () {
      style = JSON.parse(JSON.stringify(M.DEFAULT_STYLE));
      var src = PRESETS[name];
      Object.keys(src).forEach(function (k) { if (typeof src[k] === 'object') Object.assign(style[k], src[k]); else style[k] = src[k]; });
      syncInputs(); apply(false);
    };
    pr.appendChild(b);
  });
  p.appendChild(el('div', { class: 'sec' }, 'Presets'));
  p.appendChild(pr);

  var inputs = [], lastSec = null, t;
  FIELDS.forEach(function (f) {
    var sec = f[0], key = f[1], label = f[2], type = f[3];
    var secName = { route: 'Route line', pin: 'BGI pin', streets: 'Streets', bigRoads: 'Streets', greenway: 'Streets', parks: 'Land + water', water: 'Land + water', dots: 'Paper', '': 'Paper' }[sec];
    if (secName !== lastSec) { p.appendChild(el('div', { class: 'sec' }, secName)); lastSec = secName; }
    var lab = el('label');
    var name = el('span', {}, label);
    var out = el('span');
    var inp;
    if (type === 'color') inp = el('input', { type: 'color' });
    else if (type === 'check') inp = el('input', { type: 'checkbox' });
    else inp = el('input', { type: 'range', min: f[4], max: f[5], step: f[6] });
    lab.appendChild(name);
    lab.appendChild(type === 'range' ? out : inp);
    if (type === 'range') lab.appendChild(inp);
    p.appendChild(lab);
    function read() { return type === 'check' ? inp.checked : type === 'range' ? +inp.value : inp.value; }
    inp.addEventListener('input', function () {
      setv(sec, key, read());
      if (type === 'range') out.textContent = inp.value;
      clearTimeout(t);
      var animate = key === 'drawSeconds';
      t = setTimeout(function () { apply(animate); }, animate ? 350 : 90);
    });
    inputs.push({ sec: sec, key: key, type: type, inp: inp, out: out });
  });
  function syncInputs() {
    inputs.forEach(function (x) {
      var v = getv(x.sec, x.key);
      if (x.type === 'check') x.inp.checked = !!v; else x.inp.value = v;
      if (x.type === 'range') x.out.textContent = v;
    });
  }
  syncInputs();

  // copy settings
  p.appendChild(el('div', { class: 'sec' }, 'Save'));
  var copy = el('button', { class: 'primary' }, 'Copy settings for config.js');
  var ta = el('textarea', { 'aria-label': 'Settings to paste into config.js', readonly: '' });
  copy.onclick = function () {
    var txt = '  mapStyle: ' + JSON.stringify(style, null, 2).replace(/\n/g, '\n  ') + ',';
    ta.value = txt;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { copy.textContent = 'Copied — paste over mapStyle in config.js'; }, function () { copy.textContent = 'Select the text below and copy it'; ta.select(); });
  };
  p.appendChild(copy);
  p.appendChild(ta);

  // jump straight to a drawn map from Pratt
  var s0 = START[sel.value];
  T.at(s0[0], s0[1]);
  apply(true);
})();
