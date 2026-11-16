// M1 — TELA: superficie di disegno.
// Penna = disegna. Dito = sposta (un dito) e ingrandisce (due dita).
// I tratti sono salvati in coordinate "mondo", indipendenti da zoom e schermo.

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 6;
const PASSO_GRIGLIA = 40;

const arrotonda = (v, d) => Math.round(v * d) / d;

function larghezza(tratto, pressione) {
  return tratto.s * (0.45 + 0.9 * pressione);
}

function distanzaDaSegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function confini(tratti) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of tratti) {
    for (let i = 0; i < t.p.length; i += 3) {
      const m = t.s;
      if (t.p[i] - m < x0) x0 = t.p[i] - m;
      if (t.p[i] + m > x1) x1 = t.p[i] + m;
      if (t.p[i + 1] - m < y0) y0 = t.p[i + 1] - m;
      if (t.p[i + 1] + m > y1) y1 = t.p[i + 1] + m;
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

// Disegna un tratto intero con curve morbide e spessore legato alla pressione.
function disegnaTratto(ctx, t) {
  const p = t.p, n = p.length / 3;
  ctx.strokeStyle = t.c;
  ctx.fillStyle = t.c;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], larghezza(t, p[2]) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (n === 2) {
    ctx.lineWidth = larghezza(t, (p[2] + p[5]) / 2);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[3], p[4]);
    ctx.stroke();
    return;
  }
  // primo mezzo segmento
  ctx.lineWidth = larghezza(t, p[2]);
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  ctx.lineTo((p[0] + p[3]) / 2, (p[1] + p[4]) / 2);
  ctx.stroke();
  for (let i = 1; i < n - 1; i++) disegnaCurva(ctx, t, i);
  // ultimo mezzo segmento
  const a = (n - 2) * 3, b = (n - 1) * 3;
  ctx.lineWidth = larghezza(t, p[b + 2]);
  ctx.beginPath();
  ctx.moveTo((p[a] + p[b]) / 2, (p[a + 1] + p[b + 1]) / 2);
  ctx.lineTo(p[b], p[b + 1]);
  ctx.stroke();
}

// Curva attorno al punto i: dal punto medio (i-1,i) al punto medio (i,i+1).
function disegnaCurva(ctx, t, i) {
  const p = t.p, a = (i - 1) * 3, b = i * 3, c = (i + 1) * 3;
  ctx.strokeStyle = t.c;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = larghezza(t, p[b + 2]);
  ctx.beginPath();
  ctx.moveTo((p[a] + p[b]) / 2, (p[a + 1] + p[b + 1]) / 2);
  ctx.quadraticCurveTo(p[b], p[b + 1], (p[b] + p[c]) / 2, (p[b + 1] + p[c + 1]) / 2);
  ctx.stroke();
}

export class Tela {
  constructor(canvas, opzioni = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.alCambio = opzioni.alCambio || (() => {});
    this.alloStato = opzioni.alloStato || (() => {});
    this.tratti = [];
    this.vista = { k: 1, x: 0, y: 0 };
    this.passati = []; // azioni annullabili
    this.futuri = [];  // azioni ripristinabili
    this.colore = '#003781';
    this.spessore = 3;
    this.strumento = 'penna'; // 'penna' | 'gomma'
    this.ditoDisegna = false;
    this.corrente = null;      // tratto in corso
    this.cancellati = null;    // tratti rimossi dalla gomma nel gesto in corso
    this.puntatoreAttivo = null;
    this.tocchi = new Map();
    this.gesto = null;
    this.ultimaPenna = 0;
    this.inAttesa = false;

    const c = canvas;
    c.addEventListener('pointerdown', (e) => this.giu(e));
    c.addEventListener('pointermove', (e) => this.muovi(e));
    c.addEventListener('pointerup', (e) => this.su(e));
    c.addEventListener('pointercancel', (e) => this.su(e, true));
    c.addEventListener('wheel', (e) => this.rotella(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    this.osservatore = new ResizeObserver(() => this.ridimensiona());
    this.osservatore.observe(canvas);
    this.ridimensiona();
  }

  // ---------- dati ----------

  carica(mappa) {
    this.tratti = Array.isArray(mappa.tratti) ? mappa.tratti : [];
    this.vista = mappa.vista ? { ...mappa.vista } : { k: 1, x: 0, y: 0 };
    this.passati = [];
    this.futuri = [];
    this.corrente = null;
    this.ridisegna();
    this.alloStato();
  }

  dati() {
    return { tratti: this.tratti, vista: { ...this.vista } };
  }

  get puoAnnullare() { return this.passati.length > 0; }
  get puoRipristinare() { return this.futuri.length > 0; }

  // ---------- geometria ----------

  ridimensiona() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    this.ridisegna();
  }

  posizione(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  inMondo(s) {
    return { x: (s.x - this.vista.x) / this.vista.k, y: (s.y - this.vista.y) / this.vista.k };
  }

  applicaVista(ctx = this.ctx) {
    const d = this.dpr, v = this.vista;
    ctx.setTransform(d * v.k, 0, 0, d * v.k, d * v.x, d * v.y);
  }

  // ---------- disegno ----------

  richiediRidisegno() {
    if (this.inAttesa) return;
    this.inAttesa = true;
    requestAnimationFrame(() => { this.inAttesa = false; this.ridisegna(); });
  }

  ridisegna() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.applicaVista();
    this.disegnaGriglia();
    for (const t of this.tratti) disegnaTratto(ctx, t);
    if (this.corrente) disegnaTratto(ctx, this.corrente);
  }

  disegnaGriglia() {
    const v = this.vista;
    if (v.k < 0.45) return;
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    const a = this.inMondo({ x: 0, y: 0 }), b = this.inMondo({ x: w, y: h });
    const x0 = Math.floor(a.x / PASSO_GRIGLIA) * PASSO_GRIGLIA;
    const y0 = Math.floor(a.y / PASSO_GRIGLIA) * PASSO_GRIGLIA;
    ctx.fillStyle = '#d9d4c5';
    const lato = 1.6 / v.k;
    for (let x = x0; x <= b.x; x += PASSO_GRIGLIA) {
      for (let y = y0; y <= b.y; y += PASSO_GRIGLIA) ctx.fillRect(x - lato / 2, y - lato / 2, lato, lato);
    }
  }

  // ---------- puntatori ----------

  eGomma(e) {
    if (this.strumento === 'gomma') return true;
    // tasto laterale della penna o estremità gomma, dove il dispositivo li segnala
    return e.pointerType === 'pen' && ((e.buttons & 32) !== 0 || (e.buttons & 2) !== 0);
  }

  giu(e) {
    e.preventDefault();
    const tipo = e.pointerType;
    if (tipo === 'touch') {
      // rifiuto del palmo: mentre la penna lavora, il tocco è ignorato
      if (this.puntatoreAttivo !== null && this.tipoAttivo === 'pen') return;
      if (performance.now() - this.ultimaPenna < 400) return;
      this.tocchi.set(e.pointerId, this.posizione(e));
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
      if (this.tocchi.size === 2) {
        this.interrompiTratto();
        this.iniziaGesto();
        return;
      }
      if (this.tocchi.size > 2) return;
      if (!this.ditoDisegna) {
        this.gesto = { tipo: 'sposta', ultimo: this.posizione(e) };
        return;
      }
    } else if (tipo === 'pen') {
      // la penna ha la precedenza: annulla eventuali gesti del dito in corso
      this.tocchi.clear();
      this.gesto = null;
    }
    if (this.puntatoreAttivo !== null) return;
    this.puntatoreAttivo = e.pointerId;
    this.tipoAttivo = tipo;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
    const m = this.inMondo(this.posizione(e));
    if (this.eGomma(e)) {
      this.cancellati = [];
      this.cancellaVicino(m);
    } else {
      this.corrente = { c: this.colore, s: this.spessore, p: [] };
      this.aggiungiPunto(e, m);
      this.richiediRidisegno();
    }
  }

  pressione(e) {
    if (e.pointerType === 'pen' && e.pressure > 0) return arrotonda(e.pressure, 100);
    return 0.5;
  }

  aggiungiPunto(e, m) {
    const p = this.corrente.p, n = p.length;
    const x = arrotonda(m.x, 10), y = arrotonda(m.y, 10);
    if (n >= 3 && p[n - 3] === x && p[n - 2] === y) return false;
    p.push(x, y, this.pressione(e));
    return true;
  }

  muovi(e) {
    if (e.pointerType === 'touch' && this.tocchi.has(e.pointerId) && e.pointerId !== this.puntatoreAttivo) {
      e.preventDefault();
      this.tocchi.set(e.pointerId, this.posizione(e));
      this.aggiornaGesto(e);
      return;
    }
    if (e.pointerId !== this.puntatoreAttivo) return;
    e.preventDefault();
    if (e.pointerType === 'touch') this.tocchi.set(e.pointerId, this.posizione(e));
    const eventi = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    const lista = eventi.length ? eventi : [e];
    if (this.cancellati) {
      for (const ev of lista) this.cancellaVicino(this.inMondo(this.posizione(ev)));
      return;
    }
    if (!this.corrente) return;
    this.applicaVista();
    for (const ev of lista) {
      if (!this.aggiungiPunto(ev, this.inMondo(this.posizione(ev)))) continue;
      const n = this.corrente.p.length / 3;
      // disegno incrementale: solo l'ultimo pezzo, senza ridisegnare tutto
      if (n === 2) {
        const p = this.corrente.p;
        this.ctx.strokeStyle = this.corrente.c;
        this.ctx.lineCap = 'round';
        this.ctx.lineWidth = larghezza(this.corrente, p[2]);
        this.ctx.beginPath();
        this.ctx.moveTo(p[0], p[1]);
        this.ctx.lineTo((p[0] + p[3]) / 2, (p[1] + p[4]) / 2);
        this.ctx.stroke();
      } else if (n >= 3) {
        disegnaCurva(this.ctx, this.corrente, n - 2);
      }
    }
  }

  su(e, annullato = false) {
    if (e.pointerType === 'pen') this.ultimaPenna = performance.now();
    if (this.tocchi.has(e.pointerId)) {
      this.tocchi.delete(e.pointerId);
      if (this.gesto) {
        const eraGesto = this.gesto.tipo;
        this.gesto = null;
        if (this.tocchi.size === 1 && !this.ditoDisegna) {
          const [resto] = this.tocchi.values();
          this.gesto = { tipo: 'sposta', ultimo: { ...resto } };
        }
        if (eraGesto) this.alCambio();
      }
    }
    if (e.pointerId !== this.puntatoreAttivo) return;
    this.puntatoreAttivo = null;
    this.tipoAttivo = null;
    if (this.cancellati) {
      if (this.cancellati.length) {
        this.passati.push({ tipo: 'cancella', voci: this.cancellati });
        this.futuri = [];
        this.alCambio();
      }
      this.cancellati = null;
      this.alloStato();
      return;
    }
    if (this.corrente) {
      const t = this.corrente;
      this.corrente = null;
      if (!annullato && t.p.length) {
        this.tratti.push(t);
        this.passati.push({ tipo: 'aggiungi', tratto: t });
        this.futuri = [];
        this.alCambio();
      }
      this.ridisegna();
      this.alloStato();
    }
  }

  interrompiTratto() {
    // un secondo dito trasforma il gesto in zoom: il tratto appena iniziato si scarta
    if (this.puntatoreAttivo !== null && this.tipoAttivo === 'touch') {
      this.corrente = null;
      this.cancellati = null;
      this.puntatoreAttivo = null;
      this.tipoAttivo = null;
      this.ridisegna();
    }
  }

  iniziaGesto() {
    const [a, b] = [...this.tocchi.values()];
    this.gesto = {
      tipo: 'zoom',
      distanza: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      centro: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      vista: { ...this.vista },
    };
  }

  aggiornaGesto(e) {
    const g = this.gesto;
    if (!g) return;
    if (g.tipo === 'sposta' && this.tocchi.size === 1) {
      const p = this.posizione(e);
      this.vista.x += p.x - g.ultimo.x;
      this.vista.y += p.y - g.ultimo.y;
      g.ultimo = p;
      this.richiediRidisegno();
    } else if (g.tipo === 'zoom' && this.tocchi.size >= 2) {
      const [a, b] = [...this.tocchi.values()];
      const distanza = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const centro = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, g.vista.k * distanza / g.distanza));
      // il punto del foglio sotto le dita all'inizio resta sotto le dita
      this.vista.k = k;
      this.vista.x = centro.x - (g.centro.x - g.vista.x) * (k / g.vista.k);
      this.vista.y = centro.y - (g.centro.y - g.vista.y) * (k / g.vista.k);
      this.richiediRidisegno();
    }
  }

  rotella(e) {
    e.preventDefault();
    const s = this.posizione(e);
    const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.vista.k * Math.exp(-e.deltaY * 0.0015)));
    const m = this.inMondo(s);
    this.vista.k = k;
    this.vista.x = s.x - m.x * k;
    this.vista.y = s.y - m.y * k;
    this.richiediRidisegno();
    this.alCambio();
  }

  // ---------- gomma ----------

  cancellaVicino(m) {
    const raggio = 12 / this.vista.k;
    let tolto = false;
    for (let i = this.tratti.length - 1; i >= 0; i--) {
      const t = this.tratti[i], p = t.p, soglia = raggio + t.s / 2;
      let colpito = false;
      if (p.length === 3) {
        colpito = Math.hypot(m.x - p[0], m.y - p[1]) <= soglia;
      } else {
        for (let j = 3; j < p.length && !colpito; j += 3) {
          colpito = distanzaDaSegmento(m.x, m.y, p[j - 3], p[j - 2], p[j], p[j + 1]) <= soglia;
        }
      }
      if (colpito) {
        this.tratti.splice(i, 1);
        this.cancellati.push({ indice: i, tratto: t });
        tolto = true;
      }
    }
    if (tolto) this.richiediRidisegno();
  }

  // ---------- annulla / ripristina ----------

  annulla() {
    const a = this.passati.pop();
    if (!a) return;
    if (a.tipo === 'aggiungi') {
      const i = this.tratti.lastIndexOf(a.tratto);
      if (i >= 0) this.tratti.splice(i, 1);
    } else {
      // rimette i tratti cancellati al loro posto, in ordine inverso di rimozione
      for (let i = a.voci.length - 1; i >= 0; i--) this.tratti.splice(a.voci[i].indice, 0, a.voci[i].tratto);
    }
    this.futuri.push(a);
    this.dopoModifica();
  }

  ripristina() {
    const a = this.futuri.pop();
    if (!a) return;
    if (a.tipo === 'aggiungi') {
      this.tratti.push(a.tratto);
    } else {
      for (const v of a.voci) {
        const i = this.tratti.indexOf(v.tratto);
        if (i >= 0) this.tratti.splice(i, 1);
      }
    }
    this.passati.push(a);
    this.dopoModifica();
  }

  dopoModifica() {
    this.ridisegna();
    this.alCambio();
    this.alloStato();
  }

  // ---------- vista ----------

  adatta() {
    const b = confini(this.tratti);
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    if (!b) {
      this.vista = { k: 1, x: 0, y: 0 };
    } else {
      const margine = 32;
      const k = Math.max(ZOOM_MIN, Math.min(2, Math.min((w - margine * 2) / Math.max(1, b.x1 - b.x0), (h - margine * 2) / Math.max(1, b.y1 - b.y0))));
      this.vista = { k, x: (w - (b.x0 + b.x1) * k) / 2, y: (h - (b.y0 + b.y1) * k) / 2 };
    }
    this.ridisegna();
    this.alCambio();
  }

  // Immagine dell'intero disegno su fondo bianco, per la stampa.
  immagine() {
    const b = confini(this.tratti);
    if (!b) return null;
    const margine = 24;
    const lw = b.x1 - b.x0 + margine * 2, lh = b.y1 - b.y0 + margine * 2;
    const scala = Math.max(0.25, Math.min(3, 2400 / Math.max(lw, lh)));
    const foglio = document.createElement('canvas');
    foglio.width = Math.ceil(lw * scala);
    foglio.height = Math.ceil(lh * scala);
    const ctx = foglio.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, foglio.width, foglio.height);
    ctx.setTransform(scala, 0, 0, scala, (margine - b.x0) * scala, (margine - b.y0) * scala);
    for (const t of this.tratti) disegnaTratto(ctx, t);
    return foglio.toDataURL('image/png');
  }
}
