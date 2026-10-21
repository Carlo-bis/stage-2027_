# Stage 2027

Tracker delle offerte di summer internship 2027 (massimo 3 mesi, Lugano / Svizzera / Milano) con:

- uno scraper che ogni giorno legge le pagine carriere **ufficiali** di banche, asset manager, VC/PE, family office e fintech;
- un sito (GitHub Pages) con scadenze, passaggi di selezione, descrizione e stato delle tue candidature;
- generazione del CV e della lettera di presentazione in Word per ogni offerta;
- un avviso (una Issue su GitHub, quindi una mail) quando compaiono offerte nuove.

## Come metterlo online (una volta sola)

1. Su github.com crea un repository **pubblico** (nome suggerito: `stage-2027`). Non aggiungere README o altri file.
2. Su GitHub Desktop: *File → Add Local Repository* (o *Clone*) e scegli la cartella del repository. Copiaci dentro **tutto** il contenuto di questa cartella: `scraper`, `site`, `data`, `docs`, `README.md`, `.gitignore`.
3. **La cartella `.github` sul Mac è nascosta** (premi `Cmd + Maiusc + .` nel Finder per vederla). Se GitHub Desktop non la mostra tra le modifiche, fai così: su github.com apri il repository → *Add file → Create new file*, come nome scrivi `.github/workflows/daily.yml` (scrivendo le `/` GitHub crea le cartelle), incolla il contenuto di `docs/workflow-daily.yml.txt` e premi *Commit changes*.
4. Su GitHub Desktop fai *Commit to main* e *Push origin*.
5. Su github.com: *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
6. Vai nella scheda *Actions*, apri «Aggiornamento giornaliero e sito» e premi *Run workflow*. Quando è verde (1-2 minuti) il sito è su `https://TUO-UTENTE.github.io/stage-2027/`.

Da quel momento il workflow parte da solo ogni giorno verso le 6 del mattino. Se compaiono offerte nuove si apre una Issue con la lista e ricevi una mail (controlla che le notifiche di GitHub siano attive).

## Il tuo profilo (CV e lettera)

Il file `profile.carlo.json` contiene telefono ed email: **non caricarlo nel repository**. Aprilo dal sito, scheda *Profilo e CV → Carica il profilo*: resta solo nel tuo browser. `site/profile.example.json` è un esempio con dati inventati.

## Cosa fa e cosa no

- Lo scraper legge in automatico le fonti con un sistema di annunci standard (Greenhouse, Lever, Recruitee) o con pagine HTML semplici. Le altre fonti (UBS, Pictet, Vontobel, ecc.) sono nella scheda *Fonti* da controllare a mano, con la data di apertura prevista.
- Ogni offerta è classificata: **rispetta i criteri**, **da verificare** (durata, periodo o sede non chiari) o **scartata** (con il motivo).
- Candidature, note e offerte che aggiungi a mano sono salvate nel browser: usa *Esporta backup* ogni tanto.
- Dopo 60 giorni senza attività GitHub può disattivare il workflow giornaliero: se succede, riattivalo dalla scheda Actions.

## Per sviluppatori

```
python3 scraper/scrape.py --offline      # ricostruisce site/data/offers.json senza rete
python3 -m unittest discover -s scraper/tests
cd site && python3 -m http.server        # anteprima locale
```

Le fonti sono in `data/sources.json`, le offerte trovate a mano in `data/manual_leads.json`. La libreria `docx` (MIT) è inclusa in `site/assets/vendor`.
