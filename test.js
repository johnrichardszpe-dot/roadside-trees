/* node test.js - unit tests for logic.js */
process.env.TZ = 'Australia/Perth';
var R = require('./logic.js'), assert = require('assert'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok', name); }
var near = function (a, b, e) { assert(Math.abs(a - b) <= (e || 1e-9), a + ' != ' + b); };
t('TRAQ-style matrix 1 + 2 (every cell)', function () {
  var m1 = { imminent: ['unlikely', 'somewhat', 'likely', 'verylikely'], probable: ['unlikely', 'unlikely', 'somewhat', 'likely'], possible: ['unlikely', 'unlikely', 'unlikely', 'somewhat'], improbable: ['unlikely', 'unlikely', 'unlikely', 'unlikely'] };
  var m2 = { verylikely: ['low', 'moderate', 'high', 'extreme'], likely: ['low', 'moderate', 'high', 'high'], somewhat: ['low', 'low', 'moderate', 'moderate'], unlikely: ['low', 'low', 'low', 'low'] };
  assert.deepStrictEqual(R.M1, m1); assert.deepStrictEqual(R.M2, m2);
  assert.deepStrictEqual(R.hazardRating('imminent', 'high', 'large'), { failImpact: 'verylikely', consequence: 'severe', risk: 'extreme', priority: 'urgent' });
  assert.strictEqual(R.hazardRating('probable', 'high', 'medium').risk, 'high');
  assert.strictEqual(R.hazardRating('possible', 'high', 'large').risk, 'moderate');
  assert.strictEqual(R.hazardRating('imminent', 'low', 'large').risk, 'moderate');
  assert.strictEqual(R.hazardRating('imminent', 'high', 'small').risk, 'moderate');
  assert.strictEqual(R.hazardRating('probable', 'verylow', 'large').risk, 'low');
  assert.strictEqual(R.hazardRating('x', 'high', 'large'), null);
});
t('suggested likelihood of failure from indicators', function () {
  assert.strictEqual(R.suggestLof({}), 'improbable'); assert.strictEqual(R.suggestLof({ deadbranch: true }), 'possible');
  assert.strictEqual(R.suggestLof({ decay: true, lean: true }), 'probable'); assert.strictEqual(R.suggestLof({ hanging: true }), 'probable');
  assert.strictEqual(R.suggestLof({ rootlift: true, lean: true }), 'imminent'); assert.strictEqual(R.suggestLof({ crack: true, hanging: true }), 'imminent');
});
t('simple rules for trim / fallen / weeds / protect, manual override', function () {
  assert.strictEqual(R.trimPriority('powerline', 'touching'), 'urgent'); assert.strictEqual(R.trimPriority('powerline', 'encroaching'), 'high');
  assert.strictEqual(R.trimPriority('sightline', 'touching'), 'high'); assert.strictEqual(R.trimPriority('road', 'growing'), 'low');
  assert.strictEqual(R.fallenPriority('verge', true), 'urgent'); assert.strictEqual(R.fallenPriority('full'), 'urgent'); assert.strictEqual(R.fallenPriority('partial'), 'high'); assert.strictEqual(R.fallenPriority('verge'), 'moderate');
  assert.strictEqual(R.priority({ type: 'weeds', f: { extent: 'continuous' } }), 'moderate'); assert.strictEqual(R.priority({ type: 'weeds', f: {} }), 'low');
  assert.strictEqual(R.priority({ type: 'protect', f: {} }), 'protect'); assert.strictEqual(R.priority({ type: 'weeds', f: {}, prio: 'high' }), 'high'); assert.strictEqual(R.priority({ type: 'weeds', f: {}, prio: 'auto' }), 'low');
  assert.strictEqual(R.priority({ type: 'hazard', f: { ind: { dead: true, crack: true }, impact: 'medium', size: 'large' } }), 'moderate'); // probable x medium = somewhat; severe -> moderate
});
t('DBH, geo, offset point, chainage', function () {
  near(R.dbhFromCirc(314.2), 100); assert.strictEqual(R.dbhFromCirc(''), null);
  near(R.haversine({ lat: -34, lon: 116 }, { lat: -34.001, lon: 116 }), 111.2, 0.2);
  var p = R.offsetPoint({ lat: -34, lon: 116 }, 100, 0); near(R.haversine({ lat: -34, lon: 116 }, p), 100, 0.5); assert(p.lat > -34);
  assert.strictEqual(R.offsetPoint({ lat: -34, lon: 116 }, '', 90), null);
  var tr = [0, 1, 2, 3, 4].map(function (i) { return { lat: -34 - i * 0.001, lon: 116, acc: 5 }; });
  near(R.chainage({ track: tr }, { lat: -34.003, lon: 116.0001 }), 334, 2);
  near(R.chainage({ start: { lat: -34, lon: 116 } }, { lat: -34.002, lon: 116 }), 222, 1); assert.strictEqual(R.chainage({}, { lat: null }), null);
});
t('work list sort, summary, CSV + GeoJSON with formula guard', function () {
  var db = { segments: [{ id: 's', name: 'Seg', road: 'Seven Day Rd', start: { lat: -34, lon: 116 } }], photos: [{ recordId: 'b' }], records: [
    { id: 'a', segId: 's', type: 'weeds', t: '2026-10-21T01:00:00Z', lat: -34.001, lon: 116, acc: 5, side: 'L', f: { species: '=blackberry', extent: 'patch' } },
    { id: 'b', segId: 's', type: 'fallen', t: '2026-10-21T02:00:00Z', lat: -34.003, lon: 116, acc: 7, side: 'R', f: { block: 'full' } },
    { id: 'c', segId: 's', type: 'trim', t: '2026-10-21T03:00:00Z', lat: -34.002, lon: 116, acc: 4, side: 'L', f: { issue: 'powerline', close: 'encroaching', bearing: 90, dist: 10 } },
    { id: 'd', segId: 's', type: 'protect', t: '2026-10-21T04:00:00Z', lat: -34.004, lon: 116, acc: 4, f: { species: 'Karri', circ: 471, why: ['hollows'] } },
    { id: 'e', segId: 's', type: 'trim', t: '2026-10-21T05:00:00Z', lat: -34.0, lon: 116, acc: 4, done: true, f: { issue: 'road', close: 'touching' } }] };
  var wl = R.workList(db, 's', {}); assert.deepStrictEqual(wl.map(function (x) { return x.record_id; }), ['b', 'c', 'a', 'd']);
  assert.strictEqual(R.workList(db, 's', {}, true).length, 5);
  var o = R.summary(db, 's'); assert.strictEqual(o.open, 4); assert.strictEqual(o.done, 1); assert.strictEqual(o.byPrio.urgent, 1); assert.strictEqual(o.byPrio.high, 1); assert.strictEqual(o.byType.trim, 2);
  var c = wl[1]; assert(c.longitude > 116.0001 && c.obs_longitude === 116); assert.strictEqual(c.chainage_m, 222);
  assert.strictEqual(wl[3].dbh_cm, 149.9); assert(wl[3].details.indexOf('Karri DBH 149.9 cm – hollows') === 0);
  var csv = R.toCSV(R.CSV_COLS, wl).split('\r\n'); assert.strictEqual(csv[0], R.CSV_COLS.join(','));
  assert(csv[3].indexOf("'=blackberry (patch)") > 0, csv[3]); assert(csv[1].indexOf(',urgent,,no,2026-10-21 10:00,R,334,-34.003,116,7,') > 0, csv[1]);
  assert.strictEqual(R.csvCell(-34.5), '-34.5'); assert.strictEqual(R.csvCell('@SUM(1)'), "'@SUM(1)");
  var g = R.toGeoJSON(db, 's', {}); assert.strictEqual(g.features.length, 5); assert.deepStrictEqual(g.features[0].geometry.coordinates, [116, -34.003]);
});
console.log(n + ' tests passed');
