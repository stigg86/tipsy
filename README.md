# Tipsy

Premier League tips page. A scheduled GitHub Action pulls fixtures, results, player stats, injuries and match xG from API-Football, plus kick-off weather from Open-Meteo. It writes `data/tips.json`, and the page (`index.html`) runs the prediction model in the browser from that file.

Tips only. Not betting advice. 18+ · BeGambleAware.org

## Setup

1. **Add the API key as a secret.** In the repo, go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `API_FOOTBALL_KEY` and paste your api-sports.io key as the value. Never put the key in a file.
2. **Turn on Pages.** Go to **Settings → Pages**, set Source to *Deploy from a branch*, then pick branch `main` and folder `/ (root)`.
3. **Run it once.** Go to **Actions → Update tips → Run workflow**.

The site is at `https://<your-username>.github.io/<repo-name>/`.

## How it updates

- It runs every day at 06:15 UTC, plus 11:15 UTC Friday to Monday for fresher team news.
- Each run uses about 15–55 API requests, and the free plan allows 100 a day. The script stops itself when the daily quota is nearly used up.
- Match xG is cached in `data/cache.json`, so each match is only looked up once. On the first day or two it fills in older matches gradually, and after that only new results are fetched.
- If a run fails, the site keeps showing the last good data.

## Settings (optional)

Set these as repository **variables**, or edit the `env:` block in `.github/workflows/update.yml`:

| Name | Default | Meaning |
|---|---|---|
| `LEAGUE` | `39` | API-Football league id (39 = Premier League) |
| `SEASON` | current | Season start year, e.g. `2026` |
| `MAX_STATS` | `40` | Max xG lookups per run |
| `MIN_LEFT` | `10` | Requests to leave unused each day |

## Files

- `index.html` – the page and the model
- `scripts/build.mjs` – data builder (Node 20, no dependencies)
- `data/tips.json` – latest data (written by the Action)
- `data/cache.json` – cached match xG and stadium locations
