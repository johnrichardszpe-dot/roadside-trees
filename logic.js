/* Roadside Trees - pure helpers shared by the app and the node tests (no DOM).
   Sources are listed in README.md and the About screen. NOT a certified tree risk assessment. */
(function (root) {
  'use strict';
  var VERSION = '0.1.0';
  function num(x) { if (x == null || x === '') return null; x = +String(x).trim().replace(',', '.'); return isFinite(x) ? x : null; }
  function r1(x) { return x == null ? null : Math.round(x * 10) / 10; }

  var TYPES = ['hazard', 'trim', 'fallen', 'weeds', 'protect'];
  // Work priorities, most urgent first. "protect" is not work: a tree to keep and flag before any works.
  var PRIORITIES = ['urgent', 'high', 'moderate', 'low', 'protect'];
  function prioRank(p) { var i = PRIORITIES.indexOf(p); return i < 0 ? 9 : i; }

  // ---- simplified hazard-tree rating (ISA TRAQ-style concepts, simplified) ----
  // Matrix 1: likelihood of failure x likelihood of impact (ISA Tree Risk Assessment BMP, Smiley/Matheny/Lilly).
  var LOF = ['improbable', 'possible', 'probable', 'imminent'];
  var IMPACT = ['verylow', 'low', 'medium', 'high'];            // from how often the target is there: rare / occasional / frequent / constant
  var M1 = {
    imminent: ['unlikely', 'somewhat', 'likely', 'verylikely'],
    probable: ['unlikely', 'unlikely', 'somewhat', 'likely'],
    possible: ['unlikely', 'unlikely', 'unlikely', 'somewhat'],
    improbable: ['unlikely', 'unlikely', 'unlikely', 'unlikely']
  };
  // Matrix 2: (failure & impact) x consequences -> low / moderate / high / extreme.
  var CONS = ['negligible', 'minor', 'significant', 'severe'];
  var M2 = {
    verylikely: ['low', 'moderate', 'high', 'extreme'],
    likely: ['low', 'moderate', 'high', 'high'],
    somewhat: ['low', 'low', 'moderate', 'moderate'],
    unlikely: ['low', 'low', 'low', 'low']
  };
  // Simplification: consequences from the size of the part that could fail.
  var SIZE_CONS = { small: 'minor', medium: 'significant', large: 'severe' };
  function hazardRating(lof, impact, size) {
    var i = IMPACT.indexOf(impact), c = CONS.indexOf(SIZE_CONS[size] || size);
    if (!M1[lof] || i < 0 || c < 0) return null;
    var fi = M1[lof][i], risk = M2[fi][c];
    return { failImpact: fi, consequence: CONS[c], risk: risk, priority: risk === 'extreme' ? 'urgent' : risk };
  }
  // Visual defect indicators (cf. Mattheck VTA; ISA BMP defect list). Suggest a likelihood of failure - the user decides.
  var INDICATORS = ['dead', 'hanging', 'deadbranch', 'lean', 'rootlift', 'crack', 'decay', 'weakfork', 'fire'];
  var STRONG = { hanging: 1, rootlift: 1, crack: 1 };
  function suggestLof(ind) {
    ind = ind || {}; var on = INDICATORS.filter(function (k) { return ind[k]; }), strong = on.filter(function (k) { return STRONG[k]; }).length;
    if (!on.length) return 'improbable';
    if ((ind.hanging && ind.crack) || (ind.rootlift && ind.lean) || strong >= 2) return 'imminent';
    if (strong || on.length >= 2) return 'probable';
    return 'possible';
  }

  // ---- other record types: simple, labelled rules ----
  // Trim: what it is near x how close.
  var TRIM_ISSUE = ['powerline', 'road', 'sightline', 'sign', 'path'];
  var TRIM_CLOSE = ['touching', 'encroaching', 'growing'];
  function trimPriority(issue, close) {
    var c = TRIM_CLOSE.indexOf(close); if (c < 0) c = 1;
    if (issue === 'powerline') return ['urgent', 'high', 'moderate'][c];
    if (issue === 'sightline' || issue === 'sign') return ['high', 'moderate', 'low'][c];
    return ['high', 'moderate', 'low'][c];
  }
  function fallenPriority(block, lines) { if (lines) return 'urgent'; return { full: 'urgent', partial: 'high', verge: 'moderate' }[block] || 'high'; }
  function autoPriority(r) {
    var f = r.f || {};
    if (r.type === 'hazard') { var h = hazardRating(f.lof || suggestLof(f.ind), f.impact || 'medium', f.size || 'medium'); return h ? h.priority : 'moderate'; }
    if (r.type === 'trim') return trimPriority(f.issue, f.close);
    if (r.type === 'fallen') return fallenPriority(f.block, f.lines);
    if (r.type === 'weeds') return f.extent === 'continuous' ? 'moderate' : 'low';
    if (r.type === 'protect') return 'protect';
    return 'low';
  }
  function priority(r) { return r.prio && r.prio !== 'auto' ? r.prio : autoPriority(r); }

  // ---- trees ----
  function dbhFromCirc(c) { c = num(c); return c > 0 ? r1(c / Math.PI) : null; }

  // ---- geo ----
  var D2R = Math.PI / 180, R2D = 180 / Math.PI, EARTH = 6371008.8;
  function haversine(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dp = (b.lat - a.lat) * D2R, dl = (b.lon - a.lon) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function trackDistance(pts, maxAcc, minStep) {
    maxAcc = maxAcc || 50; minStep = minStep || 5; var d = 0, last = null;
    (pts || []).forEach(function (p) { if (p.acc != null && p.acc > maxAcc) return; if (!last) { last = p; return; } var s = haversine(last, p); if (s >= minStep) { d += s; last = p; } });
    return Math.round(d);
  }
  // Approximate distance along the segment: along the GPS track to the track point nearest the record, else straight line from the start.
  function chainage(seg, r) {
    if (r.lat == null) return null;
    var tr = (seg.start ? [seg.start] : []).concat(seg.track || []).filter(function (p) { return p.acc == null || p.acc <= 50; });
    // drop jitter points closer than 5 m, then project onto the nearest track segment (flat x/y, fine over a few km)
    var pts = []; tr.forEach(function (p) { if (!pts.length || haversine(pts[pts.length - 1], p) >= 5) pts.push(p); });
    if (pts.length > 1) {
      var o = pts[0], X = function (p) { return { x: (p.lon - o.lon) * D2R * EARTH * Math.cos(o.lat * D2R), y: (p.lat - o.lat) * D2R * EARTH }; };
      var q = X(r), cum = 0, best = null;
      for (var i = 0; i < pts.length - 1; i++) {
        var A = X(pts[i]), B = X(pts[i + 1]), dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
        var raw = len2 ? ((q.x - A.x) * dx + (q.y - A.y) * dy) / len2 : 0, k = Math.max(0, i === pts.length - 2 ? raw : Math.min(1, raw)) /* past the last point: keep going */, ex = A.x + k * dx - q.x, ey = A.y + k * dy - q.y, d = Math.sqrt(ex * ex + ey * ey);
        if (!best || d < best.d) best = { d: d, along: cum + k * len };
        cum += len;
      }
      if (best.d < 200) return Math.round(best.along);
    }
    var s = seg.start || tr[0]; return s && s.lat != null ? Math.round(haversine(s, r)) : null;
  }
  // Point at a distance and bearing (e.g. "the tree is 12 m away, bearing 80 deg").
  function offsetPoint(p, distM, bearingDeg) {
    var d = num(distM), b = num(bearingDeg); if (!p || p.lat == null || d == null || d <= 0 || b == null) return null;
    var dr = d / EARTH, br = b * D2R, la = p.lat * D2R, lo = p.lon * D2R;
    var la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(br));
    var lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
    return { lat: +(la2 * R2D).toFixed(6), lon: +(((lo2 * R2D + 540) % 360) - 180).toFixed(6) };
  }
  function norm360(d) { d = d % 360; return d < 0 ? d + 360 : d; }
  function cameraHeading(alpha, beta, gamma) {
    var a = alpha * D2R, b = beta * D2R, g = gamma * D2R;
    var ca = Math.cos(a), sa = Math.sin(a), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    var east = -(ca * sg + sa * sb * cg), north = ca * sb * cg - sa * sg;
    if (Math.abs(east) < 1e-9 && Math.abs(north) < 1e-9) return null;
    return norm360(Math.atan2(east, north) * R2D);
  }
  var DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function compassWord(deg) { return deg == null ? '' : DIRS[Math.round(norm360(deg) / 45) % 8]; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localStamp(iso) { var t = new Date(iso); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()); }
  function km(m) { return m == null ? '' : (m / 1000).toFixed(2) + ' km'; }

  // ---- CSV ----
  function csvCell(v) {
    if (v == null) return ''; if (typeof v === 'number') return isFinite(v) ? String(v) : '';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s)) s = "'" + s;
    return /[",\r\n]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(cols, rows) { return [cols].concat(rows.map(function (r) { return cols.map(function (c) { return r[c]; }); })).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }

  function lab(L, group, k) { return (L && L[group] && L[group][k]) || k || ''; }
  // Where the thing is: use the observer GPS, moved by distance + bearing when given.
  function thingPoint(r) { var o = offsetPoint(r, r.f && r.f.dist, r.f && r.f.bearing); return o || (r.lat != null ? { lat: r.lat, lon: r.lon } : null); }
  function describe(r, L) {
    var f = r.f || {}, p = [];
    if (r.type === 'hazard') { p.push(INDICATORS.filter(function (k) { return f.ind && f.ind[k]; }).map(function (k) { return lab(L, 'ind', k); }).join(', ')); var tg = (f.targets || []).map(function (k) { return lab(L, 'target', k); }).join('/'); if (tg) p.push('target: ' + tg); }
    if (r.type === 'trim') p.push(lab(L, 'issue', f.issue) + ' – ' + lab(L, 'close', f.close));
    if (r.type === 'fallen') p.push(lab(L, 'block', f.block) + (f.lines ? ' – POWER LINES INVOLVED' : ''));
    if (r.type === 'weeds') p.push((f.species || '') + (f.extent ? ' (' + lab(L, 'extent', f.extent) + (num(f.len) ? ', ' + num(f.len) + ' m' : '') + ')' : ''));
    if (r.type === 'protect') { var d = dbhFromCirc(f.circ); p.push((f.species || '') + (d ? ' DBH ' + d + ' cm' : '') + ((f.why || []).length ? ' – ' + f.why.map(function (k) { return lab(L, 'why', k); }).join(', ') : '')); }
    return p.filter(Boolean).join('; ');
  }
  var CSV_COLS = ['segment', 'road', 'authority', 'record_id', 'type', 'priority', 'risk_rating', 'done', 'date_local', 'side', 'chainage_m', 'latitude', 'longitude', 'accuracy_m',
    'obs_latitude', 'obs_longitude', 'bearing_deg', 'distance_m', 'from_edge_m', 'species', 'dbh_cm', 'details', 'likelihood_failure', 'likelihood_impact', 'consequence', 'photos', 'notes'];
  function rows(db, segId, L) {
    var sg = {}; (db.segments || []).forEach(function (s) { sg[s.id] = s; });
    return (db.records || []).filter(function (r) { return sg[r.segId] && (!segId || r.segId === segId); }).map(function (r) {
      var s = sg[r.segId], f = r.f || {}, pr = priority(r), h = r.type === 'hazard' ? hazardRating(f.lof || suggestLof(f.ind), f.impact || 'medium', f.size || 'medium') : null, pt = thingPoint(r);
      return { segment: s.name || '', road: s.road || '', authority: s.authority || '', record_id: r.id, type: lab(L, 'types', r.type), priority: lab(L, 'prio', pr), prio_key: pr, risk_rating: h ? lab(L, 'risk', h.risk) : '',
        done: !!r.done, date_local: localStamp(r.t), t: r.t, side: r.side || '', chainage_m: chainage(s, r), latitude: pt ? pt.lat : null, longitude: pt ? pt.lon : null, accuracy_m: r.acc != null ? Math.round(r.acc) : null,
        obs_latitude: r.lat, obs_longitude: r.lon, bearing_deg: num(f.bearing), distance_m: num(f.dist), from_edge_m: num(f.edge), species: f.species || '', dbh_cm: r.type === 'protect' || r.type === 'hazard' ? dbhFromCirc(f.circ) : null,
        details: describe(r, L), likelihood_failure: h ? lab(L, 'lof', f.lof || suggestLof(f.ind)) : '', likelihood_impact: h ? lab(L, 'impact', f.impact || 'medium') : '', consequence: h ? lab(L, 'cons', h.consequence) : '',
        photos: (db.photos || []).filter(function (p) { return p.recordId === r.id; }).length || null, notes: r.notes || '' };
    });
  }
  // Work list: open items, most urgent first, then road and distance along it. Protect trees listed last.
  function workList(db, segId, L, includeDone) {
    return rows(db, segId, L).filter(function (x) { return includeDone || !x.done; }).sort(function (a, b) {
      return prioRank(a.prio_key) - prioRank(b.prio_key) || (a.road < b.road ? -1 : a.road > b.road ? 1 : 0) || ((a.chainage_m || 0) - (b.chainage_m || 0)) || (a.t < b.t ? -1 : 1);
    });
  }
  function summary(db, segId) {
    var o = { total: 0, open: 0, done: 0, byPrio: {}, byType: {} }; PRIORITIES.forEach(function (p) { o.byPrio[p] = 0; }); TYPES.forEach(function (k) { o.byType[k] = 0; });
    (db.records || []).filter(function (r) { return !segId || r.segId === segId; }).forEach(function (r) {
      o.total++; o.byType[r.type]++; if (r.done) o.done++; else { o.open++; o.byPrio[priority(r)]++; }
    });
    return o;
  }
  function toGeoJSON(db, segId, L) {
    return { type: 'FeatureCollection', features: workList(db, segId, L, true).filter(function (x) { return x.latitude != null; }).map(function (x) {
      var p = {}; CSV_COLS.forEach(function (c) { if (c !== 'latitude' && c !== 'longitude') p[c] = x[c]; });
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [x.longitude, x.latitude] }, properties: p };
    }) };
  }

  var api = { VERSION: VERSION, num: num, TYPES: TYPES, PRIORITIES: PRIORITIES, prioRank: prioRank, LOF: LOF, IMPACT: IMPACT, CONS: CONS, M1: M1, M2: M2, SIZE_CONS: SIZE_CONS,
    hazardRating: hazardRating, INDICATORS: INDICATORS, suggestLof: suggestLof, TRIM_ISSUE: TRIM_ISSUE, TRIM_CLOSE: TRIM_CLOSE, trimPriority: trimPriority, fallenPriority: fallenPriority,
    autoPriority: autoPriority, priority: priority, dbhFromCirc: dbhFromCirc, haversine: haversine, trackDistance: trackDistance, chainage: chainage, offsetPoint: offsetPoint, thingPoint: thingPoint,
    norm360: norm360, cameraHeading: cameraHeading, compassWord: compassWord, localStamp: localStamp, km: km, csvCell: csvCell, toCSV: toCSV, CSV_COLS: CSV_COLS, rows: rows, workList: workList,
    summary: summary, describe: describe, toGeoJSON: toGeoJSON };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RT = api;
})(this);
