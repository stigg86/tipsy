# Tipsy

Football tips for the Premier League, La Liga, Bundesliga and Ligue 1, built only on free data. It includes:

- best bets across all four leagues
- a **value finder** that lists bets where the best UK bookmaker price pays more than it should
- an accumulator builder (up to 20 legs) covering results, double chance, goals over/under and both teams to score

A scheduled GitHub Action builds `data/tips.json`, and the page (`index.html`) runs the prediction model in the browser.

Tips only. Not betting advice. 18+ · BeGambleAware.org

## Data sources (all free)

| Source | What it gives | Limit |
|---|---|---|
| [football-data.org](https://www.football-data.org) | fixtures, results, tables, form, top scorers, stadium towns | 10 requests/min, current season |
| [The Odds API](https://the-odds-api.com) | UK bookmaker odds: match result + goals over/under | 500 credits/month (each league costs 2 per run) |
| [Open-Meteo](https://open-meteo.com) | kick-off weather | no key, non-commercial use |

The free sources have no xG, corners, cards or injury data. Mark missing players yourself on each match. The model blends in xG automatically if a future data source provides it.

## Setup

1. Get a free token at football-data.org (Register → the token arrives by email).
2. Get a free key at the-odds-api.com (Get API key → Starter/free).
3. In this repo, go to **Settings → Secrets and variables → Actions** and add two secrets:
   - `FOOTBALL_DATA_KEY`: your football-data.org token
   - `ODDS_API_KEY`: your The Odds API key (optional; without it there are no odds or value finder)
4. Go to **Settings → Pages** and set it to deploy from branch `main`, folder `/ (root)`.
5. Go to **Actions → Update tips → Run workflow**.

## How it updates

- It runs every day at 06:15 UTC, plus 11:15 UTC Friday to Monday.
- Each run makes about 8–12 football-data calls (about 1–2 minutes because of the 10/min limit) and uses 8 odds credits. That's about 380 credits a month, inside the free 500. Odds are skipped automatically if fewer than 20 credits are left.
- If a run fails, the site keeps the last good data.

## Settings (optional repository variables)

| Name | Default | Meaning |
|---|---|---|
| `LEAGUES` | `PL,PD,BL1,FL1` | football-data.org competition codes (SA = Serie A) |

## Files

- `index.html` – the page and the model
- `scripts/build.mjs` – data builder (Node 22, no dependencies)
- `data/tips.json` – latest data (written by the Action)
- `data/cache.json` – cached stadium locations
