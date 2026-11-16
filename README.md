# Lavagna Patrimoniale

App web installabile (PWA) per disegnare a mano una mappa patrimoniale.
I dati restano solo sul dispositivo, cifrati con un PIN. Nessun server, nessun servizio esterno.

- `js/cassaforte.js` — M0: archivio locale cifrato, backup e ripristino
- `js/tela.js` — M1: tela di disegno (penna disegna, dito sposta e ingrandisce)
- `js/app.js` — regia degli schermi
- `sw.js` — copia locale dell'app per l'uso senza rete
