import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import router from '../api/router.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '99999999-9999-4999-8999-999999999999';
const clientId = '22222222-2222-4222-8222-222222222222';
const plaqueId = '33333333-3333-4333-8333-333333333333';
const productId = '44444444-4444-4444-8444-444444444444';
const user = { id: 'test.commercial', dbUserId: userId, name: 'Commercial Test', role: 'commercial' };
process.env.ACCESS_SESSION_SECRET = 'fiche-client-test-only';
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-real-key';
const dayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const encoded = Buffer.from(JSON.stringify({ v: 2, dayKey, ...user, userId: user.id })).toString('base64url');
const signature = crypto.createHmac('sha256', process.env.ACCESS_SESSION_SECRET).update(encoded).digest('hex');
const cookie = `kent_portal_day=v2.${encoded}.${signature}`;
let tables;
let requests;

function resetData(sector) {
  const prefix = sector === 'industrie' ? 'industrie_' : '';
  const plaque = { id: plaqueId, nom: 'Tarif Test' };
  const client = { id: clientId, nom: 'Client Test', numero_compte: '00-34', adresse: 'Caen',
    telephone: '', taille_client: 'M', created_at: '2026-01-01', plaque_id: plaqueId,
    commercial_user_id: userId, plaques: plaque, industrie_plaques: plaque };
  tables = {
    [`${prefix}clients`]: [client, { ...client, id: otherUserId, nom: 'Client autre commercial', commercial_user_id: otherUserId }],
    [`${prefix}client_comptes`]: [],
    [`${prefix}produits`]: [{ id: productId, nom: 'Produit Test', reference_produit: 'TEST-001',
      actif: true, prix_vente: 10, origine: null, created_by_user_id: null, promo_deleted_at: null }],
    [`${prefix}tarifs_plaques`]: [{ plaque_id: plaqueId, produit_id: productId, prix_vente: 12.5 }],
    [`${prefix}conditionnements_produits`]: [],
    [`${prefix}plaques`]: [plaque],
    [`${prefix}visites`]: [],
    [`${prefix}visite_commandes`]: [],
    commercial_plaque_access: [{ plaque_id: plaqueId, commercial_user_id: userId, secteur: sector }],
    documents_commerciaux: []
  };
  requests = [];
}

// No request from the server under test can reach an actual Supabase project.
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  assert.equal(url.origin, 'https://supabase.test', 'External network access is forbidden');
  const table = url.pathname.split('/').at(-1);
  assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
  const method = options.method || 'GET';
  requests.push({ table, method, query: url.searchParams.toString() });
  if (/\s/.test(url.searchParams.get('select') || '')) {
    return Response.json({ message: 'failed to parse select parameter', details: 'unexpected newline', code: 'PGRST100' }, { status: 400 });
  }
  if (method === 'POST') {
    const inputRows = JSON.parse(options.body);
    const inserted = (Array.isArray(inputRows) ? inputRows : [inputRows]).map(row => ({ id: crypto.randomUUID(), ...row }));
    tables[table].push(...inserted);
    return Response.json(inserted);
  }
  assert.equal(method, 'GET', 'Only reads and synthetic inserts are used by these tests');
  let rows = tables[table];
  for (const [key, value] of url.searchParams) {
    if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
    if (value.startsWith('in.(')) rows = rows.filter(row => value.slice(4, -1).split(',').includes(String(row[key])));
  }
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Number(url.searchParams.get('limit') || 1000);
  return Response.json(rows.slice(offset, offset + limit));
};

async function callApi(payload, sector, requestCookie = cookie, rawBody = false) {
  const body = JSON.stringify(payload);
  const req = rawBody ? Readable.from([body]) : { body: JSON.parse(body) };
  req.url = `/api/router?__route=fiche-client&secteur=${sector}`;
  req.method = 'POST';
  req.headers = { cookie: requestCookie, 'content-type': 'application/json' };
  const result = { status: 200, body: null };
  const res = {
    setHeader() {},
    status(code) { result.status = code; return this; },
    json(data) { result.body = data; },
    end(data) { result.body = data && JSON.parse(data); }
  };
  await router(req, res);
  return result;
}

const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
try {
  for (const sector of ['auto', 'industrie']) {
    resetData(sector);
    const prefix = sector === 'industrie' ? 'industrie_' : '';
    for (const rawBody of [false, true]) {
      const result = await callApi({ table: `${prefix}clients`, select: `\n id,\r\n nom,\n ${prefix}plaques ( id, nom )\n` }, sector, cookie, rawBody);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.data.map(row => row.id), [clientId]);
      assert.equal(new URLSearchParams(requests.at(-1).query).get('select'), `id,nom,${prefix}plaques(id,nom)`);
    }
    const denied = await callApi({ table: `${prefix}clients` }, sector, '');
    assert.equal(denied.status, 401);
    const forbiddenSelect = await callApi({ table: `${prefix}clients`, select: 'id,secret_column' }, sector);
    assert.equal(forbiddenSelect.status, 403);
    const forbiddenVisit = await callApi({ table: `${prefix}visites`, action: 'insert', payload: { client_id: otherUserId } }, sector);
    assert.equal(forbiddenVisit.status, 403);

    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://fiche-client.test') return route.fulfill({ body: '', contentType: 'text/javascript' });
      if (url.pathname === '/api/session') return route.fulfill({ json: { user } });
      if (url.pathname === '/api/session-activity') return route.fulfill({ json: { ok: true } });
      if (url.pathname === '/api/fiche-client') {
        const result = await callApi(route.request().postDataJSON(), url.searchParams.get('secteur'));
        if (result.status >= 400) errors.push(`${result.status}: ${JSON.stringify(result.body)}`);
        return route.fulfill({ status: result.status, json: result.body });
      }
      const file = path.resolve(root, `.${url.pathname}`);
      assert.ok(file.startsWith(root));
      const body = await fs.readFile(file);
      const contentType = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
      return route.fulfill({ body, contentType });
    });
    const filename = sector === 'auto' ? 'ficherclt.html' : 'ficherclt-industrie.html';
    await page.goto(`http://fiche-client.test/${filename}`);
    try {
      await page.waitForFunction(() => document.querySelector('#clientSelect')?.value, null, { timeout: 8000 });
      assert.equal(await page.locator('#clientSelect option').count(), 1);
      await page.locator('#openVisitModalBtn').click();
      await page.locator('.produit-search-input').fill('TEST-001');
      await page.locator('.produit-search-input').dispatchEvent('change');
      await page.locator('.quantite-input').fill('2');
      await page.locator('.stock-input').fill('3');
      await page.locator('.stock-commande-info-input').fill('ST test');
      await page.locator('.demo-input').check();
      await page.locator('#popupNote').fill('Visite de test uniquement en memoire');
      assert.equal(await page.locator('.prix-unitaire-input').inputValue(), '12.50');
      await page.locator('#saveVisitBtn').click();
      await page.waitForFunction(() => !document.querySelector('#visitModalOverlay').classList.contains('active'), null, { timeout: 8000 });
      await page.waitForFunction(() => state.visites.length === 1 && state.visites[0].commandes.length === 1, null, { timeout: 8000 });
      const [visit] = tables[`${prefix}visites`];
      const [line] = tables[`${prefix}visite_commandes`];
      assert.equal(visit.commercial_user_id, userId);
      assert.equal(visit.total_commande, 25);
      assert.equal(line.visite_id, visit.id);
      assert.equal(line.produit_id, productId);
      assert.equal(line.quantite, 2);
      assert.equal(line.stock_client, 3);
      assert.equal(line.prix_unitaire, 12.5);
      assert.equal(line.demo_effectuee, true);
      assert.equal(line.stock_commande_info, 'ST test');
      assert.equal(await page.evaluate(() => state.visites[0].commandes[0].demo_effectuee), true);
      assert.deepEqual(errors, []);
      console.log(`PASS ${sector}: clients, tarifs, nouvelle visite, commande, demo, ST/Cmd, isolation`);
    } catch (error) {
      console.error({ sector, status: await page.locator('#statusBar').textContent(), errors });
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
