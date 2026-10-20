import { createCatalogue, openCatalogue, sealCatalogue } from './local-lock.mjs';
import { checkSupport, parseRecipient, validateFile } from './envelope.mjs';
const $ = id => document.getElementById(id);
const lockKey = 'necrofinder-seal-catalogue-v1';
let session = null, catalogue = { vaults: [], activeId: null }, lockEpoch = 0, accessBusy = false, idleTimer, externalUntil = 0;
const storageKey = 'necrofinder-seal-public-code-v1';
const state = { supported: false, recipient: null, file: null, worker: null, output: null, url: null, busy: false, saving: false, recipientName: '' };
function readStorage(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeStorage(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); return true; } catch { return false; } }
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function size(bytes) { const format = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }); return bytes < 1024 ? `${bytes} byte` : bytes < 1_048_576 ? `${format.format(bytes / 1024)} KiB` : `${format.format(bytes / 1_048_576)} MiB`; }
function dirty() { return !session || !state.recipient; }
function verified() { return state.supported && state.recipient && !dirty() && $('verified').checked; }
function clearOutput() {
  if (state.url) URL.revokeObjectURL(state.url);
  state.output = null; state.url = null;
  $('download').removeAttribute('href');
}
function clearSelection() { clearOutput(); state.file = null; $('fileInput').value = ''; }
function render() {
  renderVaults();
  const linked = Boolean(state.recipient) && !dirty();
  $('vaultName').disabled = state.busy || state.saving;
  $('code').disabled = state.busy || state.saving;
  $('saveCode').disabled = !session || !state.supported || state.busy || state.saving || !$('code').value.trim();
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
  if (!session) $('activeVaultName').textContent = '';
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
function renderVaults() {
  $('vaultList').replaceChildren();
  for (const vault of catalogue.vaults) {
    const button = document.createElement('button'); button.className = 'vault-card';
    button.setAttribute('aria-pressed', String(catalogue.activeId === vault.id));
    const title = document.createElement('strong'); title.textContent = vault.name;
    const subtitle = document.createElement('small'); subtitle.textContent = catalogue.activeId === vault.id ? 'Selezionata · destinatario dei file' : 'Tocca per selezionare';
    button.append(title, subtitle); button.disabled = state.busy || state.saving;
    button.addEventListener('click', () => selectVault(vault)); $('vaultList').append(button);
  }
  $('emptyVaults').hidden = catalogue.vaults.length > 0;
  $('activeVaultName').textContent = catalogue.vaults.find(v => v.id === catalogue.activeId)?.name || state.recipientName || 'Cassaforte di questa sessione';
}
async function persistCatalogue(next) {
  const token = lockEpoch, current = session;
  if (!current) throw Error('Sblocca prima Seal.');
  const record = await sealCatalogue(current.key, current.salt, next);
  if (token !== lockEpoch || !session) throw Error('Seal è stato bloccato.');
  if (!writeStorage(lockKey, record)) throw Error('Salvataggio non disponibile. Libera spazio sul telefono e riprova.');
  catalogue = next;
}
async function selectVault(vault) {
  if (!session || state.busy || state.saving) return;
  const token = lockEpoch; state.saving = true; render();
  try {
    const recipient = await parseRecipient(vault.code);
    await persistCatalogue({ ...catalogue, activeId: vault.id });
    if (token !== lockEpoch) return;
    clearSelection(); state.recipient = recipient; state.recipientName = vault.name; $('verified').checked = false;
    updateFingerprint(); $('linkPanel').open = false;
    message('Cassaforte selezionata. Confronta tutta l’impronta con il Mac.');
  } catch (error) { if (session) message(error.message, true); }
  finally { state.saving = false; render(); }
}
$('code').addEventListener('input', render);
$('verified').addEventListener('change', () => { if (!$('verified').checked) clearOutput(); render(); });
$('saveCode').addEventListener('click', async () => {
  if (!session || state.busy || state.saving || !state.supported) return;
  state.saving = true; const token = lockEpoch; render();
  try {
    const recipient = await parseRecipient($('code').value);
    const name = $('vaultName').value.trim();
    if (!name) throw Error('Dai un nome alla Cassaforte.');
    if (token !== lockEpoch) return;
    if ($('remember').checked) {
      const existing = catalogue.vaults.find(v => v.id === recipient.fingerprint);
      if (!existing && catalogue.vaults.length >= 100) throw Error('Puoi salvare fino a 100 cassaforti.');
      const vault = { id: recipient.fingerprint, name, code: recipient.code };
      await persistCatalogue({ vaults: [...catalogue.vaults.filter(v => v.id !== vault.id), vault], activeId: vault.id });
    }
    if (token !== lockEpoch) return;
    if (!$('remember').checked) catalogue = { ...catalogue, activeId: null };
    state.recipientName = name;
    clearSelection(); state.recipient = recipient; $('verified').checked = false;
    $('code').value = ''; $('vaultName').value = ''; updateFingerprint(); $('linkPanel').open = false;
    renderVaults();
    message('Cassaforte collegata. Confronta tutta l’impronta con il Mac prima di cifrare.');
  } catch (error) { if (session) message(error.message, true); }
  finally { state.saving = false; render(); }
});
$('forget').addEventListener('click', async () => {
  if (!session || state.busy || state.saving || !state.recipient) return;
  state.saving = true; render();
  try {
    await persistCatalogue({ vaults: catalogue.vaults.filter(v => v.id !== state.recipient.fingerprint), activeId: null });
    clearSelection(); state.recipient = null; $('verified').checked = false; updateFingerprint();
    $('linkPanel').open = catalogue.vaults.length === 0; message('Cassaforte rimossa solo da questo telefono.');
  } catch (error) { if (session) message(error.message, true); }
  finally { state.saving = false; render(); }
});
$('pickFile').addEventListener('click', () => { if (verified() && !state.busy) { externalUntil = Date.now() + 60000; $('fileInput').click(); } });
$('fileInput').addEventListener('change', () => {
  externalUntil = 0;
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
  externalUntil = Date.now() + 60000;
  try { await navigator.share({ files: [output] }); message('Pannello di condivisione completato. Verifica sul Mac di aver ricevuto il .nfenc.'); }
  catch (error) { message(error.name === 'AbortError' ? 'Condivisione chiusa. Il file cifrato è ancora pronto qui.' : 'Condivisione non disponibile. Salva il .nfenc in File e condividilo da lì.'); }
  finally { externalUntil = 0; if (document.hidden) lockApp(); }
});
$('download').addEventListener('click', () => { if (state.output) message('Salvataggio richiesto. Trova il .nfenc in File/Download e invialo al Mac.'); });
$('clearResult').addEventListener('click', () => { clearSelection(); message('File pronto rimosso da questa sessione. Le copie già salvate o inviate restano dove le hai messe.'); render(); });
function currentDark() { return document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function renderTheme() { $('theme').setAttribute('aria-label', currentDark() ? 'Attiva tema chiaro' : 'Attiva tema scuro'); document.querySelector('meta[name="theme-color"]').content = currentDark() ? '#211b27' : '#f7f2e9'; }
const savedTheme = readStorage('necrofinder-seal-theme');
if (['dark', 'light'].includes(savedTheme)) document.documentElement.dataset.theme = savedTheme;
$('theme').addEventListener('click', () => { const theme = currentDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; writeStorage('necrofinder-seal-theme', theme); renderTheme(); });
renderTheme(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderTheme);
function showLock() {
  const exists = Boolean(readStorage(lockKey));
  $('lockTitle').textContent = exists ? 'Bentornato nella tua lanterna.' : 'La tua lanterna, al sicuro.';
  $('lockDescription').textContent = exists ? 'Inserisci la password di Seal per accedere alle tue cassaforti.' : 'Scegli una password per proteggere l’accesso e le cassaforti su questo telefono.';
  $('confirmArea').hidden = exists; $('confirmPassword').required = !exists;
  $('appPassword').autocomplete = exists ? 'current-password' : 'new-password';
  $('appPassword').minLength = exists ? 1 : 10;
  $('unlockButton').textContent = exists ? 'Sblocca Seal' : 'Crea password ed entra';
  $('appShell').hidden = true; $('appShell').inert = true; $('lockScreen').hidden = false;
}
function lockApp() {
  lockEpoch++; clearTimeout(idleTimer); session = null; catalogue = { vaults: [], activeId: null };
  state.worker?.terminate(); state.worker = null; state.busy = false; clearSelection(); state.recipient = null; state.recipientName = '';
  $('verified').checked = false; $('code').value = ''; $('vaultName').value = '';
  $('appPassword').value = ''; $('confirmPassword').value = ''; $('lockMessage').textContent = '';
  updateFingerprint(); showLock(); render();
}
function touchSession() {
  if (!session) return;
  clearTimeout(idleTimer); idleTimer = setTimeout(lockApp, 5 * 60 * 1000);
}
$('lockApp').addEventListener('click', lockApp);
for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, touchSession, { passive: true });
$('fileInput').addEventListener('cancel', () => { externalUntil = 0; });
$('unlockForm').addEventListener('submit', async event => {
  event.preventDefault(); if (accessBusy) return;
  accessBusy = true; const token = lockEpoch; $('unlockButton').disabled = true; $('lockMessage').textContent = 'Apertura locale…';
  try {
    const record = readStorage(lockKey), password = $('appPassword').value;
    let opened;
    if (record) opened = await openCatalogue(password, record);
    else {
      if (password !== $('confirmPassword').value) throw Error('Le password non coincidono.');
      const initial = { vaults: [], activeId: null }, legacy = readStorage(storageKey);
      if (legacy) {
        try { const r = await parseRecipient(legacy); initial.vaults.push({ id: r.fingerprint, name: 'La mia Cassaforte Mac', code: r.code }); initial.activeId = r.fingerprint; } catch {}
      }
      opened = await createCatalogue(password, initial); opened.catalogue = initial;
      if (token !== lockEpoch) return;
      if (!writeStorage(lockKey, opened.record)) throw Error('Memoria locale non disponibile. Non è possibile impostare una password.');
      writeStorage(storageKey, null);
    }
    if (token !== lockEpoch) return;
    const active = opened.catalogue.vaults.find(v => v.id === opened.catalogue.activeId);
    const recipient = active ? await parseRecipient(active.code) : null;
    if (token !== lockEpoch) return;
    session = { key: opened.key, salt: opened.salt }; catalogue = opened.catalogue;
    state.recipient = recipient; updateFingerprint(); $('verified').checked = false;
    $('appPassword').value = ''; $('confirmPassword').value = ''; $('lockMessage').textContent = '';
    $('lockScreen').hidden = true; $('appShell').hidden = false; $('appShell').inert = false;
    $('linkPanel').open = !catalogue.vaults.length; touchSession(); render();
    message(recipient ? 'Cassaforte pronta. Confronta l’impronta prima di cifrare.' : 'Collega la prima Cassaforte per iniziare.');
  } catch (error) {
    if (token === lockEpoch) { $('lockMessage').textContent = readStorage(lockKey) ? 'Password errata oppure dati locali danneggiati.' : error.message; $('lockMessage').classList.add('error'); }
  } finally { accessBusy = false; $('unlockButton').disabled = false; }
});
document.addEventListener('visibilitychange', () => {
  $('privacyCurtain').hidden = !document.hidden;
  if (document.hidden && Date.now() >= externalUntil) lockApp();
  if (!document.hidden && externalUntil && Date.now() >= externalUntil) { externalUntil = 0; lockApp(); }
});
addEventListener('pagehide', lockApp);
addEventListener('pageshow', () => { $('privacyCurtain').hidden = !document.hidden; render(); });
showLock();
function offlineStatus(ready) { $('offlineBadge').textContent = ready ? 'Disponibile offline' : navigator.onLine ? 'Prima apertura online' : 'Connessione assente'; }
offlineStatus(false);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => offlineStatus(true)).catch(() => { $('offlineBadge').textContent = 'Usabile online'; });
} else $('offlineBadge').textContent = 'Usabile online';
async function init() {
  render();
  try {
    await checkSupport(); state.supported = true; $('browserText').textContent = 'Cifratura locale pronta';
  } catch (error) { $('compatibility').hidden = false; $('compatibility').textContent = error.message; $('browserText').textContent = 'Browser da aggiornare'; message('Aggiorna Safari/iOS prima di scegliere un file.', true); }
  render();
}
init();
