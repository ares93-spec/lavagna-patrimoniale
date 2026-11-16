// REGIA: collega gli schermi (PIN, elenco, tela) a Cassaforte (M0) e Tela (M1).

import * as cassaforte from './cassaforte.js';
import { Tela } from './tela.js';

const VERSIONE = '0.1.0';
const BLOCCO_DOPO_MS = 5 * 60 * 1000; // blocco automatico dopo 5 minuti in secondo piano
const COLORI = [
  { nome: 'Blu', valore: '#003781' },
  { nome: 'Inchiostro', valore: '#1b2330' },
  { nome: 'Rosso', valore: '#c8102e' },
  { nome: 'Verde', valore: '#1e8e3e' },
  { nome: 'Oro', valore: '#b8975a' },
];
const SPESSORI = [{ nome: 'Fine', valore: 2, punto: 6 }, { nome: 'Medio', valore: 3.5, punto: 11 }, { nome: 'Grosso', valore: 7, punto: 18 }];

const $ = (id) => document.getElementById(id);
const schermi = { pin: $('schermo-pin'), elenco: $('schermo-elenco'), tela: $('schermo-tela') };

let tela = null;
let mappa = null;        // mappa aperta
let timerSalva = null;
let salvataggio = Promise.resolve();
let nascostoDa = 0;
let modoPin = 'sblocca'; // 'crea' | 'sblocca'

function mostra(nome) {
  for (const [k, el] of Object.entries(schermi)) el.hidden = k !== nome;
  $('menu-tela').hidden = true;
}

// ---------- finestre di dialogo ----------

function dialogo({ titolo, testo = '', campo = null, tipo = 'text', si = 'OK', no = 'Annulla' }) {
  return new Promise((risolvi) => {
    const d = $('dialogo'), c = $('dialogo-campo');
    $('dialogo-titolo').textContent = titolo;
    $('dialogo-testo').textContent = testo;
    $('dialogo-testo').hidden = !testo;
    c.hidden = campo === null;
    c.type = tipo;
    c.inputMode = tipo === 'password' ? 'numeric' : 'text';
    c.value = campo || '';
    $('dialogo-si').textContent = si;
    $('dialogo-no').textContent = no;
    const chiudi = (esito) => {
      $('dialogo-modulo').onsubmit = null;
      $('dialogo-no').onclick = null;
      d.oncancel = null;
      d.close();
      risolvi(esito);
    };
    $('dialogo-modulo').onsubmit = (e) => { e.preventDefault(); chiudi(campo === null ? true : c.value); };
    $('dialogo-no').onclick = () => chiudi(null);
    d.oncancel = (e) => { e.preventDefault(); chiudi(null); };
    d.showModal();
    if (campo !== null) { c.focus(); c.select(); }
  });
}

const avviso = (titolo, testo) => dialogo({ titolo, testo, no: 'Chiudi', si: 'OK' });

// ---------- PIN ----------

async function schermoPin() {
  cassaforte.blocca();
  const esiste = await cassaforte.esisteCassaforte();
  modoPin = esiste ? 'sblocca' : 'crea';
  $('pin-titolo').textContent = esiste ? "Sblocca l'archivio" : 'Crea il tuo PIN';
  $('pin-testo').textContent = esiste
    ? 'Inserisci il PIN per aprire le tue mappe.'
    : `Il PIN cifra le mappe su questo dispositivo. Minimo ${cassaforte.PIN_MINIMO} caratteri: più è lungo, più protegge. Se lo dimentichi, i dati non sono recuperabili.`;
  $('pin-conferma').hidden = esiste;
  $('pin-azzera').hidden = !esiste;
  $('pin-invia').textContent = esiste ? 'Sblocca' : 'Crea archivio';
  $('pin-1').value = '';
  $('pin-2').value = '';
  $('pin-errore').textContent = '';
  mostra('pin');
  $('pin-1').focus();
}

$('modulo-pin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('pin-1').value, errore = $('pin-errore'), invia = $('pin-invia');
  errore.textContent = '';
  if (modoPin === 'crea') {
    if (pin.length < cassaforte.PIN_MINIMO) { errore.textContent = `Servono almeno ${cassaforte.PIN_MINIMO} caratteri.`; return; }
    if (pin !== $('pin-2').value) { errore.textContent = 'I due PIN non coincidono.'; return; }
  }
  invia.disabled = true;
  try {
    if (modoPin === 'crea') {
      await cassaforte.creaCassaforte(pin);
    } else if (!(await cassaforte.sblocca(pin))) {
      errore.textContent = 'PIN errato.';
      $('pin-1').select();
      return;
    }
    await schermoElenco();
  } catch (err) {
    errore.textContent = 'Errore: ' + err.message;
  } finally {
    invia.disabled = false;
  }
});

$('pin-azzera').addEventListener('click', async () => {
  const risposta = await dialogo({
    titolo: 'Cancellare tutto?',
    testo: 'Senza PIN le mappe non sono recuperabili. Per cancellare tutto e ripartire da zero scrivi CANCELLA.',
    campo: '', si: 'Cancella tutto',
  });
  if (risposta === null) return;
  if (risposta.trim().toUpperCase() !== 'CANCELLA') { await avviso('Nulla è stato cancellato', 'La parola non corrisponde.'); return; }
  await cassaforte.azzeraTutto();
  await schermoPin();
});

// ---------- elenco ----------

const data = (ms) => new Date(ms).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function schermoElenco() {
  mappa = null;
  const elenco = await cassaforte.elencoMappe();
  const ul = $('elenco-mappe');
  ul.replaceChildren();
  for (const voce of elenco) {
    const li = document.createElement('li');
    const apri = document.createElement('button');
    apri.type = 'button';
    apri.className = 'apri';
    const nome = document.createElement('strong');
    nome.textContent = voce.titolo;
    const quando = document.createElement('small');
    quando.textContent = 'Modificata il ' + data(voce.modificata);
    apri.append(nome, quando);
    apri.addEventListener('click', () => apriMappa(voce.id));
    const elimina = document.createElement('button');
    elimina.type = 'button';
    elimina.className = 'elimina';
    elimina.textContent = 'Elimina';
    elimina.setAttribute('aria-label', 'Elimina ' + voce.titolo);
    elimina.addEventListener('click', async () => {
      const ok = await dialogo({ titolo: 'Eliminare la mappa?', testo: `«${voce.titolo}» sarà cancellata da questo dispositivo. L'operazione non si può annullare.`, si: 'Elimina' });
      if (!ok) return;
      await cassaforte.eliminaMappa(voce.id);
      await schermoElenco();
    });
    li.append(apri, elimina);
    ul.append(li);
  }
  $('elenco-vuoto').hidden = elenco.length > 0;
  mostra('elenco');
}

$('btn-nuova').addEventListener('click', async () => {
  const titolo = await dialogo({ titolo: 'Nuova mappa', testo: 'Dai un nome con le sole iniziali del cliente.', campo: '', si: 'Crea' });
  if (titolo === null) return;
  const ora = Date.now();
  const nuova = { v: 1, id: cassaforte.nuovoId(), titolo: titolo.trim() || 'Senza nome', creata: ora, modificata: ora, vista: { k: 1, x: 0, y: 0 }, tratti: [], blocchi: [], legami: [] };
  await cassaforte.salvaMappa(nuova);
  await apriMappa(nuova.id);
});

$('btn-blocca').addEventListener('click', () => schermoPin());

// ---------- backup ----------

function scarica(nome, testo) {
  const url = URL.createObjectURL(new Blob([testo], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

$('btn-backup').addEventListener('click', async () => {
  const { testo, numero } = await cassaforte.esportaBackup();
  const giorno = new Date().toISOString().slice(0, 10);
  scarica(`lavagna-backup-${giorno}.json`, testo);
  await avviso('Backup salvato', `Il file contiene ${numero} ${numero === 1 ? 'mappa' : 'mappe'}, già cifrate: si apre solo con il tuo PIN attuale.`);
});

function scegliFile() {
  return new Promise((risolvi) => {
    const campo = $('file-backup');
    campo.value = '';
    campo.onchange = () => risolvi(campo.files[0] || null);
    campo.click();
  });
}

async function ripristina() {
  const file = await scegliFile();
  if (!file) return;
  const testo = await file.text();
  const pin = await dialogo({ titolo: 'Ripristina backup', testo: "Il ripristino sostituisce tutte le mappe presenti su questo dispositivo. Inserisci il PIN in uso quando il backup è stato creato.", campo: '', tipo: 'password', si: 'Ripristina' });
  if (pin === null) return;
  try {
    const esito = await cassaforte.importaBackup(testo, pin);
    if (esito === false) { await avviso('PIN errato', 'Nessun dato è stato modificato.'); return; }
    await avviso('Ripristino completato', `${esito} ${esito === 1 ? 'mappa ripristinata' : 'mappe ripristinate'}. Da ora vale il PIN del backup.`);
    await schermoElenco();
  } catch (err) {
    await avviso('File non valido', 'Il file scelto non è un backup della Lavagna Patrimoniale. Nessun dato è stato modificato.');
  }
}

$('btn-ripristina').addEventListener('click', ripristina);
$('pin-ripristina').addEventListener('click', ripristina);

// ---------- tela ----------

function segnaStato(testo) { $('stato-salvataggio').textContent = testo; }

function aggiornaPulsanti() {
  $('btn-annulla').disabled = !tela.puoAnnullare;
  $('btn-ripeti').disabled = !tela.puoRipristinare;
}

function programmaSalvataggio() {
  if (!mappa) return;
  segnaStato('Modifiche…');
  clearTimeout(timerSalva);
  timerSalva = setTimeout(salvaOra, 800);
}

// I salvataggi sono messi in coda: mai due scritture della stessa mappa insieme.
function salvaOra() {
  clearTimeout(timerSalva);
  timerSalva = null;
  if (!mappa || !cassaforte.sbloccata()) return salvataggio;
  const daSalvare = mappa;
  Object.assign(daSalvare, tela.dati(), { modificata: Date.now() });
  const istantanea = JSON.parse(JSON.stringify(daSalvare));
  salvataggio = salvataggio
    .then(() => cassaforte.salvaMappa(istantanea))
    .then(() => { if (mappa === daSalvare && !timerSalva) segnaStato('Salvato'); })
    .catch(() => segnaStato('Errore di salvataggio'));
  return salvataggio;
}

function preparaTela() {
  tela = new Tela($('tela'), { alCambio: programmaSalvataggio, alloStato: aggiornaPulsanti });

  const colori = $('colori');
  COLORI.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'colore';
    b.setAttribute('aria-label', c.nome);
    b.setAttribute('aria-pressed', String(i === 0));
    const pallino = document.createElement('span');
    pallino.style.background = c.valore;
    b.append(pallino);
    b.addEventListener('click', () => {
      tela.colore = c.valore;
      tela.strumento = 'penna';
      for (const altro of colori.children) altro.setAttribute('aria-pressed', String(altro === b));
      $('btn-gomma').setAttribute('aria-pressed', 'false');
    });
    colori.append(b);
  });

  const spessori = $('spessori');
  SPESSORI.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'spessore';
    b.setAttribute('aria-label', 'Tratto ' + s.nome.toLowerCase());
    b.setAttribute('aria-pressed', String(i === 1));
    const punto = document.createElement('span');
    punto.style.width = punto.style.height = s.punto + 'px';
    b.append(punto);
    b.addEventListener('click', () => {
      tela.spessore = s.valore;
      for (const altro of spessori.children) altro.setAttribute('aria-pressed', String(altro === b));
    });
    spessori.append(b);
  });
  tela.spessore = SPESSORI[1].valore;

  $('btn-gomma').addEventListener('click', () => {
    const attiva = tela.strumento !== 'gomma';
    tela.strumento = attiva ? 'gomma' : 'penna';
    $('btn-gomma').setAttribute('aria-pressed', String(attiva));
  });
  $('btn-annulla').addEventListener('click', () => tela.annulla());
  $('btn-ripeti').addEventListener('click', () => tela.ripristina());
  $('btn-menu').addEventListener('click', () => { $('menu-tela').hidden = !$('menu-tela').hidden; });
  $('btn-adatta').addEventListener('click', () => { tela.adatta(); $('menu-tela').hidden = true; });
  $('btn-dito').addEventListener('click', () => {
    tela.ditoDisegna = !tela.ditoDisegna;
    $('btn-dito').setAttribute('aria-pressed', String(tela.ditoDisegna));
    $('btn-dito').textContent = 'Disegna con il dito: ' + (tela.ditoDisegna ? 'sì' : 'no');
    $('menu-tela').hidden = true;
  });
  $('btn-stampa').addEventListener('click', stampa);
  $('tela').addEventListener('pointerdown', () => { $('menu-tela').hidden = true; });

  $('btn-indietro').addEventListener('click', async () => {
    await salvaOra();
    await schermoElenco();
  });
  $('btn-titolo').addEventListener('click', async () => {
    const titolo = await dialogo({ titolo: 'Rinomina mappa', campo: mappa.titolo, si: 'Salva' });
    if (titolo === null) return;
    mappa.titolo = titolo.trim() || 'Senza nome';
    $('btn-titolo').textContent = mappa.titolo;
    await salvaOra();
  });
}

async function apriMappa(id) {
  const letta = await cassaforte.leggiMappa(id);
  if (!letta) { await schermoElenco(); return; }
  mappa = letta;
  $('btn-titolo').textContent = mappa.titolo;
  segnaStato('');
  mostra('tela');
  tela.ridimensiona();
  tela.carica(mappa);
}

async function stampa() {
  $('menu-tela').hidden = true;
  const immagine = tela.immagine();
  if (!immagine) { await avviso('Niente da stampare', 'La mappa è ancora vuota.'); return; }
  const area = $('stampa');
  const h = document.createElement('h1');
  h.textContent = mappa.titolo;
  const p = document.createElement('p');
  p.textContent = 'Lavagna Patrimoniale — appunto interno del consulente, non destinato al cliente — ' + data(Date.now());
  const img = new Image();
  img.alt = 'Mappa ' + mappa.titolo;
  img.src = immagine;
  area.replaceChildren(h, p, img);
  try { await img.decode(); } catch (e) { /* stampa comunque */ }
  window.print();
}

// ---------- blocco automatico e salvataggio in uscita ----------

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    nascostoDa = Date.now();
    if (mappa && timerSalva) salvaOra();
  } else if (nascostoDa && cassaforte.sbloccata() && Date.now() - nascostoDa > BLOCCO_DOPO_MS) {
    await salvaOra();
    await schermoPin();
  }
});
window.addEventListener('pagehide', () => { if (mappa && timerSalva) salvaOra(); });

// ---------- avvio ----------

async function avvia() {
  $('versione').textContent = 'Versione ' + VERSIONE + '.';
  preparaTela();
  if (!window.isSecureContext || !crypto.subtle) {
    mostra('pin');
    $('pin-titolo').textContent = 'Connessione non sicura';
    $('pin-testo').textContent = "L'app funziona solo su indirizzo https. Aprila dal link ufficiale.";
    $('modulo-pin').querySelectorAll('input, button, label').forEach((el) => { el.hidden = true; });
    return;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  await schermoPin();
}

avvia();
