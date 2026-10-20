// NFENC001: byte-for-byte framing shared with NecroFinder's Swift Envelope.
// Only platform Web Crypto; no server, password or persistent private key.
export const CHUNK_SIZE = 1_048_576;
export const MAX_FILE_SIZE = 100 * 1_048_576;
const encoder = new TextEncoder();
export function concat(...parts) {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const part of parts) { const bytes = new Uint8Array(part.buffer ?? part, part.byteOffset ?? 0, part.byteLength); result.set(bytes, offset); offset += bytes.length; }
  return result;
}
export function u32(value) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value, false); return b; }
function requireCrypto() {
  if (!globalThis.crypto?.subtle) throw Error('Apri Seal in Safari aggiornato tramite il suo indirizzo HTTPS.');
  return globalThis.crypto;
}
function hex(data) { return [...new Uint8Array(data)].map(n => n.toString(16).padStart(2, '0')).join(''); }
function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
export async function parseRecipient(input) {
  const c = requireCrypto();
  if (typeof input !== 'string' || input.length > 2048) throw Error('Incolla il codice pubblico NF1 dalla Cassaforte Mac.');
  const code = input.replace(/\s/g, '');
  const match = /^NF1\.([A-Za-z0-9_-]{43})\.([0-9a-fA-F]{8})$/.exec(code);
  if (!match) throw Error('Codice pubblico non valido. Copialo dalla Cassaforte Mac; qui non serve una password.');
  const bytes = Uint8Array.from(atob(match[1].replaceAll('-', '+').replaceAll('_', '/') + '='), x => x.charCodeAt(0));
  if (bytes.length !== 32 || base64url(bytes) !== match[1]) throw Error('Codice pubblico non valido.');
  const fingerprint = hex(await c.subtle.digest('SHA-256', bytes));
  if (fingerprint.slice(0, 8) !== match[2].toLowerCase()) throw Error('Il codice è incompleto o contiene un errore di trascrizione.');
  return { code: `NF1.${match[1]}.${fingerprint.slice(0, 8)}`, bytes, fingerprint };
}
export async function checkSupport() {
  const c = requireCrypto();
  try {
    const pair = await c.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    const shared = await c.subtle.deriveBits({ name: 'X25519', public: pair.publicKey }, pair.privateKey, 256);
    const base = await c.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const key = await c.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new Uint8Array() }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    await c.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12), tagLength: 128 }, key, new Uint8Array());
    return true;
  } catch { throw Error('Questo browser non offre la cifratura richiesta. Su iPhone usa Safari con iOS 18.4 o successivo.'); }
}
export function validateFile(file) {
  if (!file || typeof file.slice !== 'function' || !Number.isSafeInteger(file.size) || file.size < 0) throw Error('Scegli un file dal telefono.');
  if (file.size > MAX_FILE_SIZE) throw Error('Questo file supera 100 MiB. Per questa versione web scegli un file più piccolo.');
  const name = file.name;
  if (typeof name !== 'string' || !name || encoder.encode(name).length > 1024 || name.includes('/') || name.includes('\0') || name === '.' || name === '..') throw Error('Il nome di questo file non è supportato.');
}
function checkCancelled(signal) { if (signal?.aborted) throw new DOMException('Cifratura annullata.', 'AbortError'); }
export async function encryptFile(file, publicCode, { signal, onProgress = () => {} } = {}) {
  validateFile(file); checkCancelled(signal);
  const c = requireCrypto(), recipient = await parseRecipient(publicCode);
  checkCancelled(signal);
  const remote = await c.subtle.importKey('raw', recipient.bytes, { name: 'X25519' }, false, []);
  const ephemeral = await c.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
  const ephemeralPublic = new Uint8Array(await c.subtle.exportKey('raw', ephemeral.publicKey));
  const shared = await c.subtle.deriveBits({ name: 'X25519', public: remote }, ephemeral.privateKey, 256);
  const salt = c.getRandomValues(new Uint8Array(32)), prefix = c.getRandomValues(new Uint8Array(8));
  const base = await c.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await c.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: concat(encoder.encode('NecroFinder/envelope/v1'), recipient.bytes, ephemeralPublic) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  new Uint8Array(shared).fill(0);
  const header = concat(encoder.encode('NFENC001'), recipient.bytes, ephemeralPublic, salt, prefix);
  const chunks = Math.ceil(file.size / CHUNK_SIZE);
  const metadata = encoder.encode(JSON.stringify({ name: file.name, bytes: file.size, chunkSize: CHUNK_SIZE, chunks }));
  if (metadata.byteLength + 16 > 4096) throw Error('Il nome del file è troppo lungo per il formato. Rinominalo e riprova.');
  async function seal(bytes, index) {
    checkCancelled(signal);
    return c.subtle.encrypt({ name: 'AES-GCM', iv: concat(prefix, u32(index)), additionalData: concat(header, u32(index)), tagLength: 128 }, key, bytes);
  }
  const sealedMetadata = await seal(metadata, 0);
  const parts = [header, u32(sealedMetadata.byteLength), sealedMetadata];
  onProgress({ completed: 0, total: file.size });
  for (let index = 0; index < chunks; index++) {
    checkCancelled(signal);
    const start = index * CHUNK_SIZE, end = Math.min(start + CHUNK_SIZE, file.size);
    const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
    try {
      if (bytes.byteLength !== end - start) throw Error('Il file non è stato letto per intero. Scaricalo prima sul telefono e riprova.');
      parts.push(await seal(bytes, index + 1));
    } finally { bytes.fill(0); }
    onProgress({ completed: end, total: file.size });
  }
  checkCancelled(signal);
  return new Blob(parts, { type: 'application/octet-stream' });
}
