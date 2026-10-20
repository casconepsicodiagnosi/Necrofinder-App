import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCatalogue, openCatalogue, sealCatalogue } from '../dist/local-lock.mjs';
import { parseRecipient } from '../dist/envelope.mjs';
const fixture = JSON.parse(readFileSync(new URL('native-v1.json', import.meta.url)));
function app() {
  const elements = new Map(), data = new Map(), events = new Map();
  function element() { return { value: '', checked: true, hidden: false, disabled: false, open: true, handlers: {}, children: [], classList: { toggle() {}, add() {} }, addEventListener(type, fn) { this.handlers[type] = fn; }, setAttribute(k,v) { this[k] = v; }, removeAttribute() {}, replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); } }; }
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const document = { hidden: false, getElementById: $, createElement: element, documentElement: { dataset: {} }, querySelector: () => ({}), addEventListener(k,v) { events.set(k,v); } };
  const source = readFileSync(new URL('../dist/app.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', "'https://example.com/app.mjs'").replace(/init\(\);\s*$/, '');
  const context = vm.createContext({ document, localStorage: { getItem: k => data.get(k) || null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }, createCatalogue, openCatalogue, sealCatalogue, parseRecipient, checkSupport: async () => true, validateFile() {}, navigator: { onLine: true }, crypto, URL, Intl, Date, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener(k,v) { events.set(k,v); }, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(source, context);
  const run = text => vm.runInContext(text, context);
  return { $, data, events, document, run, click: id => $(id).handlers.click(), unlock: async password => { $('appPassword').value = password; $('confirmPassword').value = password; await $('unlockForm').handlers.submit({ preventDefault() {} }); } };
}
test('app locks, migrates old code encrypted, remembers multiple named vaults and collapses linking', async () => {
  const a = app(), key = 'necrofinder-seal-catalogue-v1';
  a.data.set('necrofinder-seal-public-code-v1', fixture.publicCode);
  assert.equal(a.$('appShell').hidden, true);
  await a.unlock('lanterna-di-simone'); assert.equal(a.$('appShell').hidden, false);
  assert.equal(a.data.has('necrofinder-seal-public-code-v1'), false); assert.equal(a.$('vaultList').children.length, 1);
  a.run('state.supported = true');
  const raw = Buffer.alloc(32, 12); const code = `NF1.${raw.toString('base64url')}.${createHash('sha256').update(raw).digest('hex').slice(0,8)}`;
  a.$('code').value = code; a.$('vaultName').value = 'Secondo Mac'; await a.click('saveCode');
  assert.equal(a.$('linkPanel').open, false); assert.equal(a.$('vaultList').children.length, 2);
  assert.equal(a.$('verified').checked, false); assert.equal(a.data.get(key).includes('Secondo Mac'), false);
  await a.run('selectVault(catalogue.vaults[0])');
  assert.equal(a.$('verified').checked, false);
  assert.equal(a.run('state.recipient.code'), fixture.publicCode);
  assert.equal(a.$('activeVaultName').textContent, 'La mia Cassaforte Mac');
  await a.click('forget'); assert.equal(a.$('vaultList').children.length, 1);
  a.document.hidden = true; a.events.get('visibilitychange')();
  assert.equal(a.$('appShell').hidden, true); assert.equal(a.$('vaultList').children.length, 0);
  assert.equal(a.$('code').value, ''); assert.equal(a.run('session'), null);
  a.document.hidden = false; a.events.get('visibilitychange')();
  await a.unlock('password-sbagliata'); assert.equal(a.$('appShell').hidden, true);
  await a.unlock('lanterna-di-simone'); assert.equal(a.$('appShell').hidden, false); assert.equal(a.$('vaultList').children.length, 1);
});
