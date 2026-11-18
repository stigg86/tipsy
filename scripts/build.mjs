// Tipsy data builder
// Fetches Premier League data from API-Football and weather from Open-Meteo,
// then writes data/tips.json for the page. Runs in GitHub Actions (Node 20+).
//
// Env:
//   API_FOOTBALL_KEY  (required)  – your api-sports.io key, stored as a GitHub secret
//   LEAGUE            (optional)  – default 39 (Premier League)
//   SEASON            (optional)  – default: current season start year
//   MIN_LEFT          (optional)  – stop using the API when this many daily requests remain (default 10)
//   MAX_STATS         (optional)  – max match-stat (xG) lookups per run (default 40)

import fs from "node:fs/promises";

const KEY = process.env.API_FOOTBALL_KEY;
if (!KEY) { console.error("Missing API_FOOTBALL_KEY"); process.exit(1); }

const now = new Date();
const LEAGUE = process.env.LEAGUE || "39";
const SEASON = process.env.SEASON || String(now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
const MIN_LEFT = Number(process.env.MIN_LEFT || 10);
const MAX_STATS = Number(process.env.MAX_STATS || 40);
const BASE = "https://v3.football.api-sports.io";
const GAP_MS = 6500; // free plan allows ~10 requests/minute

const sleep = ms => new Promise(r => setTimeout(r, ms));
let remaining = Infinity, used = 0;

async function api(path, params = {}) {
  if (remaining <= MIN_LEFT) throw new Error(`quota guard: ${remaining} requests left`);
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (used > 0) await sleep(GAP_MS);
  const r = await fetch(url, { headers: { "x-apisports-key": KEY } });
  used++;
  const rem = r.headers.get("x-ratelimit-requests-remaining");
  if (rem !== null) remaining = Number(rem);
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors && (Array.isArray(j.errors) ? j.errors.length : Object.keys(j.errors).length))
    throw new Error(`${path}: ${JSON.stringify(j.errors)}`);
  console.log(`  ${path} ${JSON.stringify(params)} → ${j.results} results (${remaining} left today)`);
  return j.response;
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return r.json();
}

const SHORT = {
  "Manchester United": "Man Utd", "Manchester City": "Man City", "Nottingham Forest": "Nott'm Forest",
  "Tottenham Hotspur": "Tottenham", "Wolverhampton Wanderers": "Wolves", "Brighton & Hove Albion": "Brighton",
  "West Ham United": "West Ham", "Newcastle United": "Newcastle", "Leeds United": "Leeds",
  "Ipswich Town": "Ipswich", "Hull City": "Hull", "Coventry City": "Coventry", "Sheffield United": "Sheffield Utd",
  "Leicester City": "Leicester", "Norwich City": "Norwich", "Luton Town": "Luton", "AFC Bournemouth": "Bournemouth"
};
const short = n => SHORT[n] || n;

async function readJSON(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return fallback; }
}

function ukDate(iso) {
  const d = new Date(iso);
  return {
    d: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }),
    k: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
  };
}

function weatherKey(w) {
  if (!w) return "light";
  if (w.temp <= 1 || w.snow > 0) return "cold";
  if (w.wind >= 40) return "wind";
  if (w.precip >= 2) return "rain";
  if (w.precip >= 0.2) return "light";
  return "dry";
}

async function main() {
  const cache = await readJSON("data/cache.json", { stats: {}, geo: {} });
  const previous = await readJSON("data/tips.json", null);

  console.log(`League ${LEAGUE}, season ${SEASON}`);

  // 1) All finished league fixtures → table, home/away records, last-5 form
  const done = await api("/fixtures", { league: LEAGUE, season: SEASON, status: "FT-AET-PEN" });
  done.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));

  const teams = {}; // keyed by API team id
  const T = id => teams[id];
  const blank = () => [0, 0, 0];
  for (const f of done) {
    for (const side of ["home", "away"]) {
      const t = f.teams[side];
      teams[t.id] ??= { id: t.id, name: short(t.name), o: blank(), h: blank(), a: blank(), res: [], xgF: 0, xgA: 0, xgN: 0 };
    }
    const hg = f.goals.home ?? 0, ag = f.goals.away ?? 0;
    const H = T(f.teams.home.id), A = T(f.teams.away.id);
    H.o[0]++; H.o[1] += hg; H.o[2] += ag; H.h[0]++; H.h[1] += hg; H.h[2] += ag;
    A.o[0]++; A.o[1] += ag; A.o[2] += hg; A.a[0]++; A.a[1] += ag; A.a[2] += hg;
    H.res.push(hg > ag ? "W" : hg === ag ? "D" : "L");
    A.res.push(ag > hg ? "W" : ag === hg ? "D" : "L");
  }

  // 2) Upcoming fixtures (next round)
  let next = await api("/fixtures", { league: LEAGUE, season: SEASON, next: 10 });
  next.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
  if (next.length) {
    const round = next[0].league.round;
    next = next.filter(f => f.league.round === round);
  }
  for (const f of next) for (const side of ["home", "away"]) {
    const t = f.teams[side];
    teams[t.id] ??= { id: t.id, name: short(t.name), o: blank(), h: blank(), a: blank(), res: [], xgF: 0, xgA: 0, xgN: 0 };
  }

  // 3) Top scorers & assisters → key players per team
  const players = {};
  const addPlayers = list => {
    for (const p of list || []) {
      const s = p.statistics?.[0]; if (!s) continue;
      if (String(s.league?.id) !== String(LEAGUE)) continue;
      const team = short(s.team.name);
      players[team] ??= [];
      if (players[team].some(x => x.id === p.player.id)) continue;
      players[team].push({ id: p.player.id, name: p.player.name, g: s.goals?.total || 0, a: s.goals?.assists || 0, apps: s.games?.appearences || 0 });
    }
  };
  try {
    addPlayers(await api("/players/topscorers", { league: LEAGUE, season: SEASON }));
    addPlayers(await api("/players/topassists", { league: LEAGUE, season: SEASON }));
  } catch (e) { console.warn("players:", e.message); if (previous?.players) Object.assign(players, previous.players); }
  for (const k of Object.keys(players)) {
    players[k].sort((x, y) => (y.g + y.a) - (x.g + x.a));
    players[k] = players[k].slice(0, 4);
  }

  // 4) Injuries for each upcoming fixture
  const injuries = {};
  for (const f of next) {
    try {
      const list = await api("/injuries", { fixture: f.fixture.id });
      injuries[f.fixture.id] = list.filter(i => i.player?.type === "Missing Fixture");
    } catch (e) { console.warn("injuries:", e.message); break; }
  }

  // 5) Match xG from fixture statistics (cached; fills in gradually within the daily quota)
  let fetched = 0;
  const todo = done.filter(f => !(f.fixture.id in cache.stats)).reverse(); // newest first
  for (const f of todo) {
    if (fetched >= MAX_STATS || remaining <= MIN_LEFT + 2) break;
    try {
      const st = await api("/fixtures/statistics", { fixture: f.fixture.id });
      const rec = {};
      for (const side of st) {
        const xg = side.statistics?.find(s => s.type === "expected_goals")?.value;
        rec[side.team.id] = xg == null ? null : Number(xg);
      }
      cache.stats[f.fixture.id] = Object.values(rec).every(v => v != null) && Object.keys(rec).length === 2 ? rec : null;
      fetched++;
    } catch (e) { console.warn("stats:", e.message); break; }
  }
  for (const f of done) {
    const rec = cache.stats[f.fixture.id]; if (!rec) continue;
    const h = f.teams.home.id, a = f.teams.away.id;
    T(h).xgF += rec[h]; T(h).xgA += rec[a]; T(h).xgN++;
    T(a).xgF += rec[a]; T(a).xgA += rec[h]; T(a).xgN++;
  }

  // 6) Weather at kick-off (Open-Meteo, no key)
  const weather = {};
  for (const f of next) {
    const city = f.fixture.venue?.city; if (!city) continue;
    try {
      if (!cache.geo[city]) {
        const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.split(",")[0])}&count=1&countryCode=GB`);
        if (g.results?.[0]) cache.geo[city] = [g.results[0].latitude, g.results[0].longitude];
      }
      const ll = cache.geo[city]; if (!ll) continue;
      const ko = new Date(f.fixture.date);
      const day = ko.toISOString().slice(0, 10);
      const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${ll[0]}&longitude=${ll[1]}&hourly=temperature_2m,precipitation,snowfall,wind_speed_10m&start_date=${day}&end_date=${day}&timezone=GMT`);
      const hour = ko.getUTCHours();
      const i = w.hourly?.time?.findIndex(t => Number(t.slice(11, 13)) === hour);
      if (i >= 0) weather[f.fixture.id] = {
        temp: Math.round(w.hourly.temperature_2m[i]),
        precip: Math.round(w.hourly.precipitation[i] * 10) / 10,
        snow: w.hourly.snowfall[i] || 0,
        wind: Math.round(w.hourly.wind_speed_10m[i])
      };
    } catch (e) { console.warn("weather:", city, e.message); }
  }

  // 7) Write output
  const outTeams = {};
  for (const t of Object.values(teams)) {
    outTeams[t.name] = {
      o: t.o, h: t.h, a: t.a, f: t.res.slice(-5).join(""),
      xg: t.xgN >= 3 ? [+(t.xgF / t.xgN).toFixed(2), +(t.xgA / t.xgN).toFixed(2)] : null
    };
  }
  const matches = next.map((f, i) => {
    const h = short(f.teams.home.name), a = short(f.teams.away.name);
    const inj = injuries[f.fixture.id] || [];
    const side = id => {
      const list = inj.filter(x => x.team.id === id);
      const names = list.map(x => x.player.name);
      const keyIds = new Set((players[short(id === f.teams.home.id ? f.teams.home.name : f.teams.away.name)] || []).map(p => p.id));
      const keyNames = list.filter(x => keyIds.has(x.player.id)).map(x => x.player.name);
      return { players: keyNames, others: Math.max(0, Math.min(3, list.length - keyNames.length)), all: names };
    };
    const wx = weather[f.fixture.id] || null;
    return {
      id: f.fixture.id, date: f.fixture.date, ...ukDate(f.fixture.date),
      h, a, v: f.fixture.venue?.name || "", w: weatherKey(wx), wx,
      inj: { h: side(f.teams.home.id), a: side(f.teams.away.id) }
    };
  });
  // players file uses names the page shows
  const outPlayers = {};
  for (const [team, list] of Object.entries(players)) outPlayers[team] = list.map(({ id, name, g, a, apps }) => ({ id, name, g, a, apps }));

  const withXg = Object.values(outTeams).filter(t => t.xg).length;
  const data = {
    updated: new Date().toISOString(), mode: "live", season: SEASON,
    round: next[0]?.league.round || previous?.round || "",
    sources: [
      `API-Football (fixtures, table, form, players, injuries; xG for ${withXg}/${Object.keys(outTeams).length} teams)`,
      "Open-Meteo (kick-off weather)"
    ],
    teams: outTeams, players: outPlayers, matches
  };

  if (!matches.length && previous) { console.warn("No upcoming fixtures found; keeping previous matches."); data.matches = previous.matches; }

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile("data/tips.json", JSON.stringify(data, null, 1));
  await fs.writeFile("data/cache.json", JSON.stringify(cache));
  console.log(`Done: ${matches.length} matches, ${Object.keys(outTeams).length} teams, ${used} API requests, ${remaining} left today.`);
}

main().catch(e => { console.error(e); process.exit(1); });
