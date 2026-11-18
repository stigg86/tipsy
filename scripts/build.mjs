// Tipsy data builder (free sources)
//   football-data.org  – fixtures, results, tables, top scorers, team addresses (free tier, current season)
//   The Odds API       – bookmaker odds for match result and goals over/under (free tier, 500 credits/month)
//   Open-Meteo         – kick-off weather (free, no key, non-commercial)
// Writes data/tips.json for the page. Runs in GitHub Actions (Node 20+).
//
// Env:
//   FOOTBALL_DATA_KEY  (required)  – football-data.org token (GitHub secret)
//   ODDS_API_KEY       (optional)  – the-odds-api.com key (GitHub secret); without it, no odds / value finder
//   LEAGUES            (optional)  – comma list of football-data codes (default PL,PD,BL1,FL1)
//   ODDS_MIN_LEFT      (optional)  – skip odds when fewer credits than this remain this month (default 20)

import fs from "node:fs/promises";

const FD_KEY = process.env.FOOTBALL_DATA_KEY;
const ODDS_KEY = process.env.ODDS_API_KEY || "";
if (!FD_KEY) { console.error("Missing FOOTBALL_DATA_KEY"); process.exit(1); }

const LEAGUES = (process.env.LEAGUES || "PL,PD,BL1,FL1").split(",").map(s => s.trim()).filter(Boolean);
const ODDS_MIN_LEFT = Number(process.env.ODDS_MIN_LEFT || 20);
const FD = "https://api.football-data.org/v4";
const ODDS = "https://api.the-odds-api.com/v4";
const GAP_MS = 6500; // football-data free plan: 10 requests/minute

const INFO = {
  PL:  { name: "Premier League", country: "GB", odds: "soccer_epl" },
  PD:  { name: "La Liga",        country: "ES", odds: "soccer_spain_la_liga" },
  BL1: { name: "Bundesliga",     country: "DE", odds: "soccer_germany_bundesliga" },
  FL1: { name: "Ligue 1",        country: "FR", odds: "soccer_france_ligue_one" },
  SA:  { name: "Serie A",        country: "IT", odds: "soccer_italy_serie_a" }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fdCalls = 0, oddsLeft = null, oddsUsed = 0;

async function fd(path, params = {}) {
  const url = new URL(FD + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (fdCalls > 0) await sleep(GAP_MS);
  fdCalls++;
  const r = await fetch(url, { headers: { "X-Auth-Token": FD_KEY } });
  if (!r.ok) {
    let msg = ""; try { msg = (await r.json()).message || ""; } catch {}
    throw new Error(`football-data ${path} HTTP ${r.status} ${msg}`);
  }
  console.log(`  football-data ${path}`);
  return r.json();
}

async function odds(sport) {
  const url = new URL(`${ODDS}/sports/${sport}/odds`);
  url.searchParams.set("apiKey", ODDS_KEY);
  url.searchParams.set("regions", "uk");
  url.searchParams.set("markets", "h2h,totals");
  url.searchParams.set("oddsFormat", "decimal");
  const r = await fetch(url);
  const left = r.headers.get("x-requests-remaining");
  if (left !== null) oddsLeft = Number(left);
  if (!r.ok) throw new Error(`odds ${sport} HTTP ${r.status}`);
  oddsUsed += Number(r.headers.get("x-requests-last") || 2);
  const j = await r.json();
  console.log(`  odds ${sport} → ${j.length} events (${oddsLeft} credits left this month)`);
  return j;
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return r.json();
}
async function readJSON(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return fallback; }
}

const SHORT = {
  "Man United": "Man Utd", "Nottingham": "Nott'm Forest", "Brighton Hove": "Brighton", "Wolverhampton": "Wolves",
  "Tottenham": "Tottenham", "Bayern München": "Bayern", "Paris Saint-Germain": "PSG", "Paris SG": "PSG",
  "Atleti": "Atlético", "Athletic": "Athletic", "Leverkusen": "Leverkusen", "Dortmund": "Dortmund", "M'gladbach": "M'gladbach"
};
const teamName = t => SHORT[t.shortName] || t.shortName || t.name;

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

// --- team-name matching between football-data and The Odds API ---
const STOP = new Set(["fc","afc","cf","sc","ac","as","ssc","rc","rcd","ogc","club","de","del","la","the","and","calcio","sv","vfb","vfl","tsg","fsv","1","04","05","1899","1846","1909","1910","stade","sport","us","ud","cd","sd","ca"]);
const ALIAS = { munich: "munchen", wolves: "wolverhampton", spurs: "tottenham", psg: "paris", inter: "internazionale", man: "manchester", utd: "united", nottm: "nottingham", "saint": "st" };
function tokens(name) {
  return String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .map(t => ALIAS[t] || t).filter(t => t && !STOP.has(t));
}
function sim(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}

function parseOdds(ev, homeName, awayName) {
  const best = {}, all = {};
  const put = (key, price, book) => {
    if (!(price > 1)) return;
    (all[key] ??= []).push(price);
    if (!best[key] || price > best[key].b) best[key] = { b: price, k: book };
  };
  for (const bm of ev.bookmakers || []) {
    for (const mk of bm.markets || []) {
      if (mk.key === "h2h") {
        for (const o of mk.outcomes || []) {
          if (o.name === "Draw") put("X", o.price, bm.title);
          else if (o.name === ev.home_team) put("1", o.price, bm.title);
          else if (o.name === ev.away_team) put("2", o.price, bm.title);
        }
      } else if (mk.key === "totals") {
        for (const o of mk.outcomes || []) {
          const line = Number(o.point);
          if (![1.5, 2.5, 3.5].includes(line)) continue;
          const k = (o.name === "Over" ? "O" : "U") + String(line).replace(".", "");
          put(k, o.price, bm.title);
        }
      }
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(best)) {
    const arr = all[k];
    out[k] = { b: v.b, k: v.k, a: +(arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(3), n: arr.length };
  }
  return Object.keys(out).length ? out : null;
}

async function buildLeague(code, cache, prev) {
  const info = INFO[code] || { name: code, country: "", odds: null };
  console.log(`\n== ${info.name} (${code})`);

  const { matches } = await fd(`/competitions/${code}/matches`);
  const done = matches.filter(m => m.status === "FINISHED" && m.score?.fullTime?.home != null)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  const open = matches.filter(m => ["SCHEDULED", "TIMED"].includes(m.status) && new Date(m.utcDate) > new Date())
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  const md = open[0]?.matchday;
  const next = open.filter(m => m.matchday === md);

  // Teams (addresses for weather) – refreshed weekly
  const tc = cache.teams[code];
  if (!tc || Date.now() - tc.at > 7 * 864e5) {
    try {
      const { teams } = await fd(`/competitions/${code}/teams`);
      cache.teams[code] = { at: Date.now(), list: teams.map(t => ({ id: t.id, address: t.address || "", venue: t.venue || "" })) };
    } catch (e) { console.warn("teams:", e.message); }
  }
  const addr = Object.fromEntries((cache.teams[code]?.list || []).map(t => [t.id, t]));

  // Top scorers (goals + assists)
  const players = {};
  try {
    const { scorers } = await fd(`/competitions/${code}/scorers`, { limit: 40 });
    for (const s of scorers || []) {
      const team = teamName(s.team);
      (players[team] ??= []).push({ id: s.player.id, name: s.player.name, g: s.goals || 0, a: s.assists || 0, apps: s.playedMatches || 0 });
    }
    for (const k of Object.keys(players)) players[k] = players[k].sort((x, y) => (y.g + y.a) - (x.g + x.a)).slice(0, 4);
  } catch (e) { console.warn("scorers:", e.message); Object.assign(players, prev?.players || {}); }

  // Table, home/away records, form
  const T = {};
  const blank = () => [0, 0, 0];
  const ensure = t => (T[t.id] ??= { name: teamName(t), o: blank(), h: blank(), a: blank(), res: [] });
  for (const m of [...done, ...next]) { ensure(m.homeTeam); ensure(m.awayTeam); }
  for (const m of done) {
    const hg = m.score.fullTime.home, ag = m.score.fullTime.away, H = T[m.homeTeam.id], A = T[m.awayTeam.id];
    H.o[0]++; H.o[1] += hg; H.o[2] += ag; H.h[0]++; H.h[1] += hg; H.h[2] += ag;
    A.o[0]++; A.o[1] += ag; A.o[2] += hg; A.a[0]++; A.a[1] += ag; A.a[2] += hg;
    H.res.push(hg > ag ? "W" : hg === ag ? "D" : "L");
    A.res.push(ag > hg ? "W" : ag === hg ? "D" : "L");
  }

  // Weather at kick-off
  const weather = {};
  for (const m of next) {
    const a = addr[m.homeTeam.id]; if (!a?.address) continue;
    const words = a.address.split(/\s+/).filter(w => /^[\p{L}'-]+$/u.test(w) && w.length > 2);
    const tries = [words.slice(-1).join(" "), words.slice(-2).join(" ")].filter(Boolean);
    const gk = `${info.country}|${m.homeTeam.id}`;
    try {
      for (const q of tries) {
        if (cache.geo[gk]) break;
        const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1${info.country ? "&countryCode=" + info.country : ""}`);
        if (g.results?.[0]) cache.geo[gk] = [g.results[0].latitude, g.results[0].longitude];
      }
      const ll = cache.geo[gk]; if (!ll) continue;
      const ko = new Date(m.utcDate), day = ko.toISOString().slice(0, 10);
      const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${ll[0]}&longitude=${ll[1]}&hourly=temperature_2m,precipitation,snowfall,wind_speed_10m&start_date=${day}&end_date=${day}&timezone=GMT`);
      const i = w.hourly?.time?.findIndex(t => Number(t.slice(11, 13)) === ko.getUTCHours());
      if (i >= 0) weather[m.id] = { temp: Math.round(w.hourly.temperature_2m[i]), precip: Math.round(w.hourly.precipitation[i] * 10) / 10,
        snow: w.hourly.snowfall[i] || 0, wind: Math.round(w.hourly.wind_speed_10m[i]) };
    } catch (e) { console.warn("weather:", e.message); }
  }

  // Bookmaker odds
  const oddsByMatch = {};
  if (ODDS_KEY && info.odds && next.length) {
    if (oddsLeft !== null && oddsLeft < ODDS_MIN_LEFT) console.warn(`odds: skipped, only ${oddsLeft} credits left this month`);
    else {
      try {
        const events = await odds(info.odds);
        for (const ev of events) {
          let bestM = null, bestS = 0;
          for (const m of next) {
            if (Math.abs(new Date(ev.commence_time) - new Date(m.utcDate)) > 6 * 3600e3) continue;
            const sh = Math.max(sim(ev.home_team, m.homeTeam.name), sim(ev.home_team, m.homeTeam.shortName || ""));
            const sa = Math.max(sim(ev.away_team, m.awayTeam.name), sim(ev.away_team, m.awayTeam.shortName || ""));
            if (sh >= .5 && sa >= .5 && sh + sa >= 1.5 && sh + sa > bestS) { bestS = sh + sa; bestM = m; }
          }
          if (bestM) { const o = parseOdds(ev); if (o) oddsByMatch[bestM.id] = o; }
        }
        console.log(`  odds matched for ${Object.keys(oddsByMatch).length}/${next.length} matches`);
      } catch (e) { console.warn("odds:", e.message); }
    }
  }

  const teams = {};
  for (const t of Object.values(T)) teams[t.name] = { o: t.o, h: t.h, a: t.a, f: t.res.slice(-5).join(""), xg: null, cn: null, cd: null };
  const outMatches = next.map(m => {
    const wx = weather[m.id] || null;
    return { id: m.id, date: m.utcDate, ...ukDate(m.utcDate), h: teamName(m.homeTeam), a: teamName(m.awayTeam),
      v: addr[m.homeTeam.id]?.venue || "", w: weatherKey(wx), wx, odds: oddsByMatch[m.id] || null,
      inj: { h: { players: [], others: 0, all: [] }, a: { players: [], others: 0, all: [] } } };
  });

  return { code, name: info.name, round: md ? `Matchday ${md}` : (prev?.round || ""), teams,
    players: Object.keys(players).length ? players : (prev?.players || {}),
    matches: outMatches.length ? outMatches : (prev?.matches || []) };
}

async function main() {
  const cache = await readJSON("data/cache.json", {});
  cache.teams ??= {}; cache.geo ??= {};
  delete cache.stats; // left over from the API-Football version
  const previous = await readJSON("data/tips.json", null);
  const prevBy = Object.fromEntries((previous?.leagues || []).map(l => [l.code || l.name, l]));

  const leagues = [];
  for (const code of LEAGUES) {
    const name = INFO[code]?.name;
    try { leagues.push(await buildLeague(code, cache, prevBy[code] || prevBy[name])); }
    catch (e) {
      console.warn(`League ${code} failed: ${e.message}`);
      const p = prevBy[code] || prevBy[name]; if (p) leagues.push(p);
    }
  }
  if (!leagues.length) throw new Error("No league data built");

  const data = {
    updated: new Date().toISOString(), mode: "live",
    sources: ["football-data.org (fixtures, results, tables, scorers)",
      ODDS_KEY ? "The Odds API (UK bookmaker odds)" : "Odds: not configured",
      "Open-Meteo (kick-off weather)"],
    oddsCreditsLeft: oddsLeft,
    leagues
  };
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile("data/tips.json", JSON.stringify(data, null, 1));
  await fs.writeFile("data/cache.json", JSON.stringify(cache));
  console.log(`\nDone: ${leagues.map(l => `${l.name} ${l.matches.length}`).join(", ")}. football-data calls ${fdCalls}, odds credits used ${oddsUsed}${oddsLeft !== null ? `, ${oddsLeft} left this month` : ""}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
