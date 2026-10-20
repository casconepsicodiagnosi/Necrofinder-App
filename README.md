# NecroFinder Seal · DWARF

Web app per iPhone, con cifratura locale e contenitori NFENC001 compatibili con la Cassaforte NecroFinder Mac 0.5/0.6. Nessun account Apple Developer, build iOS o installazione da App Store richiesta.

## Uso

Aprire il sito in Safari su iOS 18.4 o successivo. Sul Mac, sbloccare la Cassaforte e copiare il codice pubblico NF1. Incollarlo in Seal, salvarlo e confrontare **tutta** l’impronta SHA-256 sui due dispositivi. Scegliere un file già sul telefono, premere Cifra, poi condividere il .nfenc con AirDrop oppure salvarlo in File e condividerlo da lì. Sul Mac scegliere Importa file cifrati nella Cassaforte.

La condivisione di estensioni personalizzate dipende da Safari/iOS: viene controllata con canShare. Il salvataggio in File resta disponibile. Seal non può verificare il trasferimento di AirDrop e non cancella gli originali.

## Schermata Home e offline

Safari → Condividi → Aggiungi alla schermata Home. Aprire dall’icona online una prima volta e attendere Disponibile offline. Il service worker conserva solo la pagina, i moduli e le icone. Il browser può eliminare la cache; in quel caso serve riaprire online. Un’eventuale autenticazione del sito avviene al caricamento, non durante la cifratura.

## Limiti e conservazione

- 100 MiB per file. L’output cifrato resta in memoria: non è un motore per video di decine di GiB.
- Durante la cifratura mantenere la pagina aperta e lo schermo acceso. Passando in secondo piano la cifratura viene interrotta.
- Il risultato non è persistito nel browser: salvarlo o condividerlo prima di chiudere.
- Si conserva soltanto il codice pubblico se Ricorda questo Mac è attivo e la preferenza del tema. Nessuna password o chiave privata della Cassaforte viene richiesta o memorizzata.
- Il selettore di file di iOS può scaricare un elemento cloud se l’utente lo sceglie. Per un flusso già locale usare Sul mio iPhone.
- Non ci sono analytics, dipendenze di terzi, chiamate API o caricamenti di file. La CSP vieta connessioni dal codice della pagina; il service worker scarica solo risorse statiche dello stesso sito.

## Formato e verifiche

Web Crypto X25519, HKDF-SHA-256 e AES-256-GCM. Header NFENC001 di 112 byte, metadati autenticati, blocchi da 1 MiB; nonce, AAD e struttura corrispondono a Sources/NecroVault/Envelope.swift del progetto Mac. La chiave effimera privata è generata non esportabile e non viene salvata. Nessun algoritmo crittografico implementato a mano.

Eseguire `node --test tests/*.test.mjs`. I test usano decrittazione indipendente OpenSSL, vettori nativi/Python, nomi Unicode, file vuoti e multiblocco, annullamento, limiti, chiavi non valide e manomissione. Il service worker viene verificato con rete simulata assente e risposte di autenticazione rifiutate. `node tests/generate-vectors.mjs` genera solo dati di test non segreti per la verifica Python/Swift sul Mac.

Il repository desktop verifica anche che il modulo Web Crypto, eseguito sotto Node, produca file decifrabili dal codice Swift e che la manomissione non pubblichi plaintext. Questi controlli non sostituiscono una prova su un iPhone reale o un audit indipendente del protocollo. Provare prima con file sacrificabili e conservare gli originali.

## Distribuzione

Pubblicare `dist/` su un’origine HTTPS dedicata. Il sito ha un manifest installabile e un service worker con scope relativo. All’aggiornamento modificare la versione della cache in `dist/sw.js` insieme alle risorse e verificare nuovamente l’interoperabilità se cambia `dist/envelope.mjs`. Nessuna chiave, password o file personale deve entrare in questo repository. Il file tests/native-v1.json contiene soltanto una chiave e una password di prova dichiaratamente non segrete.

## Password locale e cassaforti nominate

Seal richiede una password locale di almeno 10 caratteri, distinta dalla password Mac. Nomi, codici pubblici e selezione sono cifrati in localStorage con AES-256-GCM, una chiave non esportabile derivata con PBKDF2-SHA256 (600.000 iterazioni, salt casuale da 16 byte), nonce casuali e autenticazione del formato. La chiave resta solo in memoria durante la sessione. Il vecchio codice pubblico salvato viene migrato e rimosso dopo il primo salvataggio cifrato riuscito.

Si possono nominare e selezionare più cassaforti. Il pannello di collegamento si richiude dopo il salvataggio; la conferma dell’intera impronta è richiesta di nuovo a ogni selezione o sblocco. Blocca chiude la sessione; l’app si blocca quando passa in secondo piano e dopo cinque minuti senza interazioni. I pannelli di sistema File/Condivisione hanno una breve eccezione per non interrompere il trasferimento. Il blocco elimina file e risultato dalla memoria dell’app, senza eliminare gli originali o le copie esportate.

La password non viene inviata al server e non esiste recupero della password. Cancellare i dati del sito elimina l’elenco locale e richiede nuova configurazione, senza alterare le cassaforti sul Mac. Questo protegge i dati persistenti a riposo, non un dispositivo compromesso o una sessione già sbloccata. La password non costituisce un’autenticazione server.
