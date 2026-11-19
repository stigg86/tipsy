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
| [Fantasy Premier League feed](https://fantasy.premierleague.com/api/bootstrap-static/) | Premier League injuries, suspensions, xG | no key |
| [ClubElo](http://clubelo.com) | long-run team strength ratings | no key; last good ratings are kept if it's down |

Team news and xG are automatic for the Premier League only. The free sources have none for La Liga, the Bundesliga or Ligue 1.

## Model

The model lives in `model.js`, which both the page and the data builder use. In short:

- Team strength comes from goals (plus xG where available), blended with ClubElo early in the season.
- Then it adjusts for form, injuries, weather and rest.
- Scorelines use Poisson with the Dixon–Coles correction.
- Tips blend our expected goals 50/50 with the ones the bookmakers' prices imply. The value finder uses the pure model.
- Every prediction is saved in `data/history.json` before kick-off and graded against the result, which feeds the "How accurate is Tipsy?" panel.

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
- Each run makes about 9–13 football-data calls (about 1–2 minutes because of the 10/min limit).
- Odds are re-downloaded at most every 6 hours (8 credits each time, about 380 a month, inside the free 500). Odds are skipped automatically if fewer than 20 credits are left.
- If a run fails, the site keeps the last good data.

## Settings (optional repository variables)

| Name | Default | Meaning |
|---|---|---|
| `LEAGUES` | `PL,PD,BL1,FL1` | football-data.org competition codes (SA = Serie A) |

## Files

- `index.html` – the page and the model
- `scripts/build.mjs` – data builder (Node 22, no dependencies)
- `data/tips.json` – latest data (written by the Action)
- `model.js` – the prediction model (shared)
- `data/history.json` – saved predictions and results
- `data/cache.json` – cached stadium locations, ClubElo ratings and odds timestamps

## Best bets across all sports

`scripts/allsports.mjs` runs once a day (after the football build) and uses the free [OddsPapi](https://oddspapi.io) plan
(250 requests a month, secret `ODDSPAPI_KEY`). Each run makes 1 request for the fixture list and up to 5 odds requests
(5 competitions each, Pinnacle prices), and stops at 235 requests a month. Pinnacle's prices, with the margin removed,
give the chances shown on the **Best** tab. Football on that tab comes from Tipsy's own model.
Writes `data/allsports.json`; usage is tracked in `data/oddspapi-cache.json`.
