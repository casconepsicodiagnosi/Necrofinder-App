// Password-derived key never leaves this device and is never persisted.
const encoder = new TextEncoder();
const aad = encoder.encode('NecroFinder Seal local catalogue v1');
const encode = bytes => btoa(String.fromCharCode(...bytes));
const decode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealCatalogue(key, salt, catalogue) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, encoder.encode(JSON.stringify(catalogue)));
  return JSON.stringify({ version: 1, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) });
}
export async function createCatalogue(password, catalogue) {
  if (password.length < 10) throw Error('Usa una password di almeno 10 caratteri.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  return { key, salt, record: await sealCatalogue(key, salt, catalogue) };
}
export async function openCatalogue(password, record) {
  const data = JSON.parse(record);
  if (data.version !== 1) throw Error('Archivio locale non supportato.');
  const salt = decode(data.salt), iv = decode(data.iv);
  if (salt.length !== 16 || iv.length !== 12) throw Error('Archivio locale non valido.');
  const key = await deriveKey(password, salt);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, decode(data.ciphertext));
  const catalogue = JSON.parse(new TextDecoder().decode(clear));
  if (!Array.isArray(catalogue.vaults) || catalogue.vaults.length > 100 || catalogue.vaults.some(v => typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.code !== 'string' || v.name.length > 80)) throw Error('Elenco cassaforti non valido.');
  return { key, salt, catalogue };
}
