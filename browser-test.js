/* Headless Chrome smoke test: PUPPETEER=/path/to/puppeteer-core node browser-test.js http://localhost:8782/ shot.png */
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const URL = process.argv[2] || 'http://localhost:8782/'; const SHOT = process.argv[3];
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.createBrowserContext(); const pg = await ctx.newPage();
  await pg.emulateTimezone('Australia/Perth');
  await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [], bad = [];
  pg.on('pageerror', e => errs.push('pageerror ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  pg.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  pg.on('dialog', d => d.accept());
  await ctx.overridePermissions(new globalThis.URL(URL).origin, ['geolocation']);
  const at = async dy => pg.setGeolocation({ latitude: -34.2400 - dy, longitude: 116.1500, accuracy: 6 });
  await at(0);
  await pg.goto(URL, { waitUntil: 'networkidle0' });
  await pg.evaluate(() => navigator.serviceWorker.ready);
  const W = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await pg.waitForSelector(s); await pg.click(s); await W(250); };
  const homeSafety = await pg.$eval('.warn', e => e.textContent.includes('8 m'));
  await click('a[href="#edit/new"]');
  await pg.type('[name=road]', 'Seven Day Road'); await pg.type('[name=name]', 'Seven Day Rd north'); await pg.type('[name=authority]', 'Shire of Manjimup');
  await click('input[name=side][value=L]+span'); await click('button[type=submit]');
  await click('#bRun'); await W(600);
  // hazard tree: hanging branch + crack -> imminent; road, busy, large -> extreme -> urgent
  await at(0.0005); await click('a[href$="/hazard"]'); await W(1200);
  await click('input[name=ind][value=hanging]'); await click('input[name=ind][value=crack]');
  await click('input[name=impact][value=high]+span'); await click('input[name=size][value=large]+span');
  await pg.type('[name=circ]', '220');
  const rating = await pg.$eval('#rating', e => e.textContent); const lofS = await pg.$eval('#lofS', e => e.textContent); const dbh = await pg.$eval('#dbh', e => e.textContent);
  if (SHOT) { await pg.evaluate(() => document.querySelector('.rating').scrollIntoView({ block: 'center' })); await W(2500); await pg.screenshot({ path: SHOT.replace('.png', '-hazard.png') }); }
  await click('#bPhoto'); await W(1500); await click('#snap'); await W(1500);
  const thumbs = await pg.$$eval('#th img', e => e.length);
  await click('button[type=submit]');
  // trim near powerline, inside clearance -> high; with bearing/distance
  await at(0.0010); await click('a[href$="/trim"]'); await W(1000);
  await click('input[name=issue][value=powerline]+span'); const pwn = await pg.$eval('#pwn', e => !e.hidden);
  await pg.evaluate(() => document.querySelector('details').open = true); await pg.type('[name=bearing]', '90'); await pg.type('[name=dist]', '12'); await pg.type('[name=edge]', '3');
  await click('input[name=side][value=R]+span'); await click('button[type=submit]');
  // fallen branch partly on road -> high
  await at(0.0020); await click('a[href$="/fallen"]'); await W(900); const fallenTel = await pg.$$eval('a[href^="tel:"]', e => e.map(a => a.getAttribute('href'))); await click('button[type=submit]');
  // weeds, override priority to moderate; notes with formula
  await at(0.0030); await click('a[href$="/weeds"]'); await W(900); await pg.type('[name=species]', 'Blackberry'); await pg.select('#prio', 'moderate'); await pg.type('[name=notes]', '=spray, +slash'); await click('button[type=submit]');
  // protect
  await at(0.0040); await click('a[href$="/protect"]'); await W(900); await pg.type('[name=species]', 'Karri'); await pg.type('[name=circ]', '471'); await click('input[name=why][value=hollows]'); await click('button[type=submit]');
  await W(300);
  if (SHOT) { await W(2500); await pg.evaluate(() => scrollTo(0, 0)); await pg.screenshot({ path: SHOT }); }
  await click('#bRun');
  const hash = await pg.evaluate(() => location.hash); const sid = hash.split('/')[1];
  await click('a[href="#work/' + sid + '"]'); await W(400);
  const wl = await pg.$$eval('.wl li', e => e.map(x => x.textContent));
  await click('#bShare'); const share = await pg.$eval('#sumTxt', e => e.value); await click('[data-close]');
  const ex = await pg.evaluate(id => ({ csv: RT.toCSV(RT.CSV_COLS, RT.workList(RTApp.DB, id, STRINGS.en, true)).split('\r\n'), geo: RT.toGeoJSON(RTApp.DB, id, STRINGS.en).features.length }), sid);
  await click('#bExp'); const expBtns = await pg.$$eval('#sheet button', e => e.length); await click('[data-close]');
  await pg.setOfflineMode(true); await pg.goto(URL + '#seg/' + sid, { waitUntil: 'load' }); await W(800);
  const off = await pg.$$eval('.rec b', e => e.length);
  await pg.goto(URL + '#about', { waitUntil: 'load' }); await W(400);
  const about = await pg.$eval('main', e => ({ wp: e.textContent.includes('13 13 51'), mr: e.textContent.includes('138 138'), notCert: e.textContent.includes('Not a certified'), more: e.textContent.includes('More free tools by John Richards'), mx: document.querySelectorAll('.mx td').length }));
  const moreLinks = await pg.$$eval('.more-tools a', e => e.length);
  await pg.setOfflineMode(false);
  console.log(JSON.stringify({ errs, bad, homeSafety, rating, lofS, dbh, thumbs, pwn, fallenTel, wl, share, csvHead: ex.csv[0], csv: ex.csv.slice(1, 6), geo: ex.geo, expBtns, offlineRecords: off, about, moreLinks }, null, 1));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
