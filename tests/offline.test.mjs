import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
function environment({ redirected = false } = {}) {
  const handlers = new Map(), storage = new Map(); let online = true, network = 0;
  const caches = {
    async open(name) {
      if (!storage.has(name)) storage.set(name, new Map());
      const entries = storage.get(name);
      return { async put(request, response) { entries.set(request.url, response.clone()); }, async match(request) { return entries.get(request.url)?.clone(); } };
    },
    async keys() { return [...storage.keys()]; }, async delete(name) { return storage.delete(name); }
  };
  const self = { registration: { scope: 'https://seal.example/' }, location: { origin: 'https://seal.example' }, clients: { async claim() {} }, addEventListener(type, handler) { handlers.set(type, handler); } };
  const fetch = async request => {
    network++; if (!online) throw Error('offline');
    const name = new URL(request.url).pathname.slice(1) || 'index.html';
    const bytes = readFileSync(new URL('../dist/' + name, import.meta.url));
    const response = new Response(bytes, { status: 200, headers: { 'content-type': name.endsWith('.html') ? 'text/html' : name.endsWith('.png') ? 'image/png' : name.endsWith('.css') ? 'text/css' : 'text/javascript' } });
    Object.defineProperty(response, 'url', { value: request.url }); Object.defineProperty(response, 'redirected', { value: redirected }); return response;
  };
  vm.runInNewContext(source, { self, caches, fetch, Request, URL, Set, Error });
  async function lifecycle(type) { let promise; handlers.get(type)({ waitUntil(p) { promise = p; } }); await promise; }
  function request(url, method = 'GET') { let response; handlers.get('fetch')({ request: new Request(url, { method }), respondWith(p) { response = p; } }); return response; }
  return { lifecycle, request, storage, offline() { online = false; }, get network() { return network; } };
}
test('installed shell serves the page, worker, crypto and icons without a network', async () => {
  const env = environment(); await env.lifecycle('install'); await env.lifecycle('activate'); const requests = env.network; env.offline();
  for (const path of ['/', '/index.html', '/app.mjs', '/envelope.mjs', '/encrypt-worker.mjs', '/manifest.webmanifest', '/icons/180.png', '/icons/192.png', '/icons/512.png']) {
    const response = await env.request('https://seal.example' + path); assert.equal(response.status, 200); assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  assert.equal(env.network, requests);
});
test('cache never intercepts uploads, encrypted files or third-party requests', async () => {
  const env = environment();
  for (const [url, method] of [['https://seal.example/', 'POST'], ['https://seal.example/private.nfenc', 'GET'], ['https://elsewhere.example/', 'GET'], ['https://seal.example/?private=example', 'GET']]) assert.equal(env.request(url, method), undefined);
});
test('authentication redirects cannot be installed as the offline app', async () => {
  const env = environment({ redirected: true }); await assert.rejects(env.lifecycle('install'), /App shell unavailable/);
});
