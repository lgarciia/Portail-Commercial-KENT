import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildCumulModel, UNASSIGNED } from '../reporting-cumul-model.js';
import router from '../api/router.js';

const zero = () => Array(12).fill(0);
const values = (...numbers) => [...numbers, ...zero()].slice(0, 12);
const seller = (id, actual, budget, extra = {}) => ({
  id, identifier: id, displayName: id, active: true, relationType: 'principal', responsableId: 'north',
  responsables: [{ id: 'north', displayName: 'Équipe Nord' }],
  metrics: { caMensuel: actual, reelMensuel: actual, budgetMensuel: budget, budgetsActifs: 1, reelMoisImportes: [1, 2, 3, 4, 5, 6] },
  ...extra
});
const build = (commercials, extra = {}) => buildCumulModel({ commercials, year: 2026, month: 6, ...extra });
const a = seller('a', values(100), values(50, 0, 0, 0, 0, 0, 250));
const b = seller('b', values(900), values(900, 0, 0, 0, 0, 0, 900));
let model = build([a, b]);
assert.equal(model.total.actual, 1000);
assert.equal(model.total.budget, 950);
assert.equal(model.total.achievement, 1000 / 950);
assert.notEqual(model.total.achievement, (2 + 1) / 2);
assert.equal(model.total.projection, 2000);
assert.equal(model.total.annualBudget, 2100);
assert.equal(model.total.remaining, 1100);
assert.equal(model.groups[0].values.projection, model.total.projection);
assert.equal(model.rows[0].id, 'b');
assert.equal(build([seller('over', values(1000), values(100))]).total.remaining, -900);
assert.equal(build([seller('zero', zero(), zero())]).total.achievement, null);
assert.equal(build([seller('negative', values(-20), values(-100))]).total.achievement, null);
assert.equal(build([]).total.projection, 0);
assert.throws(() => build([a, a]), /double/);
assert.throws(() => build([seller('bad', [1], zero())]), /douze/);
assert.throws(() => build([seller('bad', values(NaN), zero())]), /invalide/);
assert.throws(() => build([a], { month: 0 }), /valides/);
assert.throws(() => build([a], { settings: [{ year: 2026, month: 1, source: 'unknown' }] }), /incohérentes/);
assert.equal(build([{ ...a, hidden: true }, b]).total.actual, 900);
assert.equal(build([{ ...a, active: false }, b]).total.actual, 900);
assert.equal(build([a, { ...b, relationType: 'exceptionnel' }]).groups.find(group => group.id === UNASSIGNED).values.actual, 900);
assert.equal(build([{ ...a, displayName: 'Même nom' }, { ...b, displayName: 'Même nom' }]).rows.length, 2);
assert.equal(build([a, b], { managerId: 'missing' }).rows.length, 0);
assert.equal(build([{ ...a, displayName: 'Frédéric' }, b], { search: 'frederic' }).total.actual, 100);
assert.deepEqual(build([a, { ...a, id: 'z' }, b]).rows.map(row => row.rank), [1, 2, 2]);
model = build([seller('hybrid', values(9999, 20, 0, 0, 0, 0, 9999), zero(), {
  metrics: { ...a.metrics, caMensuel: values(9999, 20, 0, 0, 0, 0, 9999), reelMensuel: values(100, 900), budgetMensuel: zero(), reelMoisImportes: [] }
})], { settings: [{ year: 2026, month: 1, source: 'real' }, { year: 2025, month: 2, source: 'real' }] });
assert.equal(model.total.actual, 120, 'Use only the selected source and exclude future actuals');
assert.equal(model.missingImportCount, 1);
assert.equal(model.rows[0].missingImports[0], 1);
for (let month = 1; month <= 12; month++) {
  const rows = Array.from({ length: 243 }, (_, index) => seller(String(index), values((index - 12) * 0.01), values(0.01), {
    responsableId: index % 2 ? 'north' : 'south'
  }));
  const result = build(rows, { month });
  const roundedSum = items => Math.round(items.reduce((total, value) => total + value, 0) * 100);
  assert.equal(roundedSum(result.rows.map(row => row.values.projection)), Math.round(result.total.projection * 100));
  assert.equal(roundedSum(result.groups.map(group => group.values.projection)), Math.round(result.total.projection * 100));
  assert.equal(Math.round(result.total.projection * 100), Math.round(Math.round(result.total.actual * 100) * 12 / month));
}
console.log('PASS calculations: weighted rates, source selection, cutoff, stable identities, ties, negative amounts, exact cent rollups (12 periods / 243 sellers)');

// Every server request is intercepted. No production credentials or real database are used.
process.env.ACCESS_SESSION_SECRET = 'cumul-test-only';
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
const uid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const admins = [{ id: uid(900), display_name: 'Admin Test', identifier: 'admin.test', role: 'admin', active: true }];
const managers = [901, 902].map((id, index) => ({ id: uid(id), display_name: ['Équipe Nord', 'Équipe Sud'][index], identifier: `manager.${id}`, role: 'responsable', active: true }));
const salespeople = Array.from({ length: 142 }, (_, index) => ({ id: uid(index + 1), display_name: `Commercial ${String(index + 1).padStart(3, '0')}`, identifier: `commercial.${index + 1}`, role: 'commercial', active: true }));
salespeople[0].display_name = '<img src=x onerror="window.xss=true">';
const keys = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const tables = {
  portal_users: [...admins, ...managers, ...salespeople],
  portal_user_relations: salespeople.map((user, index) => ({ id: uid(1000 + index), commercial_user_id: user.id, responsable_user_id: managers[index % 2].id, relation_type: 'principal', active: true })),
  portal_commercial_sectors: [],
  v_kent_dashboard_sales_daily: salespeople.flatMap((user, index) => Array.from({ length: 9 }, (_, month) => ({ commercial_user_id: user.id, secteur: month % 2 ? 'industrie' : 'auto', date: `2026-${String(month + 1).padStart(2, '0')}-01`, annee: 2026, mois: month + 1, montant: (index + 1) * 20, lignes: 1, ventes: 1 }))),
  v_kent_dashboard_budget_summary: salespeople.map(user => ({ commercial_user_id: user.id, annee: 2026, entite_id: 'budget-entity', active_budgets: 1, lignes: 1, ...Object.fromEntries(keys.map(key => [key, 2500])) })),
  v_kent_dashboard_real_summary: salespeople.flatMap((user, index) => Array.from({ length: 6 }, (_, month) => ({ commercial_user_id: user.id, entite_id: 'real-entity', annee: 2026, mois: month + 1, montant: (index + 1) * 110, lignes: 1, quantite: 1 }))),
  reel_imports: salespeople.flatMap((user, index) => Array.from({ length: 6 }, (_, month) => ({ id: uid(2000 + index * 12 + month), commercial_user_id: user.id, entite_id: 'real-entity', annee: 2026, mois: month + 1, statut: 'active', total_mois: (index + 1) * 110, nb_lignes: 1 }))),
  finance_source_settings: Array.from({ length: 6 }, (_, index) => ({ annee: 2026, mois: index + 1, source: 'real' })),
  v_kent_dashboard_visits_monthly: [], v_kent_dashboard_clients_total: [],
  clients: [], industrie_clients: [], visites: [], industrie_visites: []
};
let calls = [];
let failingTable = '';
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  assert.equal(url.origin, 'https://supabase.test');
  assert.equal(options.method || 'GET', 'GET', 'Reporting must never write to Supabase');
  const table = url.pathname.split('/').at(-1);
  calls.push({ table, query: url.searchParams.toString() });
  assert.ok(Object.hasOwn(tables, table), `Unexpected query: ${table}`);
  if (failingTable === table) return Response.json({ message: 'Synthetic upstream failure' }, { status: 503 });
  let rows = tables[table];
  for (const [key, value] of url.searchParams) {
    if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
    if (value.startsWith('in.(')) rows = rows.filter(row => value.slice(4, -1).split(',').includes(String(row[key])));
  }
  const offset = Number(url.searchParams.get('offset') || 0);
  return Response.json(rows.slice(offset, offset + Number(url.searchParams.get('limit') || 1000)));
};
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function cookie(role) {
  if (!role) return '';
  const encoded = Buffer.from(JSON.stringify({ v: 2, dayKey, id: 'admin.test', userId: 'admin.test', dbUserId: uid(900), name: 'Admin Test', role })).toString('base64url');
  return `kent_portal_day=v2.${encoded}.${crypto.createHmac('sha256', process.env.ACCESS_SESSION_SECRET).update(encoded).digest('hex')}`;
}
async function callApi(url, role = 'admin', method = 'GET') {
  const result = { status: 200, body: null };
  const response = { status(code) { result.status = code; return this; }, setHeader() {}, json(body) { result.body = body; }, end(body) { result.body = body ? JSON.parse(body) : null; } };
  await router({ url, method, headers: { cookie: cookie(role) } }, response);
  return result;
}
const cumulUrl = '/api/responsable-dashboard?year=2026&month=6&day=2026-06-30&mode=cumul';
for (const [role, status] of [['', 401], ['commercial', 403], ['responsable', 403]]) {
  assert.equal((await callApi(cumulUrl, role)).status, status);
}
assert.equal(calls.length, 0, 'Unauthorized requests must not reach the database');
assert.equal((await callApi(cumulUrl, 'admin', 'POST')).status, 405);
const cumul = await callApi(cumulUrl);
assert.equal(cumul.status, 200);
assert.deepEqual(cumul.body.errors, []);
assert.deepEqual(cumul.body.warnings, []);
assert.equal(cumul.body.commercials.length, 142);
assert.ok(!calls.some(call => /clients|visites|documents|campaign|promo/.test(call.table)));
const cumulCalls = calls.length;
calls = [];
const finance = await callApi(cumulUrl.replace('mode=cumul', 'mode=finance'));
assert.equal(finance.status, 200);
for (let index = 0; index < 142; index++) {
  for (const metric of ['caMensuel', 'reelMensuel', 'budgetMensuel', 'budgetAnnuel', 'reelMoisImportes']) {
    assert.deepEqual(cumul.body.commercials[index].metrics[metric], finance.body.commercials[index].metrics[metric]);
  }
}
console.log(`PASS API: admin-only, read-only, 142 sellers paginated/scoped; identical finance amounts; ${cumulCalls} reads instead of ${calls.length}`);
failingTable = 'v_kent_dashboard_real_summary';
assert.ok((await callApi(cumulUrl)).body.errors.length > 0, 'Partial data must be reported, not disguised as a zero total');
failingTable = '';

if (process.env.CUMUL_NO_BROWSER === '1') process.exit(0);
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
const artifacts = path.join(os.tmpdir(), 'kent-cumul-audit');
await fs.mkdir(artifacts, { recursive: true });
const xlsxBundle = process.env.XLSX_TEST_BUNDLE ? await fs.readFile(process.env.XLSX_TEST_BUNDLE, 'utf8') : '';
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  const network = [];
  let failUi = false;
  let slowYear = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://cumul.test') return route.fulfill({ contentType: 'text/javascript', body: url.pathname.endsWith('/xlsx.full.min.js') ? xlsxBundle : '' });
    if (url.pathname.startsWith('/api/')) {
      network.push(url.pathname + url.search);
      assert.ok(['GET', 'POST'].includes(route.request().method()));
      if (url.pathname === '/api/session') return route.fulfill({ json: { user: { name: 'Admin Test', role: 'admin' } } });
      if (url.pathname === '/api/session-activity') return route.fulfill({ json: { ok: true } });
      assert.equal(route.request().method(), 'GET');
      if (url.pathname === '/api/admin-users') return route.fulfill({ json: { users: [], relations: [], sectors: [], stats: {} } });
      if (url.pathname === '/api/admin-tarifs-conditionnements') return route.fulfill({ json: { plaques: {}, commercials: [], access: [] } });
      if (url.pathname === '/api/responsable-dashboard' && failUi) return route.fulfill({ json: { ...cumul.body, errors: ['Test : données de budget indisponibles'] } });
      const result = await callApi(url.pathname + url.search);
      if (slowYear && url.searchParams.get('year') === '2025') await new Promise(resolve => setTimeout(resolve, 400));
      return route.fulfill({ status: result.status, json: result.body }).catch(() => {});
    }
    const filename = path.resolve(root, `.${url.pathname}`);
    assert.ok(filename.startsWith(root));
    const body = await fs.readFile(filename);
    return route.fulfill({ body, contentType: filename.endsWith('.html') ? 'text/html' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript' });
  });
  await page.goto('http://cumul.test/admin.html');
  await page.waitForFunction(() => !document.querySelector('#syncDialog')?.open);
  assert.equal(network.filter(url => url.includes('mode=cumul')).length, 0, 'Lazy load only on entering Reporting cumul');
  await page.locator('[data-admin-tab="finance"]').first().click();
  await page.locator('[data-admin-view="finance"] [data-finance-section-target="reporting-cumul"]').click();
  await page.waitForFunction(() => document.querySelector('[data-cumul-result]').hidden === false);
  await page.locator('[data-cumul-filters] [name="year"]').selectOption('2026');
  await page.waitForFunction(() => document.querySelector('[data-cumul-app]').getAttribute('aria-busy') === 'false');
  await page.locator('[data-cumul-filters] [name="month"]').selectOption('6');
  const count = network.length;
  assert.equal(await page.locator('[data-cumul-projection] .cumul-seller').count(), 142);
  assert.equal(await page.locator('[data-cumul-projection] [data-cumul-month-head]').count(), 12);
  assert.equal(await page.locator('[data-cumul-projection] [data-cumul-month-head]').first().getAttribute('colspan'), '3');
  const rendered = await page.locator('[data-cumul-projection] tfoot').textContent();
  const expected = buildCumulModel({ commercials: cumul.body.commercials, settings: (await callApi('/api/admin-finance-settings?year=2026')).body.settings, year: 2026, month: 6 });
  assert.ok(rendered.includes(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(expected.total.actual)));
  assert.equal(await page.locator('[data-cumul-projection] img').count(), 0);
  assert.equal(await page.evaluate(() => window.xss), undefined);
  const currency = value => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
  const firstRow = page.locator('[data-cumul-projection] [data-cumul-seller]').first();
  assert.equal(await firstRow.locator('[data-metric="actual"]').count(), 12);
  assert.equal(await firstRow.locator('[data-month="1"][data-metric="actual"]').textContent(), currency(expected.rows[0].values.monthlyActual[0]));
  assert.equal(await firstRow.locator('[data-month="7"][data-metric="actual"]').textContent(), '—');
  assert.equal(await firstRow.locator('[data-month="7"][data-metric="budget"]').textContent(), currency(2500));
  assert.equal(await page.locator('[data-cumul-projection] tfoot [data-month="1"][data-metric="actual"]').textContent(), currency(expected.total.monthlyActual[0]));
  await page.locator('[data-cumul-layout]').selectOption('groups');
  assert.equal(await page.locator('[data-cumul-projection] .cumul-seller').count(), 142, 'Every team expanded by default');
  assert.ok((await page.locator('[data-cumul-projection] .cumul-group').first().textContent()).includes('Équipe'));
  await page.locator('[data-cumul-expand]').click();
  assert.equal(await page.locator('[data-cumul-projection] .cumul-seller').count(), 0);
  assert.ok((await page.locator('[data-cumul-projection] tfoot').textContent()).includes(currency(expected.total.actual)));
  await page.locator('[data-cumul-expand]').click();
  assert.equal(await page.locator('[data-cumul-projection] .cumul-seller').count(), 142);
  await page.locator('[data-cumul-layout]').selectOption('all');
  await page.locator('[data-cumul-columns]').selectOption('ca');
  assert.equal(await page.locator('[data-cumul-projection] [data-cumul-month-head]').first().getAttribute('colspan'), '1');
  assert.equal(await firstRow.locator('[data-metric="budget"]').count(), 0);
  await page.locator('[data-cumul-columns]').selectOption('detail');
  await page.locator('[data-cumul-filters] [name="manager"]').selectOption(uid(901));
  assert.equal(await page.locator('[data-cumul-projection] .cumul-seller').count(), 71);
  await page.locator('[data-cumul-filters] [name="search"]').fill('Commercial 003');
  await page.waitForFunction(() => document.querySelectorAll('[data-cumul-projection] .cumul-seller').length === 1);
  await page.locator('[data-cumul-filters] [name="search"]').fill('');
  await page.waitForFunction(() => document.querySelectorAll('[data-cumul-projection] .cumul-seller').length === 71);
  await page.locator('[data-cumul-filters] [name="manager"]').selectOption('');
  assert.equal(network.length, count, 'Filters and drilldowns must not make more server requests');
  await page.locator('[data-cumul-app]').screenshot({ path: path.join(artifacts, 'projection-desktop.png') });
  await page.locator('[data-cumul-projection] [data-cumul-jump="summary"]').click();
  assert.ok(await page.locator('[data-cumul-projection] .cumul-table-wrap').evaluate(wrap => wrap.scrollLeft > 0));
  await page.locator('[data-cumul-app]').screenshot({ path: path.join(artifacts, 'projection-cumuls-desktop.png') });
  await page.locator('[data-cumul-projection] [data-cumul-jump="start"]').click();
  assert.equal(await page.locator('[data-cumul-projection] .cumul-table-wrap').evaluate(wrap => wrap.scrollLeft), 0);
  await page.locator('[data-reporting-cumul-view="top-ca"]').click();
  assert.equal(await page.locator('[data-cumul-ranking] [data-cumul-seller]').count(), 142);
  await page.locator('[data-cumul-limit]').selectOption('100');
  assert.equal(await page.locator('[data-cumul-ranking] [data-cumul-seller]').count(), 100);
  await page.locator('[data-cumul-limit]').selectOption('all');
  assert.equal(await page.locator('[data-cumul-ranking] [data-cumul-seller]').count(), 142);
  if (xlsxBundle) {
    await page.evaluate(() => {
      window.XLSX.writeFile = (book, name) => {
        // Round-trip the actual XLSX bytes in memory, without creating an artifact or touching data.
        const bytes = window.XLSX.write(book, { type: 'array', bookType: 'xlsx' });
        const parsed = window.XLSX.read(bytes, { type: 'array' });
        window.exportTest = { name, sheets: Object.fromEntries(parsed.SheetNames.map(sheet => [sheet, window.XLSX.utils.sheet_to_json(parsed.Sheets[sheet], { header: 1, defval: null })])) };
      };
    });
    await page.locator('[data-cumul-export]').click();
    const exported = await page.evaluate(() => window.exportTest);
    assert.equal(exported.name, 'KENTIX_Reporting_cumul_2026_06.xlsx');
    assert.equal(exported.sheets.Commerciaux.length, 144);
    assert.equal(exported.sheets.Commerciaux.at(-1)[5], expected.total.actual);
    assert.equal(exported.sheets.Commerciaux.at(-1)[7], expected.total.achievement);
    assert.equal(exported.sheets.Commerciaux.at(-1)[10], expected.total.projection);
    assert.equal(exported.sheets.Responsables.at(-1)[2], expected.total.actual);
    assert.equal(exported.sheets.Mensuel.length, 144, 'One row per seller plus header and total');
    assert.equal(exported.sheets.Mensuel[0][3], 'Janvier · CA');
    assert.equal(exported.sheets.Mensuel[0][36], 'Décembre · CA');
    assert.equal(exported.sheets.Mensuel[1][3], expected.rows[0].values.monthlyActual[0]);
    assert.equal(exported.sheets.Mensuel[1][21], null, 'Future actuals excluded in export');
    assert.equal(exported.sheets.Mensuel.at(-1)[3], expected.total.monthlyActual[0]);
    assert.equal(exported.sheets.Mensuel.at(-1)[39], expected.total.actual);
    assert.equal(exported.sheets.Mensuel.at(-1)[41], expected.total.achievement);
    assert.equal(exported.sheets.Mensuel.at(-1)[44], expected.total.projection);
    assert.ok(exported.sheets['Méthode'].length > 10);
    console.log('PASS XLSX: byte-level round trip, four sheets, complete filtered scope, numeric totals/rates and future exclusion');
  } else console.log('SKIP XLSX round trip: set XLSX_TEST_BUNDLE to the existing SheetJS 0.18.5 browser bundle');
  await page.locator('[data-cumul-app]').screenshot({ path: path.join(artifacts, 'top-ca-desktop.png') });
  for (const width of [1440, 1280, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No page overflow at ${width}px`);
    assert.ok(await page.locator('[data-cumul-ranking] .cumul-table-wrap').evaluate(el => el.scrollWidth > el.clientWidth), 'Excel-style matrix scrolls inside its own frame');
    const geometry = await page.locator('[data-cumul-ranking] .cumul-table-wrap').evaluate(async wrap => {
      wrap.scrollLeft = 800;
      wrap.scrollTop = 120;
      await new Promise(requestAnimationFrame);
      const rect = wrap.getBoundingClientRect();
      const name = wrap.querySelector('tbody .cumul-fixed-name').getBoundingClientRect();
      const top = wrap.querySelector('thead tr:first-child th').getBoundingClientRect();
      const monthHead = wrap.querySelector('[data-cumul-month-head]').getBoundingClientRect();
      const lower = wrap.querySelector('thead tr:nth-child(2) th').getBoundingClientRect();
      const result = { nameLeft: name.left - rect.left, top: top.top - rect.top, overlap: lower.top < monthHead.bottom - 1 };
      wrap.scrollLeft = 0;
      wrap.scrollTop = 0;
      return result;
    });
    assert.ok(Math.abs(geometry.nameLeft - 1) <= 1, `Names remain frozen at ${width}px`);
    assert.ok(Math.abs(geometry.top - 1) <= 1, `Headers remain frozen at ${width}px`);
    assert.equal(geometry.overlap, false, `Two header rows do not overlap at ${width}px`);
    if (width === 390) await page.locator('[data-cumul-app]').screenshot({ path: path.join(artifacts, 'top-ca-mobile.png') });
  }
  failUi = true;
  await page.locator('[data-cumul-refresh]').click();
  await page.waitForFunction(() => document.querySelector('[data-cumul-status]').classList.contains('cumul-error'));
  assert.equal(await page.locator('[data-cumul-result]').isVisible(), false);
  assert.equal(await page.locator('[data-cumul-export]').isDisabled(), true);
  assert.equal(await page.locator('[data-cumul-ranking] table').count(), 0);
  failUi = false;
  await page.locator('[data-cumul-refresh]').click();
  await page.waitForFunction(() => document.querySelector('[data-cumul-result]').hidden === false);
  slowYear = true;
  await page.locator('[data-cumul-filters] [name="year"]').selectOption('2025');
  await page.locator('[data-cumul-filters] [name="year"]').selectOption('2026');
  await page.waitForFunction(() => document.querySelector('[data-cumul-result]').hidden === false);
  await page.waitForTimeout(500);
  assert.ok((await page.locator('[data-cumul-period]').textContent()).includes('2026'));
  assert.deepEqual(errors, []);
  console.log(`PASS browser: months in columns, all sellers visible, optional grouping, monthly totals, compact CA, sticky names/headers, filters without requests, Top100/all, XSS escaping, desktop/mobile, partial errors, request races. Screenshots: ${artifacts}`);
} finally { await browser.close(); }
