// Tipsy data builder
// Fetches league data from API-Football and kick-off weather from Open-Meteo,
// then writes data/tips.json for the page. Runs in GitHub Actions (Node 20+).
//
// Env:
//   API_FOOTBALL_KEY  (required)  – your api-sports.io key, stored as a GitHub secret
//   LEAGUES           (optional)  – comma list of API-Football league ids (default 39,140,78,61)
//   SEASON            (optional)  – default: current season start year
//   MIN_LEFT          (optional)  – stop using the API when this many daily requests remain (default 8)

import fs from "node:fs/promises";

const KEY = process.env.API_FOOTBALL_KEY;
if (!KEY) { console.error("Missing API_FOOTBALL_KEY"); process.exit(1); }

const now = new Date();
const LEAGUES = (process.env.LEAGUES || "39,140,78,61").split(",").map(s => s.trim()).filter(Boolean);
const SEASON = process.env.SEASON || String(now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
const MIN_LEFT = Number(process.env.MIN_LEFT || 8);
const BASE = "https://v3.football.api-sports.io";
const GAP_MS = 6500; // free plan allows ~10 requests/minute

const LEAGUE_INFO = {
  39: { name: "Premier League", country: "GB" },
  140: { name: "La Liga", country: "ES" },
  78: { name: "Bundesliga", country: "DE" },
  61: { name: "Ligue 1", country: "FR" },
  135: { name: "Serie A", country: "IT" }
};

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
  "Leicester City": "Leicester", "Norwich City": "Norwich", "Luton Town": "Luton", "AFC Bournemouth": "Bournemouth",
  "Paris Saint Germain": "PSG", "Bayern München": "Bayern", "Bayern Munich": "Bayern",
  "Borussia Dortmund": "Dortmund", "Borussia Mönchengladbach": "M'gladbach", "Bayer Leverkusen": "Leverkusen",
  "Atletico Madrid": "Atlético", "Athletic Club": "Athletic", "Real Sociedad": "Real Sociedad"
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

const statVal = (arr, type) => {
  const v = arr?.find(s => s.type === type)?.value;
  if (v == null) return null;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : null;
};

// one league → { id, name, round, teams, players, matches } ; uses and updates cache
async function buildLeague(id, cache, prevLeague) {
  const info = LEAGUE_INFO[id] || { name: `League ${id}`, country: "" };
  console.log(`\n== ${info.name} (${id}) season ${SEASON}`);

  const done = await api("/fixtures", { league: id, season: SEASON, status: "FT-AET-PEN" });
  done.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));

  let next = await api("/fixtures", { league: id, season: SEASON, next: 15 });
  next.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
  if (next.length) { const r = next[0].league.round; next = next.filter(f => f.league.round === r); }

  const teams = {};
  const blank = () => [0, 0, 0];
  const ensure = t => (teams[t.id] ??= { id: t.id, name: short(t.name), o: blank(), h: blank(), a: blank(), res: [],
    xg: [0, 0, 0], cn: [0, 0, 0], cd: [0, 0, 0] });
  for (const f of [...done, ...next]) { ensure(f.teams.home); ensure(f.teams.away); }
  for (const f of done) {
    const hg = f.goals.home ?? 0, ag = f.goals.away ?? 0;
    const H = teams[f.teams.home.id], A = teams[f.teams.away.id];
    H.o[0]++; H.o[1] += hg; H.o[2] += ag; H.h[0]++; H.h[1] += hg; H.h[2] += ag;
    A.o[0]++; A.o[1] += ag; A.o[2] += hg; A.a[0]++; A.a[1] += ag; A.a[2] += hg;
    H.res.push(hg > ag ? "W" : hg === ag ? "D" : "L");
    A.res.push(ag > hg ? "W" : ag === hg ? "D" : "L");
  }

  // Players (top scorers + assisters)
  const players = {};
  const addPlayers = list => {
    for (const p of list || []) {
      const s = p.statistics?.[0]; if (!s) continue;
      const team = short(s.team.name);
      players[team] ??= [];
      if (players[team].some(x => x.id === p.player.id)) continue;
      players[team].push({ id: p.player.id, name: p.player.name, g: s.goals?.total || 0, a: s.goals?.assists || 0, apps: s.games?.appearences || 0 });
    }
  };
  try {
    addPlayers(await api("/players/topscorers", { league: id, season: SEASON }));
    addPlayers(await api("/players/topassists", { league: id, season: SEASON }));
  } catch (e) { console.warn("players:", e.message); if (prevLeague?.players) Object.assign(players, prevLeague.players); }
  for (const k of Object.keys(players)) {
    players[k].sort((x, y) => (y.g + y.a) - (x.g + x.a));
    players[k] = players[k].slice(0, 4);
  }

  // Injuries (one call for the whole league, filtered to upcoming fixtures)
  const upcomingIds = new Set(next.map(f => f.fixture.id));
  const injuries = {};
  try {
    const list = await api("/injuries", { league: id, season: SEASON });
    for (const i of list) {
      if (!upcomingIds.has(i.fixture?.id) || i.player?.type !== "Missing Fixture") continue;
      (injuries[i.fixture.id] ??= []).push(i);
    }
  } catch (e) { console.warn("injuries:", e.message); }

  // Match stats (xG, corners, cards) – batched 20 fixtures per request, cached forever
  const todo = done.filter(f => !(f.fixture.id in cache.stats)).reverse().map(f => f.fixture.id);
  for (let i = 0; i < todo.length; i += 20) {
    if (remaining <= MIN_LEFT + 2) { console.warn("stats: stopping early to protect quota"); break; }
    const chunk = todo.slice(i, i + 20);
    try {
      const list = await api("/fixtures", { ids: chunk.join("-") });
      const seen = new Set();
      for (const f of list) {
        seen.add(f.fixture.id);
        if (!Array.isArray(f.statistics) || f.statistics.length !== 2) { cache.stats[f.fixture.id] = null; continue; }
        const rec = {};
        for (const side of f.statistics) {
          rec[side.team.id] = {
            xg: statVal(side.statistics, "expected_goals"),
            c: statVal(side.statistics, "Corner Kicks"),
            y: statVal(side.statistics, "Yellow Cards"),
            r: statVal(side.statistics, "Red Cards")
          };
        }
        cache.stats[f.fixture.id] = rec;
      }
      for (const idx of chunk) if (!seen.has(idx)) cache.stats[idx] = null;
    } catch (e) { console.warn("stats:", e.message); break; }
  }
  for (const f of done) {
    const rec = cache.stats[f.fixture.id]; if (!rec) continue;
    const h = f.teams.home.id, a = f.teams.away.id;
    const H = teams[h], A = teams[a], rh = rec[h], ra = rec[a];
    if (!rh || !ra) continue;
    if (rh.xg != null && ra.xg != null) { H.xg[0] += rh.xg; H.xg[1] += ra.xg; H.xg[2]++; A.xg[0] += ra.xg; A.xg[1] += rh.xg; A.xg[2]++; }
    if (rh.c != null && ra.c != null) { H.cn[0] += rh.c; H.cn[1] += ra.c; H.cn[2]++; A.cn[0] += ra.c; A.cn[1] += rh.c; A.cn[2]++; }
    const kh = rh.y == null ? null : rh.y + (rh.r || 0), ka = ra.y == null ? null : ra.y + (ra.r || 0);
    if (kh != null && ka != null) { H.cd[0] += kh; H.cd[1] += ka; H.cd[2]++; A.cd[0] += ka; A.cd[1] += kh; A.cd[2]++; }
  }

  // Weather at kick-off (Open-Meteo, no key)
  const weather = {};
  for (const f of next) {
    const city = f.fixture.venue?.city; if (!city) continue;
    const gk = `${info.country}|${city}`;
    try {
      if (!cache.geo[gk]) {
        const q = encodeURIComponent(city.split(",")[0]);
        const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1${info.country ? "&countryCode=" + info.country : ""}`);
        if (g.results?.[0]) cache.geo[gk] = [g.results[0].latitude, g.results[0].longitude];
      }
      const ll = cache.geo[gk]; if (!ll) continue;
      const ko = new Date(f.fixture.date), day = ko.toISOString().slice(0, 10);
      const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${ll[0]}&longitude=${ll[1]}&hourly=temperature_2m,precipitation,snowfall,wind_speed_10m&start_date=${day}&end_date=${day}&timezone=GMT`);
      const i = w.hourly?.time?.findIndex(t => Number(t.slice(11, 13)) === ko.getUTCHours());
      if (i >= 0) weather[f.fixture.id] = {
        temp: Math.round(w.hourly.temperature_2m[i]),
        precip: Math.round(w.hourly.precipitation[i] * 10) / 10,
        snow: w.hourly.snowfall[i] || 0,
        wind: Math.round(w.hourly.wind_speed_10m[i])
      };
    } catch (e) { console.warn("weather:", city, e.message); }
  }

  // Output
  const per = (v, n) => n >= 3 ? [+(v[0] / n).toFixed(2), +(v[1] / n).toFixed(2)] : null;
  const outTeams = {};
  for (const t of Object.values(teams)) {
    outTeams[t.name] = { o: t.o, h: t.h, a: t.a, f: t.res.slice(-5).join(""),
      xg: per(t.xg, t.xg[2]), cn: per(t.cn, t.cn[2]), cd: per(t.cd, t.cd[2]) };
  }
  const matches = next.map(f => {
    const h = short(f.teams.home.name), a = short(f.teams.away.name);
    const inj = injuries[f.fixture.id] || [];
    const side = (teamId, teamName) => {
      const list = inj.filter(x => x.team.id === teamId);
      const keyIds = new Set((players[teamName] || []).map(p => p.id));
      const keyNames = list.filter(x => keyIds.has(x.player.id)).map(x => x.player.name);
      return { players: keyNames, others: Math.max(0, Math.min(3, list.length - keyNames.length)), all: list.map(x => x.player.name) };
    };
    const wx = weather[f.fixture.id] || null;
    return { id: f.fixture.id, date: f.fixture.date, ...ukDate(f.fixture.date), h, a, v: f.fixture.venue?.name || "",
      w: weatherKey(wx), wx, inj: { h: side(f.teams.home.id, h), a: side(f.teams.away.id, a) } };
  });

  const outPlayers = {};
  for (const [team, list] of Object.entries(players)) outPlayers[team] = list.map(({ id, name, g, a, apps }) => ({ id, name, g, a, apps }));

  return {
    id: Number(id), name: info.name, round: next[0]?.league.round || prevLeague?.round || "",
    teams: outTeams, players: outPlayers,
    matches: matches.length ? matches : (prevLeague?.matches || []),
    stats: { xg: Object.values(outTeams).filter(t => t.xg).length, corners: Object.values(outTeams).filter(t => t.cn).length }
  };
}

async function main() {
  const cache = await readJSON("data/cache.json", { stats: {}, geo: {} });
  cache.stats ??= {}; cache.geo ??= {};
  const previous = await readJSON("data/tips.json", null);
  const prevById = Object.fromEntries((previous?.leagues || []).map(l => [String(l.id), l]));

  const leagues = [];
  for (const id of LEAGUES) {
    try { leagues.push(await buildLeague(id, cache, prevById[id])); }
    catch (e) {
      console.warn(`League ${id} failed: ${e.message}`);
      if (prevById[id]) leagues.push(prevById[id]);
    }
  }
  if (!leagues.length) throw new Error("No league data built");

  const data = {
    updated: new Date().toISOString(), mode: "live", season: SEASON,
    sources: ["API-Football (fixtures, table, form, players, injuries, xG, corners, cards)", "Open-Meteo (kick-off weather)"],
    leagues
  };
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile("data/tips.json", JSON.stringify(data, null, 1));
  await fs.writeFile("data/cache.json", JSON.stringify(cache));
  console.log(`\nDone: ${leagues.map(l => `${l.name} ${l.matches.length} matches`).join(", ")}. ${used} API requests, ${remaining} left today.`);
}

main().catch(e => { console.error(e); process.exit(1); });
