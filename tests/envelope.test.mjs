import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, diffieHellman, hkdfSync, createDecipheriv, createHash } from 'node:crypto';
import { parseRecipient, checkSupport, encryptFile, MAX_FILE_SIZE, CHUNK_SIZE } from '../dist/envelope.mjs';
const fixture = JSON.parse(readFileSync(new URL('./native-v1.json', import.meta.url)));
function file(data, name = 'documento-di-prova.txt') { const blob = new Blob([data]); Object.defineProperty(blob, 'name', { value: name }); return blob; }
// Independent OpenSSL decryption path: no imports from the encryption implementation.
function decrypt(bytes, rawPrivate = Buffer.from(fixture.recipientPrivate, 'base64')) {
  const buffer = Buffer.from(bytes);
  assert.equal(buffer.subarray(0, 8).toString(), 'NFENC001');
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), rawPrivate]), format: 'der', type: 'pkcs8' });
  const ephemeral = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), buffer.subarray(40, 72)]), format: 'der', type: 'spki' });
  const shared = diffieHellman({ privateKey, publicKey: ephemeral });
  const key = Buffer.from(hkdfSync('sha256', shared, buffer.subarray(72, 104), Buffer.concat([Buffer.from('NecroFinder/envelope/v1'), buffer.subarray(8, 72)]), 32));
  function open(sealed, index) {
    const counter = Buffer.alloc(4); counter.writeUInt32BE(index);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.concat([buffer.subarray(104, 112), counter]));
    decipher.setAAD(Buffer.concat([buffer.subarray(0, 112), counter])); decipher.setAuthTag(sealed.subarray(-16));
    return Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
  }
  const metadataLength = buffer.readUInt32BE(112);
  const metadata = JSON.parse(open(buffer.subarray(116, 116 + metadataLength), 0));
  assert.equal(metadata.chunkSize, 1048576);
  assert.equal(metadata.chunks, Math.ceil(metadata.bytes / 1048576));
  let offset = 116 + metadataLength; const pieces = [];
  for (let n = 0; n < metadata.chunks; n++) { const length = Math.min(1048576, metadata.bytes - n * 1048576) + 16; pieces.push(open(buffer.subarray(offset, offset + length), n + 1)); offset += length; }
  assert.equal(offset, buffer.length);
  return { metadata, plaintext: Buffer.concat(pieces) };
}
test('browser primitives support the real X25519/HKDF/AES-GCM path', async () => { assert.equal(await checkSupport(), true); });
test('native public code, whitespace, checksum and full fingerprint', async () => {
  const result = await parseRecipient(' \n' + fixture.publicCode + '\n');
  assert.equal(result.code, fixture.publicCode); assert.equal(result.bytes.length, 32);
  assert.equal(result.fingerprint, createHash('sha256').update(result.bytes).digest('hex'));
});
test('malformed and corrupted recipient codes are rejected', async () => {
  for (const code of ['', 'password-personale', fixture.publicCode + 'x', fixture.publicCode.replace('NF1.', 'NF2.'), fixture.publicCode.slice(0, -1) + '0', 'x'.repeat(2049)]) await assert.rejects(parseRecipient(code));
});
test('independent decryption agrees with the native/Python fixture', () => {
  const result = decrypt(Buffer.from(fixture.envelope, 'base64'));
  assert.deepEqual(result.plaintext, Buffer.from(fixture.plaintext, 'base64')); assert.equal(result.metadata.name, 'prova-cifrata.bin');
});
test('empty and Unicode-named browser files produce native-compatible envelopes', async () => {
  for (const [bytes, name] of [[Buffer.alloc(0), 'vuoto.txt'], [Buffer.from('Caffè e ricordi 📷'), 'Viaggio a Città — 📷.txt']]) {
    const blob = await encryptFile(file(bytes, name), fixture.publicCode); const result = decrypt(await blob.arrayBuffer());
    assert.equal(result.metadata.name, name); assert.deepEqual(result.plaintext, bytes);
  }
});
test('chunk boundaries, multi-block data and progress preserve every byte', async () => {
  for (const length of [1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, CHUNK_SIZE * 2 + 37]) {
    const bytes = Buffer.alloc(length); for (let i = 0; i < length; i++) bytes[i] = i % 251;
    const progress = []; const blob = await encryptFile(file(bytes), fixture.publicCode, { onProgress: p => progress.push(p.completed) });
    const result = decrypt(await blob.arrayBuffer()); assert.deepEqual(result.plaintext, bytes); assert.equal(result.metadata.chunks, Math.ceil(length / CHUNK_SIZE));
    assert.equal(progress.at(-1), length); assert.ok(progress.every((n, i) => i === 0 || n >= progress[i - 1]));
  }
});
test('every encryption uses fresh ephemeral keys, salts and nonces', async () => {
  const input = file('un nome originale non viene pubblicato', 'nome-originale-riservato.txt');
  const a = Buffer.from(await (await encryptFile(input, fixture.publicCode)).arrayBuffer()); const b = Buffer.from(await (await encryptFile(input, fixture.publicCode)).arrayBuffer());
  assert.notDeepEqual(a.subarray(40, 72), b.subarray(40, 72)); assert.notDeepEqual(a.subarray(72, 104), b.subarray(72, 104)); assert.notDeepEqual(a.subarray(104, 112), b.subarray(104, 112));
  assert.equal(a.includes(Buffer.from(input.name)), false);
});
test('oversize and invalid file names are rejected before reading', async () => {
  let read = false;
  await assert.rejects(encryptFile({ name: 'troppo-grande.bin', size: MAX_FILE_SIZE + 1, slice() { read = true; } }, fixture.publicCode), /100 MiB/); assert.equal(read, false);
  for (const name of ['../fuori', '.', '..', 'a\0b', 'a'.repeat(1025)]) await assert.rejects(encryptFile(file('x', name), fixture.publicCode));
});
test('cancellation before and during encryption never returns a partial file', async () => {
  const initial = new AbortController(); initial.abort(); await assert.rejects(encryptFile(file('x'), fixture.publicCode, { signal: initial.signal }), { name: 'AbortError' });
  const active = new AbortController(); await assert.rejects(encryptFile(file(Buffer.alloc(CHUNK_SIZE * 2)), fixture.publicCode, { signal: active.signal, onProgress: p => { if (p.completed >= CHUNK_SIZE) active.abort(); } }), { name: 'AbortError' });
});
test('low-order recipient public key is rejected by platform key agreement', async () => {
  const raw = Buffer.alloc(32), checksum = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  await assert.rejects(encryptFile(file('test'), `NF1.${raw.toString('base64url')}.${checksum}`));
});
test('metadata length is bounded to the native parser limit', async () => {
  await assert.rejects(encryptFile(file('x', '\u0001'.repeat(700)), fixture.publicCode), /nome del file/);
});
test('tampered ciphertext and the wrong private key cannot recover browser plaintext', async () => {
  const bytes = Buffer.from(await (await encryptFile(file('contenuto di prova'), fixture.publicCode)).arrayBuffer());
  const tampered = Buffer.from(bytes); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decrypt(tampered)); assert.throws(() => decrypt(bytes, Buffer.alloc(32, 7)));
});
