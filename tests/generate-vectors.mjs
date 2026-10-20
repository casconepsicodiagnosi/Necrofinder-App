import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { encryptFile, CHUNK_SIZE } from '../dist/envelope.mjs';
const fixture = JSON.parse(readFileSync(process.argv[2] || 'tests/native-v1.json'));
const directory = process.argv[3] || '.web-vectors';
mkdirSync(directory, { recursive: true });
const cases = [['vuoto.txt', 0], ['Viaggio a Città — 📷.txt', 279], ['video-di-prova.bin', CHUNK_SIZE * 2 + 37]];
const vectors = [];
for (const [name, length] of cases) {
  const bytes = Buffer.alloc(length); for (let n = 0; n < length; n++) bytes[n] = n % 251;
  const input = new Blob([bytes]); Object.defineProperty(input, 'name', { value: name });
  const output = await encryptFile(input, fixture.publicCode);
  vectors.push({ name, plaintext: bytes.toString('base64'), envelope: Buffer.from(await output.arrayBuffer()).toString('base64') });
}
writeFileSync(`${directory}/vectors.json`, JSON.stringify({ recipientPrivate: fixture.recipientPrivate, vectors }));
console.log(`Generated ${vectors.length} non-secret Web Crypto fixtures, including a multi-block file.`);
