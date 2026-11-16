// M0 — CASSAFORTE: archivio locale cifrato con PIN.
// Tutto resta su questo dispositivo (IndexedDB). Ogni mappa è cifrata con AES-GCM;
// la chiave nasce dal PIN (PBKDF2) e vive solo in memoria finché l'app è sbloccata.

const DB_NOME = 'lavagna-patrimoniale';
const DB_VERSIONE = 1;
const ITERAZIONI = 600000;
const FORMATO_BACKUP = 'lavagna-patrimoniale-backup';
export const PIN_MINIMO = 6;

const codifica = new TextEncoder();
const decodifica = new TextDecoder();

let db = null;
let chiave = null; // CryptoKey, mai salvata su disco

function attesa(richiesta) {
  return new Promise((ok, ko) => {
    richiesta.onsuccess = () => ok(richiesta.result);
    richiesta.onerror = () => ko(richiesta.error);
  });
}

function fineTransazione(tx) {
  return new Promise((ok, ko) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => ko(tx.error);
    tx.onabort = () => ko(tx.error || new Error('Transazione annullata'));
  });
}

async function apri() {
  if (db) return db;
  const richiesta = indexedDB.open(DB_NOME, DB_VERSIONE);
  richiesta.onupgradeneeded = () => {
    const d = richiesta.result;
    if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    if (!d.objectStoreNames.contains('mappe')) d.createObjectStore('mappe', { keyPath: 'id' });
  };
  db = await attesa(richiesta);
  return db;
}

async function derivaChiave(pin, sale, iterazioni) {
  const base = await crypto.subtle.importKey('raw', codifica.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sale, iterations: iterazioni, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function cifra(k, oggetto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, codifica.encode(JSON.stringify(oggetto)));
  return { iv, ct: new Uint8Array(ct) };
}

async function decifra(k, busta) {
  const chiaro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: busta.iv }, k, busta.ct);
  return JSON.parse(decodifica.decode(chiaro));
}

function richiedeSblocco() {
  if (!chiave) throw new Error('Archivio bloccato');
}

// ---------- stato ----------

export async function esisteCassaforte() {
  await apri();
  const meta = await attesa(db.transaction('meta').objectStore('meta').get('cassaforte'));
  return !!meta;
}

export function sbloccata() {
  return !!chiave;
}

export function blocca() {
  chiave = null;
}

export async function creaCassaforte(pin) {
  if (typeof pin !== 'string' || pin.length < PIN_MINIMO) throw new Error('PIN troppo corto');
  await apri();
  if (await esisteCassaforte()) throw new Error('Archivio già esistente');
  const sale = crypto.getRandomValues(new Uint8Array(16));
  const k = await derivaChiave(pin, sale, ITERAZIONI);
  const verifica = await cifra(k, { ok: FORMATO_BACKUP });
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ sale, iterazioni: ITERAZIONI, verifica }, 'cassaforte');
  await fineTransazione(tx);
  chiave = k;
  // Chiede al browser di non cancellare l'archivio quando lo spazio scarseggia.
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* facoltativo */ }
}

export async function sblocca(pin) {
  await apri();
  const meta = await attesa(db.transaction('meta').objectStore('meta').get('cassaforte'));
  if (!meta) throw new Error('Nessun archivio');
  const k = await derivaChiave(pin, meta.sale, meta.iterazioni);
  try {
    await decifra(k, meta.verifica);
  } catch (e) {
    return false; // PIN errato
  }
  chiave = k;
  return true;
}

// ---------- mappe ----------

export function nuovoId() {
  return crypto.randomUUID();
}

// Ogni mappa ha due buste cifrate: la "scheda" (titolo e date, leggera, per l'elenco)
// e il "corpo" (tutto il contenuto della mappa).
export async function salvaMappa(mappa) {
  richiedeSblocco();
  const scheda = await cifra(chiave, { titolo: mappa.titolo, creata: mappa.creata, modificata: mappa.modificata });
  const corpo = await cifra(chiave, mappa);
  const tx = db.transaction('mappe', 'readwrite');
  tx.objectStore('mappe').put({ id: mappa.id, scheda, corpo });
  await fineTransazione(tx);
}

export async function leggiMappa(id) {
  richiedeSblocco();
  const riga = await attesa(db.transaction('mappe').objectStore('mappe').get(id));
  if (!riga) return null;
  return decifra(chiave, riga.corpo);
}

export async function elencoMappe() {
  richiedeSblocco();
  const righe = await attesa(db.transaction('mappe').objectStore('mappe').getAll());
  const elenco = [];
  for (const riga of righe) {
    const scheda = await decifra(chiave, riga.scheda);
    elenco.push({ id: riga.id, ...scheda });
  }
  elenco.sort((a, b) => (b.modificata || 0) - (a.modificata || 0));
  return elenco;
}

export async function eliminaMappa(id) {
  richiedeSblocco();
  const tx = db.transaction('mappe', 'readwrite');
  tx.objectStore('mappe').delete(id);
  await fineTransazione(tx);
}

// ---------- backup ----------

function inBase64(byte) {
  let testo = '';
  for (let i = 0; i < byte.length; i += 0x8000) testo += String.fromCharCode.apply(null, byte.subarray(i, i + 0x8000));
  return btoa(testo);
}

function daBase64(testo) {
  const binario = atob(testo);
  const byte = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) byte[i] = binario.charCodeAt(i);
  return byte;
}

const bustaInTesto = (b) => ({ iv: inBase64(b.iv), ct: inBase64(b.ct) });
const bustaDaTesto = (b) => ({ iv: daBase64(b.iv), ct: daBase64(b.ct) });

// Il file di backup contiene solo dati già cifrati: senza PIN è illeggibile.
export async function esportaBackup() {
  richiedeSblocco();
  const meta = await attesa(db.transaction('meta').objectStore('meta').get('cassaforte'));
  const righe = await attesa(db.transaction('mappe').objectStore('mappe').getAll());
  const file = {
    formato: FORMATO_BACKUP,
    versione: 1,
    creato: Date.now(),
    meta: { sale: inBase64(meta.sale), iterazioni: meta.iterazioni, verifica: bustaInTesto(meta.verifica) },
    mappe: righe.map((r) => ({ id: r.id, scheda: bustaInTesto(r.scheda), corpo: bustaInTesto(r.corpo) })),
  };
  return { testo: JSON.stringify(file), numero: righe.length };
}

// Sostituisce l'intero archivio con quello del file. Il PIN richiesto è quello
// in uso quando il backup è stato creato. Restituisce il numero di mappe, o false se il PIN è errato.
export async function importaBackup(testo, pin) {
  let file;
  try { file = JSON.parse(testo); } catch (e) { throw new Error('File non valido'); }
  if (!file || file.formato !== FORMATO_BACKUP || !file.meta || !Array.isArray(file.mappe)) throw new Error('File non valido');
  const sale = daBase64(file.meta.sale);
  const verifica = bustaDaTesto(file.meta.verifica);
  const k = await derivaChiave(pin, sale, file.meta.iterazioni);
  try { await decifra(k, verifica); } catch (e) { return false; }
  const righe = file.mappe.map((m) => ({ id: m.id, scheda: bustaDaTesto(m.scheda), corpo: bustaDaTesto(m.corpo) }));
  await apri();
  const tx = db.transaction(['meta', 'mappe'], 'readwrite');
  tx.objectStore('meta').put({ sale, iterazioni: file.meta.iterazioni, verifica }, 'cassaforte');
  const archivio = tx.objectStore('mappe');
  archivio.clear();
  for (const riga of righe) archivio.put(riga);
  await fineTransazione(tx);
  chiave = k;
  return righe.length;
}

// Cancella tutto: serve solo se il PIN è stato dimenticato.
export async function azzeraTutto() {
  await apri();
  const tx = db.transaction(['meta', 'mappe'], 'readwrite');
  tx.objectStore('meta').clear();
  tx.objectStore('mappe').clear();
  await fineTransazione(tx);
  chiave = null;
}
