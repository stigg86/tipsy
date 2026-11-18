# Tipsy

Football tips page for the Premier League, La Liga, Bundesliga and Ligue 1, with an accumulator builder (up to 20 legs) covering results, double chance, goals, BTTS, corners and cards. A scheduled GitHub Action pulls fixtures, results, player stats, injuries and match stats (xG, corners, cards) from API-Football, plus kick-off weather from Open-Meteo. It writes `data/tips.json`, and the page (`index.html`) runs the prediction model in the browser from that file.

Tips only. Not betting advice. 18+ · BeGambleAware.org

## Setup

1. **Add the API key as a secret.** In the repo, go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `API_FOOTBALL_KEY` and paste your api-sports.io key as the value. Never put the key in a file.
2. **Turn on Pages.** Go to **Settings → Pages**, set Source to *Deploy from a branch*, then pick branch `main` and folder `/ (root)`.
3. **Run it once.** Go to **Actions → Update tips → Run workflow**.

The site is at `https://<your-username>.github.io/<repo-name>/`.

## How it updates

- It runs every day at 06:15 UTC, plus 11:15 UTC Friday to Monday for fresher team news.
- Each league uses about 6–7 requests per run (fixtures, next round, top scorers, top assists, injuries, plus match stats in batches of 20). Four leagues is about 25–30 per run, or 50–60 a day, inside the free plan's 100. The first run uses a few more while it fills in the season so far.
- The script stops itself when the daily quota is nearly used up.
- Match stats are cached in `data/cache.json`, so each finished match is only looked up once.
- If a run fails, the site keeps showing the last good data.

## Settings (optional)

Set these as repository **variables**, or edit the `env:` block in `.github/workflows/update.yml`:

| Name | Default | Meaning |
|---|---|---|
| `LEAGUES` | `39,140,78,61` | API-Football league ids: 39 Premier League, 140 La Liga, 78 Bundesliga, 61 Ligue 1 (135 = Serie A) |
| `SEASON` | current | Season start year, e.g. `2026` |
| `MIN_LEFT` | `8` | Requests to leave unused each day |

## Files

- `index.html` – the page and the model
- `scripts/build.mjs` – data builder (Node 20, no dependencies)
- `data/tips.json` – latest data (written by the Action)
- `data/cache.json` – cached match stats and stadium locations

Weather comes from Open-Meteo, which needs no key and is free for non-commercial use.
