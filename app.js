/* Roadside Trees - UI. All data in IndexedDB on this phone only. */
(function () {
  'use strict';
  var VERSION = RT.VERSION;
  var lang = (navigator.language || 'en').slice(0, 2); if (!STRINGS[lang]) lang = 'en';
  var L = STRINGS[lang];
  function t(k, v) {
    var s = L[k] != null ? L[k] : STRINGS.en[k]; if (s == null) s = k;
    if (v && typeof s === 'string') Object.keys(v).forEach(function (n) { s = s.split('{' + n + '}').join(v[n]); });
    return s;
  }
  function tt(k, sub) { var o = t(k); return (o && o[sub] != null) ? o[sub] : sub; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  var main = $('main');
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function toast(msg) { var e = $('toast'); e.textContent = msg; e.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(function () { e.hidden = true; }, 2600); }
  function mapURL(p) { return 'https://www.openstreetmap.org/?mlat=' + p.lat + '&mlon=' + p.lon + '#map=18/' + p.lat + '/' + p.lon; }
  var COLORS = { hazard: '#c62828', trim: '#ef6c00', fallen: '#6d4c41', weeds: '#558b2f', protect: '#1565c0' };
  var PCOL = { urgent: '#b71c1c', high: '#e65100', moderate: '#f9a825', low: '#607d8b', protect: '#1565c0' };

  // ---------- storage ----------
  var STORES = ['segments', 'records', 'photos'], DB = { segments: [], records: [], photos: [] }, idb = null;
  function openDB() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no idb'));
      var q = indexedDB.open('roadside-trees', 1);
      q.onupgradeneeded = function () { STORES.forEach(function (s) { if (!q.result.objectStoreNames.contains(s)) q.result.createObjectStore(s, { keyPath: 'id' }); }); };
      q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
    });
  }
  function tx(store, mode, fn) {
    return new Promise(function (res, rej) {
      if (!idb) return res();
      var x = idb.transaction(store, mode), r = fn(x.objectStore(store));
      x.oncomplete = function () { res(r && r.result); }; x.onerror = function () { rej(x.error); };
    });
  }
  function put(store, obj) {
    var arr = DB[store], i = arr.findIndex(function (o) { return o.id === obj.id; });
    if (i >= 0) arr[i] = obj; else arr.push(obj);
    return tx(store, 'readwrite', function (s) { s.put(obj); }).catch(function () { toast(t('storageWarn')); });
  }
  function del(store, id) { DB[store] = DB[store].filter(function (o) { return o.id !== id; }); return tx(store, 'readwrite', function (s) { s.delete(id); }); }
  function loadAll() { return Promise.all(STORES.map(function (s) { return tx(s, 'readonly', function (st) { return st.getAll(); }).then(function (r) { DB[s] = r || []; }); })); }
  function get(store, id) { return DB[store].filter(function (o) { return o.id === id; })[0]; }
  function recsOf(sid) { return DB.records.filter(function (r) { return r.segId === sid; }).sort(function (a, b) { return a.t < b.t ? 1 : -1; }); }
  function photosOf(rid) { return DB.photos.filter(function (p) { return p.recordId === rid; }); }
  function delRecord(r) { photosOf(r.id).forEach(function (p) { del('photos', p.id); }); return del('records', r.id); }

  // ---------- sensors ----------
  var heading = null, gotAbs = false, compassOn = false;
  function onOrient(e, abs) {
    if (e.webkitCompassHeading != null) { heading = RT.norm360(e.webkitCompassHeading); if (window.onHeading) window.onHeading(); return; }
    var a = e.alpha; if (a == null || (!abs && !e.absolute)) return;
    var h = RT.cameraHeading(a, e.beta || 0, e.gamma || 0); if (h == null) h = RT.norm360(360 - a);
    heading = h; if (window.onHeading) window.onHeading();
  }
  function startCompass() {
    if (compassOn) return; compassOn = true;
    var go = function () {
      if ('ondeviceorientationabsolute' in window) addEventListener('deviceorientationabsolute', function (e) { gotAbs = true; onOrient(e, true); });
      addEventListener('deviceorientation', function (e) { if (!gotAbs) onOrient(e, false); });
    };
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().then(go, go);
    else go();
  }
  // Continuous GPS while walking; each tap takes the latest fix (if under 30 s old).
  var gps = { watch: null, fix: null, lock: null };
  function startGps(cb) {
    stopGps(); if (!navigator.geolocation) return cb && cb(null);
    gps.watch = navigator.geolocation.watchPosition(function (p) {
      gps.fix = { lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy * 10) / 10, at: Date.now() }; if (cb) cb(gps.fix);
    }, function () { if (cb) cb(null); }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { gps.lock = l; }, function () {});
  }
  function stopGps() { if (gps.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(gps.watch); gps.watch = null; if (gps.lock) { gps.lock.release().catch(function () {}); gps.lock = null; } }
  function freshFix() { return gps.fix && Date.now() - gps.fix.at < 30000 ? gps.fix : null; }

  // ---------- files ----------
  function download(name, blob) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    toast(t('exported', { f: name }));
  }
  function stamp() { return RT.localStamp(new Date().toISOString()).slice(0, 10); }
  function slug(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30); }
  function blobToData(b) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(b); }); }
  function dataToBlob(d) { return fetch(d).then(function (r) { return r.blob(); }); }
  // Segment GPS track: runs independently of the screen being shown.
  var trk = { sid: null, watch: null, last: 0, lock: null };
  function stopTrack() { if (trk.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(trk.watch); trk.watch = null; if (trk.lock) { trk.lock.release().catch(function () {}); trk.lock = null; } }
  function startTrack(s) {
    stopTrack(); trk.sid = s.id;
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { trk.lock = l; }, function () {});
    if (!navigator.geolocation) return;
    trk.watch = navigator.geolocation.watchPosition(function (p) {
      var now = Date.now(), cur = get('segments', trk.sid); if (!cur || !cur.runStart) return stopTrack();
      var pt = { lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy), t: new Date(now).toISOString() };
      if (!cur.start && pt.acc <= 50) { cur.start = pt; put('segments', cur); }
      if (!cur.trackOn || now - trk.last < 10000) return; trk.last = now;
      cur.track = cur.track || []; cur.track.push(pt); put('segments', cur); if (window.onTrack) window.onTrack();
    }, function () {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 60000 });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !navigator.wakeLock) return;
    if (trk.watch != null && (!trk.lock || trk.lock.released)) navigator.wakeLock.request('screen').then(function (l) { trk.lock = l; }, function () {});
  });
  function runSeconds(s) { var x = 0; (s.segs || []).forEach(function (g) { x += (Date.parse(g.end) - Date.parse(g.start)) / 1000; }); if (s.runStart) x += (Date.now() - Date.parse(s.runStart)) / 1000; return Math.max(0, Math.round(x)); }
  function hms(sec) { var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), q = sec % 60; return (h ? h + ':' + (m < 10 ? '0' : '') + m : m) + ':' + (q < 10 ? '0' : '') + q; }

  function exportSheet(sid) {
    var s = sid && get('segments', sid), base = 'roadside-trees' + (s ? '-' + slug(s.road || s.name) : '') + '-' + stamp();
    sheet('<h2>' + t('exportTitle') + (s ? ': ' + esc(s.name) : '') + '</h2><button class="go" id="eCsv">' + t('csv') + '</button><button class="go" id="eGeo">' + t('geojson') + '</button><button class="go" id="eTxt">' + t('wlTxt') + '</button>' +
      '<button id="eJson">' + t('backup') + '</button><button data-close>' + t('close') + '</button>', function () {
      $('eCsv').onclick = function () { var r = RT.workList(DB, sid, L, true); if (!r.length) return toast(t('nothing')); download(base + '-records.csv', new Blob(['\ufeff' + RT.toCSV(RT.CSV_COLS, r)], { type: 'text/csv' })); };
      $('eGeo').onclick = function () { var g = RT.toGeoJSON(DB, sid, L); if (!g.features.length) return toast(t('nothing')); download(base + '.geojson', new Blob([JSON.stringify(g)], { type: 'application/geo+json' })); };
      $('eTxt').onclick = function () { download(base + '-work-list.txt', new Blob([workText(sid)], { type: 'text/plain' })); };
      $('eJson').onclick = function () { backup(sid, base); };
    });
  }
  function backup(sid, base) {
    var sv = DB.segments.filter(function (s) { return !sid || s.id === sid; }); if (!sv.length) return toast(t('nothing'));
    var ids = {}; sv.forEach(function (s) { ids[s.id] = 1; });
    var recs = DB.records.filter(function (r) { return ids[r.segId]; }), rids = {}; recs.forEach(function (r) { rids[r.id] = 1; });
    var ph = DB.photos.filter(function (p) { return rids[p.recordId]; });
    var withPhotos = ph.length && confirm(t('backupPhotos'));
    (withPhotos ? Promise.all(ph.map(function (p) { return blobToData(p.blob).then(function (d) { var c = Object.assign({}, p); delete c.blob; c.data = d; return c; }); })) : Promise.resolve([])).then(function (photos) {
      download(base + '-backup.json', new Blob([JSON.stringify({ app: 'roadside-trees', version: VERSION, exported: new Date().toISOString(), segments: sv, records: recs, photos: photos })], { type: 'application/json' }));
    });
  }
  function restore(file) {
    var r = new FileReader();
    r.onload = function () {
      var o; try { o = JSON.parse(r.result); } catch (e) { o = null; }
      if (!o || o.app !== 'roadside-trees') return toast(t('badFile'));
      var n = 0, jobs = [];
      ['segments', 'records'].forEach(function (s) { (o[s] || []).forEach(function (x) { if (x && x.id) { n++; jobs.push(put(s, x)); } }); });
      (o.photos || []).forEach(function (p) { if (!p || !p.data) return; n++; jobs.push(dataToBlob(p.data).then(function (bb) { var c = Object.assign({}, p); delete c.data; c.blob = bb; return put('photos', c); })); });
      Promise.all(jobs).then(function () { toast(t('restored', { n: n })); render(); });
    };
    r.readAsText(file);
  }
  function workText(sid, withDone) {
    var s = sid && get('segments', sid), wl = RT.workList(DB, sid, L, withDone), out = [t('wlHead', { name: s ? s.name + (s.road ? ' (' + s.road + ')' : '') : 'all segments', date: stamp() })];
    var cur = null;
    wl.forEach(function (x, i) {
      if (x.prio_key !== cur) { cur = x.prio_key; out.push(''); out.push('== ' + tt('prio', cur).toUpperCase() + ' =='); }
      out.push((i + 1) + '. ' + x.type + (x.road ? ' – ' + x.road : '') + (x.side ? ' (' + tt('sides', x.side) + ')' : '') + (x.chainage_m != null ? ' @ ' + RT.km(x.chainage_m) : '') + (x.details ? ': ' + x.details : '') + (x.notes ? ' – ' + x.notes : '') +
        (x.latitude != null ? ' [' + x.latitude + ', ' + x.longitude + ']' : '') + (x.done ? ' (done)' : ''));
    });
    if (!wl.length) out.push(t('wlEmpty'));
    out.push(''); out.push(t('wlFoot') + ' ' + location.href.split('#')[0]);
    return out.join('\n');
  }
  function shareText(txt) {
    sheet('<h2>' + esc(t('share')) + '</h2><textarea id="sumTxt" rows="12" readonly>' + esc(txt) + '</textarea><button class="go" id="cp">' + t('copy') + '</button>' +
      (navigator.share ? '<button id="shr">' + t('share') + '</button>' : '') + '<button data-close>' + t('close') + '</button>', function () {
      $('cp').onclick = function () { $('sumTxt').select(); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast(t('copied')); }, function () { document.execCommand('copy'); toast(t('copied')); }); };
      if ($('shr')) $('shr').onclick = function () { navigator.share({ title: t('appName'), text: txt }).catch(function () {}); };
    });
  }
  function sheet(html, init) { var s = $('sheet'); s.innerHTML = '<div class="panel">' + html + '</div>'; s.hidden = false; s.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeSheet; }); if (init) init(s); }
  function closeSheet() { $('sheet').hidden = true; $('sheet').innerHTML = ''; }

  // ---------- views ----------
  var cleanup = null;
  function go(h) { location.hash = h; }
  function render() {
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    stopGps(); window.onHeading = null; window.onTrack = null; closeSheet();
    var h = location.hash.replace(/^#\/?/, '').split('/'), v = h[0] || '', id = h[1];
    document.body.className = 'v-' + (v || 'home'); scrollTo(0, 0);
    if (v === 'seg' && get('segments', id)) viewSeg(get('segments', id));
    else if (v === 'edit') viewEdit(id === 'new' ? null : get('segments', id));
    else if (v === 'new' && get('segments', id) && RT.TYPES.indexOf(h[2]) >= 0) viewRecord(null, get('segments', id), h[2]);
    else if (v === 'rec' && get('records', id)) viewRecord(get('records', id));
    else if (v === 'photo' && get('records', id)) viewPhoto(get('records', id));
    else if (v === 'work') viewWork(id && get('segments', id) ? id : null);
    else if (v === 'about') viewAbout();
    else viewHome();
  }
  function top(title, backTo) { return '<header class="bar">' + (backTo != null ? '<a class="back" href="#' + backTo + '">' + t('back') + '</a>' : '<img class="logo" src="icons/icon-192.png" alt="">') + '<h1>' + esc(title) + '</h1></header>'; }
  function radios(name, map, cur) { return '<div class="seg">' + Object.keys(map).map(function (k) { return '<label><input type="radio" name="' + name + '" value="' + k + '"' + (k === cur ? ' checked' : '') + '><span>' + esc(map[k]) + '</span></label>'; }).join('') + '</div>'; }
  function checks(name, map, cur) { cur = cur || {}; return '<div class="checks">' + Object.keys(map).map(function (k) { return '<label class="opt"><input type="checkbox" name="' + name + '" value="' + k + '"' + (cur[k] ? ' checked' : '') + '> ' + esc(map[k]) + '</label>'; }).join('') + '</div>'; }
  function inp(name, label, val, mode, ph) { return '<label>' + label + '<input name="' + name + '"' + (mode ? ' inputmode="' + mode + '"' : '') + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' value="' + esc(val == null ? '' : val) + '"></label>'; }
  function chip(p) { return '<span class="chip" style="background:' + PCOL[p] + '">' + esc(tt('prio', p)) + '</span>'; }

  function viewHome() {
    var h = top(t('appName')) + '<p class="lead">' + t('tagline') + '</p><div class="card warn">' + t('safetyShort') + '</div><a class="btn go big" href="#edit/new">' + t('newSeg') + '</a><h2>' + t('segs') + '</h2>';
    var list = DB.segments.slice().sort(function (a, b) { return a.created < b.created ? 1 : -1; });
    if (!list.length) h += '<p class="empty">' + t('noSegs') + '</p>';
    list.forEach(function (s) { var o = RT.summary(DB, s.id); h += '<a class="item" href="#seg/' + s.id + '"><b>' + esc(s.name) + (s.runStart ? ' <span class="chip live">' + t('running') + '</span>' : '') + '</b><span>' + esc(s.road || '') + ' · ' + RT.localStamp(s.created).slice(0, 10) + ' · ' + o.open + ' open' + (o.byPrio.urgent ? ' · ' + o.byPrio.urgent + ' urgent' : '') + '</span></a>'; });
    h += (list.length ? '<a class="btn" href="#work">' + t('workList') + ' (all)</a>' : '') + '<div class="row"><button id="bExp">' + t('exportAll') + '</button><button id="bRes">' + t('restore') + '</button></div>' +
      '<input type="file" id="fRes" accept=".json,application/json" hidden><a class="btn" href="#about">' + t('about') + '</a><p class="small center">' + t('version', { v: VERSION }) + ' · John Richards</p>';
    main.innerHTML = h;
    $('bExp').onclick = function () { exportSheet(null); };
    $('bRes').onclick = function () { $('fRes').click(); }; $('fRes').onchange = function () { if (this.files[0]) restore(this.files[0]); };
  }

  function viewEdit(s) {
    var isNew = !s; s = s || { id: uid(), created: new Date().toISOString(), mode: 'drive', side: 'L', trackOn: true, track: [], segs: [] };
    var h = top(isNew ? t('newSeg').replace('+ ', '') : t('editSeg'), isNew ? '' : 'seg/' + s.id) + '<form id="f" class="form">' +
      inp('road', t('road'), s.road, '', 'e.g. Seven Day Road') + inp('name', t('segName'), s.name, '', t('segNameEg')) + inp('authority', t('authority'), s.authority, '', t('authorityEg')) + inp('observer', t('observer'), s.observer) +
      '<fieldset><legend>' + t('mode') + '</legend>' + radios('mode', t('modes'), s.mode) + '</fieldset><fieldset><legend>' + t('sideDef') + '</legend>' + radios('side', t('sides'), s.side) + '<p class="small">' + t('sideHelp') + '</p></fieldset>' +
      '<label>' + t('notes') + '<textarea name="notes" rows="2">' + esc(s.notes || '') + '</textarea></label><button class="go big" type="submit">' + t('save') + '</button>' + (isNew ? '' : '<button type="button" class="bad" id="bDel">' + t('delSeg') + '</button>') + '</form>';
    main.innerHTML = h;
    var f = $('f');
    f.onsubmit = function (e) {
      e.preventDefault(); s.road = f.road.value.trim(); s.name = f.name.value.trim() || s.road || 'Segment'; s.authority = f.authority.value.trim(); s.observer = f.observer.value.trim();
      s.mode = (f.querySelector('[name=mode]:checked') || {}).value || 'drive'; s.side = (f.querySelector('[name=side]:checked') || {}).value || 'L'; s.notes = f.notes.value;
      put('segments', s).then(function () { go('seg/' + s.id); });
    };
    if ($('bDel')) $('bDel').onclick = function () { if (!confirm(t('confirmDelSeg'))) return; if (trk.sid === s.id) stopTrack(); recsOf(s.id).forEach(delRecord); del('segments', s.id).then(function () { go(''); }); };
  }

  function recTitle(r) { return tt('typeIcons', r.type) + ' ' + tt('types', r.type) + (r.side ? ' (' + r.side + ')' : ''); }
  function viewSeg(s) {
    var rs = recsOf(s.id);
    var h = top(s.name, '') + '<p class="small">' + esc([s.road, s.authority].filter(Boolean).join(' · ')) + '</p>' +
      '<div class="card walk"><div class="wrow"><div><small>' + t('time') + '</small><b id="wt">' + hms(runSeconds(s)) + '</b></div><div><small>' + t('dist') + '</small><b id="wd">' + RT.km(RT.trackDistance(s.track)) + '</b></div></div>' +
      '<button class="' + (s.runStart ? 'bad' : 'go') + '" id="bRun">' + (s.runStart ? t('stopSeg') : t('startSeg')) + '</button>' +
      '<label class="opt"><input type="checkbox" id="cTrack"' + (s.trackOn ? ' checked' : '') + '> ' + t('trackOn') + '</label><p class="small"><span id="tpn">' + t('trackPts', { n: (s.track || []).length }) + '</span> · ' + t('trackHelp') + '</p></div>' +
      '<h2>' + t('add') + '</h2><div class="types">' + RT.TYPES.map(function (k) { return '<a class="tbtn' + (k === 'hazard' ? ' wide' : '') + '" style="--c:' + COLORS[k] + '" href="#new/' + s.id + '/' + k + '"><i>' + tt('typeIcons', k) + '</i>' + esc(tt('types', k)) + '</a>'; }).join('') + '</div>' +
      '<a class="btn go" href="#work/' + s.id + '">' + t('workList') + '</a><div class="row"><button id="bShare">' + t('shareWl') + '</button><button id="bExp">' + t('exportThis') + '</button></div>' +
      '<h2>' + t('records', { n: rs.length }) + '</h2>' + (rs.length ? '' : '<p class="empty">' + t('noRecords') + '</p>') +
      rs.map(function (r) {
        var p = RT.priority(r), pt = RT.thingPoint(r);
        return '<div class="item rec" style="--c:' + COLORS[r.type] + '"><a href="#rec/' + r.id + '"><b>' + recTitle(r) + ' ' + chip(p) + (r.done ? ' ✔' : '') + '</b><span>' + RT.localStamp(r.t).slice(11) + ' · ' + (r.lat != null ? '±' + Math.round(r.acc) + ' m' : t('noGps')) + (photosOf(r.id).length ? ' · 📷' + photosOf(r.id).length : '') + ' · ' + esc(RT.describe(r, L)) + '</span></a>' +
          (pt ? '<a class="maplink" target="_blank" rel="noopener" href="' + mapURL(pt) + '">' + t('openMap') + '</a>' : '') + '</div>';
      }).join('') + '<a class="btn" href="#edit/' + s.id + '">' + t('editSeg') + '</a>';
    main.innerHTML = h;
    var tick = setInterval(function () { var c = get('segments', s.id); if (c && $('wt')) $('wt').textContent = hms(runSeconds(c)); }, 1000);
    cleanup = function () { clearInterval(tick); };
    window.onTrack = function () { var c = get('segments', s.id); if (!c || !$('wd')) return; $('wd').textContent = RT.km(RT.trackDistance(c.track)); $('tpn').textContent = t('trackPts', { n: c.track.length }); };
    $('bRun').onclick = function () {
      if (s.runStart) { s.segs = (s.segs || []).concat([{ start: s.runStart, end: new Date().toISOString() }]); s.runStart = null; stopTrack(); }
      else { DB.segments.forEach(function (o) { if (o.runStart && o.id !== s.id) { o.segs = (o.segs || []).concat([{ start: o.runStart, end: new Date().toISOString() }]); o.runStart = null; put('segments', o); } }); s.runStart = new Date().toISOString(); trk.last = 0; startTrack(s);
        if (!s.start && navigator.geolocation) navigator.geolocation.getCurrentPosition(function (p) { var c = get('segments', s.id); if (c && !c.start && p.coords.accuracy <= 50) { c.start = { lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy), t: new Date().toISOString() }; put('segments', c); } }, function () {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }); }
      put('segments', s).then(render);
    };
    $('cTrack').onchange = function () { s.trackOn = this.checked; put('segments', s); };
    $('bShare').onclick = function () { shareText(workText(s.id)); }; $('bExp').onclick = function () { exportSheet(s.id); };
  }

  function viewRecord(r, s, type) {
    var isNew = !r;
    if (isNew) r = { id: uid(), segId: s.id, type: type, t: new Date().toISOString(), lat: null, lon: null, acc: null, side: s.side === 'both' ? '' : s.side, prio: 'auto', done: false, notes: '',
      f: type === 'hazard' ? { ind: {}, targets: ['road'], impact: 'medium', size: 'medium' } : type === 'trim' ? { issue: 'road', close: 'encroaching' } : type === 'fallen' ? { block: 'partial' } : type === 'weeds' ? { extent: 'patch' } : { why: [] } };
    s = s || get('segments', r.segId); var f0 = r.f, ty = r.type;
    var h = top(tt('typeIcons', ty) + ' ' + tt('types', ty), 'seg/' + s.id) + '<form id="f" class="form">' +
      (ty === 'fallen' ? '<div class="card danger">' + t('fallenNote') + '<p><a class="btn small" href="tel:000">000</a><a class="btn small" href="tel:131351">Western Power 13 13 51</a><a class="btn small" href="tel:138138">Main Roads WA 138 138</a></p></div>' : '') +
      '<div class="card gps"><b>' + t('gps') + '</b> <span id="gpsTxt">' + (r.lat != null ? t('gpsKeep', { acc: Math.round(r.acc) }) + ' (' + r.lat + ', ' + r.lon + ')' : t('gpsWait')) + '</span>' + (isNew ? '' : ' <button type="button" class="btn small" id="bGps">' + t('gpsAgain') + '</button>') + '</div>' +
      '<fieldset><legend>' + t('side') + '</legend>' + radios('side', { L: tt('sides', 'L'), R: tt('sides', 'R'), C: tt('sides', 'C') }, r.side) + '</fieldset>';
    if (ty === 'hazard') {
      h += '<fieldset><legend>' + t('indTitle') + '</legend>' + checks('ind', t('ind'), f0.ind) + '</fieldset>' +
        '<fieldset><legend>' + t('lofQ') + '</legend>' + radios('lof', t('lof'), f0.lof) + '<p class="small" id="lofS"></p></fieldset>' +
        '<fieldset><legend>' + t('targetQ') + '</legend>' + checks('targets', t('target'), (f0.targets || []).reduce(function (o, k) { o[k] = 1; return o; }, {})) + '</fieldset>' +
        '<fieldset><legend>' + t('impactQ') + '</legend>' + radios('impact', t('impact'), f0.impact) + '</fieldset><fieldset><legend>' + t('sizeQ') + '</legend>' + radios('size', t('size'), f0.size) + '</fieldset>' +
        '<div class="card rating"><p id="rating"></p><p class="small">' + t('ratingNote') + '</p></div>' + inp('circ', t('circ'), f0.circ, 'decimal') + '<p class="hint" id="dbh"></p>';
    } else if (ty === 'trim') {
      h += '<fieldset><legend>' + t('issueQ') + '</legend>' + radios('issue', t('issue'), f0.issue) + '</fieldset><div class="card warn" id="pwn"' + (f0.issue === 'powerline' ? '' : ' hidden') + '>' + t('powerNote') + '</div>' +
        '<fieldset><legend>' + t('closeQ') + '</legend>' + radios('close', t('close'), f0.close) + '</fieldset>';
    } else if (ty === 'fallen') {
      h += '<fieldset><legend>' + t('blockQ') + '</legend>' + radios('block', t('block'), f0.block) + '</fieldset><label class="opt danger-opt"><input type="checkbox" name="lines"' + (f0.lines ? ' checked' : '') + '> ' + t('lines') + '</label>';
    } else if (ty === 'weeds') {
      h += inp('species', t('species'), f0.species, '', t('weedEg')) + '<fieldset><legend>' + t('extentQ') + '</legend>' + radios('extent', t('extent'), f0.extent) + '</fieldset>' + inp('len', t('len'), f0.len, 'decimal');
    } else if (ty === 'protect') {
      h += inp('species', t('treeSp'), f0.species, '', t('treeEg')) + inp('circ', t('circ'), f0.circ, 'decimal') + '<p class="hint" id="dbh"></p><fieldset><legend>' + t('whyQ') + '</legend>' +
        checks('why', t('why'), (f0.why || []).reduce(function (o, k) { o[k] = 1; return o; }, {})) + '</fieldset><p class="small">' + t('protectNote') + '</p>';
    }
    h += '<details' + (f0.bearing || f0.dist || f0.edge ? ' open' : '') + '><summary>Where exactly (optional)</summary><div class="step">' + inp('bearing', t('bearing'), f0.bearing, 'numeric') + '<button type="button" class="btn small" id="bCmp">' + t('useCompass') + '</button></div>' +
      inp('dist', t('distTo'), f0.dist, 'decimal') + inp('edge', t('edge'), f0.edge, 'decimal') + '<p class="small">' + t('whereHelp') + '</p></details>' +
      '<label>' + t('prioQ') + '<select name="prio" id="prio"></select></label><label class="opt"><input type="checkbox" name="done"' + (r.done ? ' checked' : '') + '> ' + t('done') + '</label>' +
      '<label>' + t('notes') + '<textarea name="notes" rows="2">' + esc(r.notes || '') + '</textarea></label>' +
      '<div class="thumbs" id="th"></div><button type="button" id="bPhoto">' + t('addPhoto') + '</button><button class="go big" type="submit">' + t('save') + '</button>' + (isNew ? '' : '<button type="button" class="bad" id="bDel">' + t('del') + '</button>') + '</form>';
    main.innerHTML = h;
    var f = $('f'), urls = [];
    $('th').innerHTML = photosOf(r.id).map(function (p) { var u = URL.createObjectURL(p.blob); urls.push(u); return '<figure><img src="' + u + '" alt=""><figcaption>' + (p.bearing != null ? p.bearing + '° ' + RT.compassWord(p.bearing) : '') + '</figcaption></figure>'; }).join('');
    cleanup = function () { urls.forEach(URL.revokeObjectURL); };
    function gps() {
      var t0 = Date.now(), best = null;
      startGps(function (fx) { if (!fx) { if (!best && $('gpsTxt')) $('gpsTxt').textContent = t('gpsFail'); return; } if (!best || fx.acc <= best.acc || Date.now() - t0 > 30000) best = fx; r.lat = best.lat; r.lon = best.lon; r.acc = best.acc; if ($('gpsTxt')) $('gpsTxt').textContent = t('gpsGot', { acc: Math.round(best.acc) }) + ' (' + best.lat + ', ' + best.lon + ')'; });
    }
    if (isNew) gps(); if ($('bGps')) $('bGps').onclick = gps;
    $('bCmp').onclick = function () { startCompass(); window.onHeading = function () { if (heading != null) f.bearing.value = Math.round(heading); }; toast('Point the top of the phone at the tree'); };
    function collect() {
      var o = {};
      Array.prototype.forEach.call(f.elements, function (el) {
        if (!el.name || ['notes', 'side', 'prio', 'done'].indexOf(el.name) >= 0) return;
        if (el.name === 'ind') { o.ind = o.ind || {}; if (el.checked) o.ind[el.value] = true; return; }
        if (el.name === 'targets' || el.name === 'why') { o[el.name] = o[el.name] || []; if (el.checked) o[el.name].push(el.value); return; }
        if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else if (el.type === 'checkbox') o[el.name] = el.checked; else o[el.name] = el.value.trim();
      });
      return o;
    }
    function upd() {
      var o = collect(), tmp = { type: ty, f: o }, auto = RT.autoPriority(tmp), cur = f.prio.value || r.prio || 'auto';
      f.prio.innerHTML = '<option value="auto">' + esc(t('prioAuto', { p: tt('prio', auto) })) + '</option>' + RT.PRIORITIES.map(function (p) { return '<option value="' + p + '">' + esc(tt('prio', p)) + '</option>'; }).join(''); f.prio.value = cur;
      if (ty === 'hazard') {
        var sg = RT.suggestLof(o.ind); $('lofS').innerHTML = t('lofHelp', { s: tt('lof', sg) });
        var hr = RT.hazardRating(o.lof || sg, o.impact || 'medium', o.size || 'medium');
        $('rating').innerHTML = hr ? t('ratingOut', { fi: tt('fi', hr.failImpact), c: tt('cons', hr.consequence), r: tt('risk', hr.risk), p: tt('prio', hr.priority) }) : '';
        $('rating').parentNode.style.borderLeftColor = hr ? PCOL[hr.priority] : '#ccc';
      }
      if ($('dbh')) { var d = RT.dbhFromCirc(o.circ); $('dbh').textContent = d ? t('dbhIs', { d: d }) : ''; }
      if ($('pwn')) $('pwn').hidden = o.issue !== 'powerline';
    }
    f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
    function save() { r.f = collect(); r.side = (f.querySelector('[name=side]:checked') || {}).value || ''; r.prio = f.prio.value; r.done = f.done.checked; r.notes = f.notes.value.trim(); return put('records', r); }
    f.onsubmit = function (e) { e.preventDefault(); stopGps(); save().then(function () { toast(t('saved')); go('seg/' + s.id); }); };
    $('bPhoto').onclick = function () { stopGps(); save().then(function () { go('photo/' + r.id); }); };
    if ($('bDel')) $('bDel').onclick = function () { if (confirm(t('confirmDel'))) delRecord(r).then(function () { go('seg/' + s.id); }); };
  }

  function compress(src, w, h) {
    var max = 1280, k = Math.min(1, max / Math.max(w, h)), cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(h * k); cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    return new Promise(function (res) { cv.toBlob(function (bb) { res({ blob: bb, w: cv.width, h: cv.height }); }, 'image/jpeg', 0.7); });
  }
  function viewPhoto(r) {
    var stream = null, back = '#rec/' + r.id;
    main.innerHTML = '<div class="cam"><video id="vid" playsinline muted autoplay></video>' +
      '<div class="camtop"><a class="back" href="' + back + '">' + t('back') + '</a><span>' + esc(tt('types', r.type)) + '</span><span id="hd">' + t('noCompass') + '</span></div>' +
      '<div class="cambot"><button class="go big" id="snap">' + t('takePhoto') + '</button><button id="pick">' + t('pickPhoto') + '</button><input type="file" id="file" accept="image/*" capture="environment" hidden></div></div>';
    document.body.className = 'v-photo';
    cleanup = function () { if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); }); };
    startCompass();
    window.onHeading = function () { if (heading != null && $('hd')) $('hd').textContent = t('facing', { b: Math.round(heading), w: RT.compassWord(heading) }); };
    function saveBlob(x) { put('photos', { id: uid(), recordId: r.id, date: new Date().toISOString(), bearing: heading == null ? null : Math.round(heading), w: x.w, h: x.h, blob: x.blob }).then(function () { toast(t('photoSaved')); location.hash = back; }); }
    var vid = $('vid');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } }).then(function (st) { stream = st; vid.srcObject = st; }, function () { toast(t('noCamera')); });
    else toast(t('noCamera'));
    $('snap').onclick = function () { if (!stream || !vid.videoWidth) return $('file').click(); compress(vid, vid.videoWidth, vid.videoHeight).then(saveBlob); };
    $('pick').onclick = function () { $('file').click(); };
    $('file').onchange = function () { var fl = this.files[0]; if (!fl) return; var img = new Image(), u = URL.createObjectURL(fl); img.onload = function () { compress(img, img.naturalWidth, img.naturalHeight).then(function (x) { URL.revokeObjectURL(u); saveBlob(x); }); }; img.src = u; };
  }

  function viewWork(sid, withDone) {
    var s = sid && get('segments', sid), o = RT.summary(DB, sid), wl = RT.workList(DB, sid, L, withDone);
    function row(a, b) { return '<tr><td>' + a + '</td><td><b>' + b + '</b></td></tr>'; }
    var h = top(t('wlTitle') + (s ? ': ' + s.name : ''), s ? 'seg/' + s.id : '') +
      '<div class="card"><h3>' + t('byPrio') + '</h3><table class="lt">' + RT.PRIORITIES.map(function (p) { return row(chip(p), o.byPrio[p]); }).join('') + row(t('doneN'), o.done) + '</table>' +
      '<h3>' + t('byType') + '</h3><table class="lt">' + RT.TYPES.map(function (k) { return row(tt('typeIcons', k) + ' ' + tt('types', k), o.byType[k]); }).join('') + '</table></div>' +
      '<label class="opt"><input type="checkbox" id="cDone"' + (withDone ? ' checked' : '') + '> ' + t('showDone') + '</label>' +
      (wl.length ? '<ol class="wl">' + wl.map(function (x) {
        return '<li style="border-left-color:' + PCOL[x.prio_key] + '"><a href="#rec/' + x.record_id + '"><b>' + chip(x.prio_key) + ' ' + esc(x.type) + '</b></a> ' + (x.done ? '✔ ' : '') + '<span class="small">' + esc([x.road, x.side ? tt('sides', x.side) || x.side : '', x.chainage_m != null ? RT.km(x.chainage_m) : ''].filter(Boolean).join(' · ')) + '</span><br>' +
          esc(x.details) + (x.notes ? ' — ' + esc(x.notes) : '') + (x.latitude != null ? ' <a class="small" target="_blank" rel="noopener" href="' + mapURL({ lat: x.latitude, lon: x.longitude }) + '">' + t('openMap') + '</a>' : '') + '</li>';
      }).join('') + '</ol>' : '<p class="empty">' + t('wlEmpty') + '</p>') +
      '<p class="small">' + t('ratingNote') + '</p><div class="row"><button id="bShare">' + t('shareWl') + '</button><button id="bExp">' + t('exportAll') + '</button></div>';
    main.innerHTML = h;
    $('cDone').onchange = function () { viewWork(sid, this.checked); };
    $('bShare').onclick = function () { shareText(workText(sid, withDone)); }; $('bExp').onclick = function () { exportSheet(sid); };
  }

  function viewAbout() {
    main.innerHTML = top(t('about'), '') + '<div class="card">' + t('aboutText') + '</div><div class="card danger"><h3>' + t('safetyTitle') + '</h3>' + t('safetyLong') + '</div>' +
      '<div class="card"><h3>' + t('howTitle') + '</h3>' + t('howToText') + '</div><div class="card"><h3>Simplified hazard matrix</h3>' + matrixHtml() + '<p class="small">' + t('ratingNote') + '</p></div>' +
      '<div class="card"><h3>' + t('limitsTitle') + '</h3>' + t('limitsText') + '</div><div class="card"><h3>' + t('sourcesTitle') + '</h3>' + t('sourcesText') + '</div>' +
      (window.MoreTools ? MoreTools.html('roadside-trees') : '') + '<p class="small center">' + t('version', { v: VERSION }) + ' · <a href="https://github.com/johnrichardszpe-dot/roadside-trees">GitHub</a></p>';
  }
  function matrixHtml() {
    var a = '<p class="small">1. Likelihood of failure × how often something is there:</p><table class="mx"><tr><th></th>' + RT.IMPACT.map(function (k) { return '<th>' + esc(tt('impact', k).split(' (')[0]) + '</th>'; }).join('') + '</tr>' +
      RT.LOF.slice().reverse().map(function (l) { return '<tr><th>' + esc(tt('lof', l)) + '</th>' + RT.M1[l].map(function (v) { return '<td>' + esc(tt('fi', v)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
    var b = '<p class="small">2. Result × consequences (from part size: small = minor, medium = significant, large = severe):</p><table class="mx"><tr><th></th>' + RT.CONS.map(function (k) { return '<th>' + esc(tt('cons', k)) + '</th>'; }).join('') + '</tr>' +
      ['verylikely', 'likely', 'somewhat', 'unlikely'].map(function (l) { return '<tr><th>' + esc(tt('fi', l)) + '</th>' + RT.M2[l].map(function (v) { return '<td class="r-' + v + '">' + esc(tt('risk', v)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
    return a + b + '<p class="small">Other records use simple rules: trims near power lines touching = Urgent, inside clearance = High; sight lines/signs touching = High; fallen trees blocking a lane or with power lines = Urgent, partly on road = High; continuous weeds = Moderate, otherwise Low.</p>';
  }

  // ---------- start ----------
  window.addEventListener('hashchange', render);
  $('sheet').addEventListener('click', function (e) { if (e.target.id === 'sheet') closeSheet(); });
  openDB().then(function (d) { idb = d; return loadAll(); }).catch(function () { toast(t('storageWarn')); }).then(function () {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    var w = DB.segments.filter(function (s) { return s.runStart; })[0]; if (w) startTrack(w);
    render();
  });
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  window.RTApp = { DB: DB, version: VERSION, workText: workText };
})();
