/* "More free tools by John Richards" - the same list is shipped in every app (keep the copies identical). */
(function (root) {
  'use strict';
  var BASE = 'https://johnrichardszpe-dot.github.io/';
  var APPS = [
    ['tree-gauge', '🌲', 'Tree Gauge', 'Forest basal area with the phone camera (angle-gauge method)'],
    ['planting-survey', '🌱', 'Planting Survey', 'Seedling survival %, trees per hectare and photo points'],
    ['fuel-check', '🔥', 'Fuel Check', 'Simple step-by-step bushfire fuel hazard check'],
    ['forest-explorer', '🧭', 'Forest Explorer', 'School forest science kit: height, trunk, carbon'],
    ['habitat-survey', '🦜', 'Habitat Survey', 'Habitat trees, hollows, wildlife sightings and signs'],
    ['orchard-counter', '🍎', 'Orchard Counter', 'Row-by-row tree counts, gaps, replant list, yield sample'],
    ['roadside-trees', '🚧', 'Roadside Trees', 'Roadside and powerline tree hazards, trimming and work lists'],
    ['universe-map', '🌌', 'Universe map', 'Explore John Richards\u2019 map of the universe']
  ];
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function html(self) {
    return '<section class="more-tools" style="background:#fff;border-radius:14px;padding:12px 14px;margin:12px 0;box-shadow:0 1px 3px rgba(0,0,0,.15);color:#1f2a1f;text-align:left">' +
      '<h3 style="margin:4px 0 6px;font-size:17px">More free tools by John Richards</h3>' +
      '<p style="margin:0 0 6px;font-size:14px;color:#5d6b5d">Free, offline-first phone apps. No account, no adverts. Open once with internet, then add to your home screen.</p>' +
      '<ul style="list-style:none;padding:0;margin:0">' + APPS.map(function (a) {
        var me = a[0] === self;
        return '<li style="margin:0;border-top:1px solid #eef0e8;padding:8px 0;font-size:15px">' + (me ? '' : '<a href="' + BASE + a[0] + '/" target="_blank" rel="noopener" style="color:#2f5d34;font-weight:700">') +
          a[1] + ' ' + esc(a[2]) + (me ? ' <small>(this app)</small>' : '</a>') + '<br><span style="font-size:13px;color:#5d6b5d">' + esc(a[3]) + '</span></li>';
      }).join('') + '</ul></section>';
  }
  root.MoreTools = { APPS: APPS, html: html };
})(this);
