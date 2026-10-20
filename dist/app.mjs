import { checkSupport, parseRecipient, validateFile } from './envelope.mjs';
const $ = id => document.getElementById(id);
const storageKey = 'necrofinder-seal-public-code-v1';
const state = { supported: false, recipient: null, file: null, worker: null, output: null, url: null, busy: false, saving: false };
function readStorage(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeStorage(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); return true; } catch { return false; } }
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function size(bytes) { const format = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }); return bytes < 1024 ? `${bytes} byte` : bytes < 1_048_576 ? `${format.format(bytes / 1024)} KiB` : `${format.format(bytes / 1_048_576)} MiB`; }
function dirty() { return !state.recipient || $('code').value.replace(/\s/g, '') !== state.recipient.code; }
function verified() { return state.supported && state.recipient && !dirty() && $('verified').checked; }
function clearOutput() {
  if (state.url) URL.revokeObjectURL(state.url);
  state.output = null; state.url = null;
  $('download').removeAttribute('href');
}
function clearSelection() { clearOutput(); state.file = null; $('fileInput').value = ''; }
function render() {
  const linked = Boolean(state.recipient) && !dirty();
  $('code').disabled = state.busy || state.saving;
  $('saveCode').disabled = !state.supported || state.busy || state.saving || !$('code').value.trim();
  $('remember').disabled = state.busy || state.saving;
  $('forget').disabled = state.busy || state.saving;
  $('fingerprintArea').hidden = !state.recipient;
  $('recipientCheck').hidden = !linked;
  $('verified').disabled = !linked || state.busy || !state.supported;
  $('fileInput').disabled = !verified() || state.busy;
  $('pickFile').disabled = !verified() || state.busy;
  $('encrypt').disabled = !verified() || !state.file || state.busy;
  $('encrypt').textContent = state.busy ? 'Cifratura in corso…' : 'Cifra per il mio Mac';
  $('fileName').textContent = state.file?.name || 'Scegli un file';
  $('fileSize').textContent = state.file ? `${size(state.file.size)} · originale conservato` : 'Da File o dalla libreria Foto · fino a 100 MiB';
  $('selectionHint').textContent = !linked ? 'Salva il codice del Mac per continuare.' : !verified() ? 'Confronta tutta l’impronta con il Mac e conferma.' : state.file ? 'La cifratura inizierà solo premendo il pulsante qui sotto.' : 'Scegli un file già disponibile sul telefono.';
  $('progressArea').hidden = !state.busy;
  $('readyArea').hidden = !state.output;
  if (state.output) {
    $('resultSize').textContent = `${size(state.output.size)} · formato .nfenc`;
    const canShare = Boolean(navigator.share && navigator.canShare?.({ files: [state.output] }));
    $('share').hidden = !canShare;
    $('shareHint').textContent = canShare ? 'Nel pannello di iOS scegli AirDrop e il tuo Mac.' : 'Safari non offre la condivisione diretta di questo tipo di file. Salvalo e condividilo dall’app File.';
  }
}
function cancelWork(text = 'Cifratura annullata. L’originale è intatto.') {
  state.worker?.terminate(); state.worker = null; state.busy = false; clearOutput();
  message(text); render();
}
function updateFingerprint() { $('fingerprint').textContent = state.recipient?.fingerprint.match(/.{1,8}/g).join(' ') || ''; }
function rememberRecipient() {
  if (!state.recipient) return true;
  return writeStorage(storageKey, $('remember').checked ? state.recipient.code : null);
}
$('code').addEventListener('input', () => { $('verified').checked = false; clearSelection(); render(); });
$('verified').addEventListener('change', () => { if (!$('verified').checked) clearOutput(); render(); });
$('remember').addEventListener('change', () => { if (!rememberRecipient()) message('La memoria del browser non è disponibile. Il codice resta valido in questa sessione.'); });
$('saveCode').addEventListener('click', async () => {
  if (state.busy || state.saving || !state.supported) return;
  state.saving = true; render();
  try {
    const recipient = await parseRecipient($('code').value);
    clearSelection(); state.recipient = recipient; $('code').value = recipient.code; $('verified').checked = false; updateFingerprint();
    const saved = rememberRecipient();
    message(saved ? 'Codice pubblico valido. Confronta tutta l’impronta con il Mac prima di continuare.' : 'Codice valido per questa sessione. La memoria del browser non è disponibile: confronta l’impronta con il Mac.');
  } catch (error) { message(error.message, true); }
  finally { state.saving = false; render(); }
});
$('forget').addEventListener('click', () => {
  if (state.busy) return;
  clearSelection(); state.recipient = null; $('code').value = ''; $('verified').checked = false; writeStorage(storageKey, null); updateFingerprint();
  message('Mac scollegato. Puoi collegare una Cassaforte copiando il suo codice pubblico.'); render();
});
$('pickFile').addEventListener('click', () => { if (verified() && !state.busy) $('fileInput').click(); });
$('fileInput').addEventListener('change', () => {
  if (!verified() || state.busy) return;
  const file = $('fileInput').files?.[0];
  if (!file) return;
  clearOutput();
  try { validateFile(file); state.file = file; message('File scelto. Premi «Cifra per il mio Mac» per creare il contenitore protetto.'); }
  catch (error) { state.file = null; $('fileInput').value = ''; message(error.message, true); }
  render();
});
$('encrypt').addEventListener('click', () => {
  if (!verified() || !state.file || state.busy) return;
  clearOutput(); state.busy = true; $('progress').value = 0; $('progressLabel').textContent = 'Preparazione della cifratura…';
  message('Cifratura locale in corso. Mantieni questa pagina aperta e lo schermo acceso.'); render();
  try {
    const worker = new Worker(new URL('./encrypt-worker.mjs', import.meta.url), { type: 'module' });
    state.worker = worker;
    worker.onmessage = ({ data }) => {
      if (state.worker !== worker) return;
      if (data.type === 'progress') {
        const fraction = data.total ? data.completed / data.total : 0;
        $('progress').value = fraction;
        $('progressLabel').textContent = `Cifratura · ${Math.round(fraction * 100)}%`;
      } else if (data.type === 'ready') {
        worker.terminate(); state.worker = null; state.busy = false;
        try {
          state.output = new File([data.blob], `NecroFinder-${crypto.randomUUID()}.nfenc`, { type: 'application/octet-stream' });
          state.url = URL.createObjectURL(state.output); $('download').href = state.url; $('download').download = state.output.name;
          message('Cifratura completata. Salva o condividi solo il .nfenc, poi importalo nella Cassaforte Mac.'); render();
          $('readyArea').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
        } catch { clearOutput(); message('Non c’è memoria sufficiente per preparare il file. Riprova con un file più piccolo.', true); render(); }
      } else if (data.type === 'error') { worker.terminate(); state.worker = null; state.busy = false; clearOutput(); message(data.message, true); render(); }
    };
    worker.onerror = () => { if (state.worker === worker) cancelWork('Il browser ha interrotto la cifratura. Riprova con un file più piccolo, mantenendo Seal aperto.'); };
    worker.postMessage({ file: state.file, code: state.recipient.code });
  } catch { cancelWork('Impossibile avviare la cifratura. Riapri questa pagina in Safari aggiornato.'); }
});
$('cancel').addEventListener('click', () => cancelWork());
$('share').addEventListener('click', async () => {
  if (!state.output || state.busy) return;
  const output = state.output;
  if (!navigator.canShare?.({ files: [output] })) { message('Salva il .nfenc in File, poi condividilo da lì.'); return; }
  try { await navigator.share({ files: [output] }); message('Pannello di condivisione completato. Verifica sul Mac di aver ricevuto il .nfenc.'); }
  catch (error) { message(error.name === 'AbortError' ? 'Condivisione chiusa. Il file cifrato è ancora pronto qui.' : 'Condivisione non disponibile. Salva il .nfenc in File e condividilo da lì.'); }
});
$('download').addEventListener('click', () => { if (state.output) message('Salvataggio richiesto. Trova il .nfenc in File/Download e invialo al Mac.'); });
$('clearResult').addEventListener('click', () => { clearSelection(); message('File pronto rimosso da questa sessione. Le copie già salvate o inviate restano dove le hai messe.'); render(); });
function currentDark() { return document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function renderTheme() { $('theme').setAttribute('aria-label', currentDark() ? 'Attiva tema chiaro' : 'Attiva tema scuro'); document.querySelector('meta[name="theme-color"]').content = currentDark() ? '#211b27' : '#f7f2e9'; }
const savedTheme = readStorage('necrofinder-seal-theme');
if (['dark', 'light'].includes(savedTheme)) document.documentElement.dataset.theme = savedTheme;
$('theme').addEventListener('click', () => { const theme = currentDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; writeStorage('necrofinder-seal-theme', theme); renderTheme(); });
renderTheme(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderTheme);
document.addEventListener('visibilitychange', () => {
  $('privacyCurtain').hidden = !document.hidden;
  if (document.hidden) {
    // A system file picker or share sheet may temporarily hide the page.
    // Invalidate the confirmation only when interrupting active encryption.
    if (state.busy) { $('verified').checked = false; cancelWork('Cifratura interrotta perché Seal è passato in secondo piano. Riconferma l’impronta e riprova mantenendo la pagina aperta.'); }
    render();
  }
});
addEventListener('pagehide', () => { state.worker?.terminate(); state.worker = null; state.busy = false; clearSelection(); $('verified').checked = false; render(); });
addEventListener('pageshow', () => { $('privacyCurtain').hidden = !document.hidden; render(); });
function offlineStatus(ready) { $('offlineBadge').textContent = ready ? 'Disponibile offline' : navigator.onLine ? 'Prima apertura online' : 'Connessione assente'; }
offlineStatus(false);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => offlineStatus(true)).catch(() => { $('offlineBadge').textContent = 'Usabile online'; });
} else $('offlineBadge').textContent = 'Usabile online';
async function init() {
  render();
  try {
    await checkSupport(); state.supported = true; $('browserText').textContent = 'Cifratura locale pronta';
    const code = readStorage(storageKey);
    if (code) {
      try { state.recipient = await parseRecipient(code); $('code').value = state.recipient.code; updateFingerprint(); message('Mac ricordato. Confronta di nuovo l’impronta con la Cassaforte prima di cifrare.'); }
      catch { writeStorage(storageKey, null); message('Il codice ricordato non è valido: copialo di nuovo dalla Cassaforte Mac.'); }
    }
  } catch (error) { $('compatibility').hidden = false; $('compatibility').textContent = error.message; $('browserText').textContent = 'Browser da aggiornare'; message('Aggiorna Safari/iOS prima di scegliere un file.', true); }
  render();
}
init();
