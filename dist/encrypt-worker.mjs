import { encryptFile } from './envelope.mjs';
self.onmessage = async ({ data }) => {
  try {
    const blob = await encryptFile(data.file, data.code, { onProgress: progress => self.postMessage({ type: 'progress', ...progress }) });
    self.postMessage({ type: 'ready', blob });
  } catch (error) { self.postMessage({ type: 'error', message: error?.message || 'Cifratura non completata. Riprova con un file già sul telefono.' }); }
};
