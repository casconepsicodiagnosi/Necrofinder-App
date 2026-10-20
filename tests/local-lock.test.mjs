import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogue, openCatalogue, sealCatalogue } from '../dist/local-lock.mjs';
const password = 'una-lanterna-molto-lunga';
const catalogue = { vaults: [{ id: 'id', name: 'Archivio personale', code: 'NF1.codice-pubblico' }], activeId: 'id' };
test('password encrypts names and codes; fresh IVs and authenticated tampering rejection', async () => {
  const created = await createCatalogue(password, catalogue);
  assert.equal(created.key.extractable, false);
  assert.ok(!created.record.includes('Archivio personale')); assert.ok(!created.record.includes('NF1.codice'));
  assert.deepEqual((await openCatalogue(password, created.record)).catalogue, catalogue);
  await assert.rejects(openCatalogue('password-sbagliata', created.record));
  const other = await sealCatalogue(created.key, created.salt, catalogue); assert.notEqual(other, created.record);
  const modified = JSON.parse(created.record); const bytes = Buffer.from(modified.ciphertext, 'base64'); bytes[0] ^= 1; modified.ciphertext = bytes.toString('base64');
  await assert.rejects(openCatalogue(password, JSON.stringify(modified)));
  await assert.rejects(createCatalogue('breve', catalogue));
});
