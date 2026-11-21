// Tipsy data builder (free sources)
//   football-data.org  – fixtures, results, tables, top scorers, team addresses (free tier, current season)
//   The Odds API       – bookmaker odds for match result and goals over/under (free tier, 500 credits/month)
//   Open-Meteo         – kick-off weather (free, no key, non-commercial)
//   Fantasy Premier League feed – Premier League injuries/suspensions, chance of playing, player xG (free, no key)
//   ClubElo            – long-run team strength ratings (free CSV, no key)
// Writes data/tips.json for the page. Runs in GitHub Actions (Node 20+).
//
// Env:
//   FOOTBALL_DATA_KEY  (required)  – football-data.org token (GitHub secret)
//   ODDS_API_KEY       (optional)  – the-odds-api.com key (GitHub secret); without it, no odds / value finder
//   LEAGUES            (optional)  – comma list of football-data codes (default PL,PD,BL1,FL1)
//   ODDS_MIN_LEFT      (optional)  – skip odds when fewer credits than this remain this month (default 20)

import fs from "node:fs/promises";
import "../model.js"; // shared prediction model (sets globalThis.TipsyModel)
const TM = globalThis.TipsyModel;

const FD_KEY = process.env.FOOTBALL_DATA_KEY;
const ODDS_KEY = process.env.ODDS_API_KEY || "";
if (!FD_KEY) { console.error("Missing FOOTBALL_DATA_KEY"); process.exit(1); }

const LEAGUES = (process.env.LEAGUES || "PL,PD,BL1,FL1,SA,CL").split(",").map(s => s.trim()).filter(Boolean);
const ODDS_MIN_LEFT = Number(process.env.ODDS_MIN_LEFT || 20);
const FD = "https://api.football-data.org/v4";
const ODDS = "https://api.the-odds-api.com/v4";
const GAP_MS = 6500; // football-data free plan: 10 requests/minute

const INFO = {
  PL:  { name: "Premier League", country: "GB", odds: "soccer_epl" },
  PD:  { name: "La Liga",        country: "ES", odds: "soccer_spain_la_liga" },
  BL1: { name: "Bundesliga",     country: "DE", odds: "soccer_germany_bundesliga" },
  FL1: { name: "Ligue 1",        country: "FR", odds: "soccer_france_ligue_one" },
  SA:  { name: "Serie A",        country: "IT", odds: "soccer_italy_serie_a" },
  CL:  { name: "Champions League", country: "", odds: "soccer_uefa_champs_league" }
};

const FPL_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
let FPL = null; // loaded once if the Premier League is included

async function loadFPL() {
  try {
    const r = await fetch(FPL_URL, { headers: { "User-Agent": "Mozilla/5.0 (Tipsy football tips; GitHub Actions)" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    console.log(`  FPL feed: ${j.elements?.length} players, ${j.teams?.length} teams`);
    return j;
  } catch (e) { console.warn("FPL feed:", e.message); return null; }
}

// --- ClubElo ---
const ELO_COUNTRY = { PL: "ENG", PD: "ESP", BL1: "GER", FL1: "FRA", SA: "ITA" };
const ELO_ALIAS = { "Paris SG": "Paris Saint-Germain", "Bilbao": "Athletic Club", "Gladbach": "Borussia Monchengladbach",
  "Koeln": "Koln", "Forest": "Nottingham Forest", "Lyon": "Olympique Lyonnais", "Rennes": "Stade Rennais", "Brest": "Stade Brestois",
  "Hamburg": "Hamburger", "Man City": "Manchester City", "Man United": "Manchester United", "Sociedad": "Real Sociedad",
  "Betis": "Real Betis", "Atletico": "Atletico Madrid", "Celta": "Celta Vigo", "Leverkusen": "Bayer Leverkusen",
  "Frankfurt": "Eintracht Frankfurt", "Werder": "Werder Bremen", "Wolves": "Wolverhampton", "Inter": "Internazionale",
  "Saint-Etienne": "Saint Etienne", "Sporting": "Sporting CP" };
async function loadElo(cache) {
  const day = new Date().toISOString().slice(0, 10);
  for (const [i, base] of ["http://api.clubelo.com/", "https://api.clubelo.com/", "http://api.clubelo.com/", "http://clubelo.com/API/"].entries()) {
    if (i) await sleep(4000 * i);
    try {
      const r = await fetch(base + day, { headers: { "User-Agent": "Mozilla/5.0 (Tipsy football tips; GitHub Actions)" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lines = (await r.text()).trim().split(/\r?\n/);
      const head = lines.shift().split(",");
      const ix = k => head.indexOf(k);
      const rows = lines.map(l => l.split(",")).map(c => ({ club: c[ix("Club")], country: c[ix("Country")], level: Number(c[ix("Level")]), elo: Number(c[ix("Elo")]) }))
        .filter(x => x.club && x.elo > 0);
      if (rows.length < 100) throw new Error(`only ${rows.length} rows`);
      console.log(`  ClubElo: ${rows.length} clubs`);
      cache.elo = { day, rows: rows.filter(x => Object.values(ELO_COUNTRY).includes(x.country)) };
      return rows;
    } catch (e) { console.warn("ClubElo:", base, e.message); }
  }
  if (cache.elo?.rows?.length) { console.warn(`ClubElo: using saved ratings from ${cache.elo.day}`); return cache.elo.rows; }
  return null;
}
let ELO = null, CL = null;
// one-to-one match of ClubElo clubs to this league's teams
// ---------- corners & cards: Football-Data.co.uk season CSVs (free, updated a few times a week) ----------
const FDUK = { PL: "E0", PD: "SP1", BL1: "D1", FL1: "F1", SA: "I1" };
const FDUK_ALIAS = { "Nott'm Forest": "Nottingham Forest", "Man City": "Manchester City", "Man United": "Manchester United", "Ath Bilbao": "Athletic Club",
  "Ath Madrid": "Atletico Madrid", "Sociedad": "Real Sociedad", "Vallecano": "Rayo Vallecano", "Espanol": "Espanyol", "Celta": "Celta Vigo", "Betis": "Real Betis",
  "M'gladbach": "Borussia Monchengladbach", "Ein Frankfurt": "Eintracht Frankfurt", "FC Koln": "Koln", "Paris SG": "Paris Saint-Germain", "Sheffield United": "Sheffield United",
  "La Coruna": "Deportivo La Coruna", "Sp Gijon": "Sporting Gijon", "Bayern Munich": "Bayern Munchen" };
async function loadMatchStats(code, fdTeams, cache) {
  const div = FDUK[code]; if (!div) return {};
  const now = new Date(), y = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const season = `${String(y).slice(2)}${String(y + 1).slice(2)}`;
  cache.fduk ??= {};
  let rows = null;
  try {
    const r = await fetch(`https://www.football-data.co.uk/mmz4281/${season}/${div}.csv`);
    if (r.ok) {
      const lines = (await r.text()).replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
      const head = lines[0].split(","), ix = k => head.indexOf(k);
      const need = ["HomeTeam", "AwayTeam", "HC", "AC", "HY", "AY", "HR", "AR"];
      if (need.every(k => ix(k) >= 0)) {
        rows = lines.slice(1).map(l => l.split(",")).filter(c => c[ix("HC")] !== "" && c[ix("HC")] !== undefined)
          .map(c => ({ h: c[ix("HomeTeam")], a: c[ix("AwayTeam")], hc: +c[ix("HC")], ac: +c[ix("AC")], hk: +c[ix("HY")] + +c[ix("HR")], ak: +c[ix("AY")] + +c[ix("AR")] }))
          .filter(x => [x.hc, x.ac, x.hk, x.ak].every(Number.isFinite));
        cache.fduk[code] = { at: new Date().toISOString(), rows };
      }
    } else console.warn(`  corners/cards: Football-Data.co.uk ${div} → ${r.status}`);
  } catch (e) { console.warn(`  corners/cards: ${e.message}`); }
  if (!rows) rows = cache.fduk[code]?.rows || null;
  if (!rows?.length) return {};
  // per-team totals, then shrink towards the league average (3 games' worth) so early-season numbers stay sensible
  const S = {}, add = (t, cf, ca, kf, ka) => { const x = S[t] ??= { n: 0, cf: 0, ca: 0, kf: 0, ka: 0 }; x.n++; x.cf += cf; x.ca += ca; x.kf += kf; x.ka += ka; };
  for (const g of rows) { add(g.h, g.hc, g.ac, g.hk, g.ak); add(g.a, g.ac, g.hc, g.ak, g.hk); }
  const L = rows.length, avgC = rows.reduce((t, g) => t + g.hc + g.ac, 0) / L / 2, avgK = rows.reduce((t, g) => t + g.hk + g.ak, 0) / L / 2, K = 3;
  const shr = (sum, n, avg) => +((sum + K * avg) / (n + K)).toFixed(2);
  // match Football-Data.co.uk names ("Man City", "Ath Bilbao") to football-data.org teams, one to one
  const pairs = [];
  for (const t of fdTeams) for (const name of Object.keys(S)) {
    const full = FDUK_ALIAS[name] || ELO_ALIAS[name] || name;
    const sc = Math.max(sim(full, t.name), sim(full, t.shortName || ""));
    if (sc >= .5) pairs.push({ t: t.id, name, sc: sc + Math.max(jac(full, t.name), jac(full, t.shortName || "")) });
  }
  pairs.sort((a, b) => b.sc - a.sc);
  const out = {}, used = new Set();
  for (const p of pairs) { if (out[p.t] || used.has(p.name)) continue; used.add(p.name);
    const x = S[p.name]; out[p.t] = { cn: [shr(x.cf, x.n, avgC), shr(x.ca, x.n, avgC)], cd: [shr(x.kf, x.n, avgK), shr(x.ka, x.n, avgK)] }; }
  const missing = fdTeams.filter(t => !out[t.id]).map(t => t.shortName || t.name);
  console.log(`  corners/cards: ${L} matches, ${Object.keys(out).length}/${fdTeams.length} teams${missing.length ? " (no match: " + missing.join(", ") + ")" : ""}`);
  return out;
}

// ---------- shots-based xG for every league: Big Balls Sports Data (free plan, football, 1,000 requests a day) ----------
// One request per finished match for its stats (cached forever), so the first run backfills and later runs only add new games.
const BBS_KEY = process.env.BIGBALLS_KEY;
const BBS_LEAGUE = { PL: "epl", PD: "laliga", BL1: "bundesliga", FL1: "ligue1", SA: "seriea", CL: "ucl" };
const BBS_RUN_CAP = 420;              // stats requests per run, at most (shared across leagues)
let BBS = null, bbsUsed = 0;
async function bbsGet(path) {
  bbsUsed++;
  const r = await fetch("https://api.bigballsdata.com" + path, { headers: { Authorization: "Bearer " + BBS_KEY } }).catch(() => null);
  await new Promise(res => setTimeout(res, 700)); // 100 a minute allowed
  if (!r) return null;
  if (r.status === 429) { console.warn("  shots: Big Balls rate limit reached, carrying on next run"); bbsUsed = 1e9; return null; }
  return r.ok ? r.json().catch(() => null) : null;
}
async function loadShots(code, done, fdTeams) {
  const lg = BBS_LEAGUE[code]; if (!BBS_KEY || !lg) return {};
  BBS ??= await readJSON("data/bbs-cache.json", { matches: {} });
  // 1) the league's finished matches (newest 100, plus any older dates we still need)
  const listed = new Map();
  const add = rows => { for (const m of rows || []) if (m.status === "finished" && m.home && m.away) listed.set(m.id, m); };
  const j = await bbsGet(`/v1/matches?sport=football&league=${lg}&status=finished&limit=100`); add(j?.data);
  const day = d => new Date(d).toISOString().slice(0, 10);
  const haveDays = new Set([...listed.values()].map(m => day(m.kickoff_utc)));
  const cachedDays = new Set(Object.values(BBS.matches).filter(x => x.lg === lg).map(x => x.day));
  for (const d of [...new Set(done.map(m => day(m.utcDate)))].filter(d => !haveDays.has(d) && !cachedDays.has(d))) {
    if (bbsUsed > BBS_RUN_CAP) break;
    const k = await bbsGet(`/v1/matches?sport=football&league=${lg}&date=${d}&limit=50`); add(k?.data);
  }
  // 2) stats for any match we haven't stored yet
  for (const m of listed.values()) {
    if (BBS.matches[m.id] || bbsUsed > BBS_RUN_CAP) continue;
    const st = await bbsGet(`/v1/matches/${m.id}/statistics?sport=football`);
    const H = st?.data?.home, A = st?.data?.away;
    if (!H || !A || H.shots_on_target == null) { BBS.matches[m.id] = { lg, day: day(m.kickoff_utc), h: m.home.name, a: m.away.name, none: true }; continue; }
    BBS.matches[m.id] = { lg, day: day(m.kickoff_utc), h: m.home.name, a: m.away.name, hg: m.score?.home, ag: m.score?.away,
      hs: H.total_shots, as: A.total_shots, hsot: H.shots_on_target, asot: A.shots_on_target };
  }
  // 3) line them up with football-data.org's matches (same day, both team names alike) and build an xG-style rating
  const rows = Object.values(BBS.matches).filter(x => x.lg === lg && !x.none);
  const raw = x => [0.30 * x.hsot + 0.03 * (x.hs - x.hsot), 0.30 * x.asot + 0.03 * (x.as - x.asot)];
  const games = [];
  for (const m of done) {
    const d = day(m.utcDate);
    const x = rows.find(r => Math.abs(new Date(r.day) - new Date(d)) <= 864e5 && sim(r.h, m.homeTeam.name) + sim(r.h, m.homeTeam.shortName || "") > .5 && sim(r.a, m.awayTeam.name) + sim(r.a, m.awayTeam.shortName || "") > .5);
    if (x) games.push({ h: m.homeTeam.id, a: m.awayTeam.id, g: [m.score.fullTime.home, m.score.fullTime.away], x: raw(x) });
  }
  if (games.length < 20) { console.log(`  shots: ${games.length}/${done.length} matches so far, not enough yet`); return {}; }
  // calibrate so the league's shot-xG adds up to its real goals
  const k = games.reduce((t, g) => t + g.g[0] + g.g[1], 0) / games.reduce((t, g) => t + g.x[0] + g.x[1], 0);
  const per = {};
  for (const g of games) for (const [t, f, a] of [[g.h, g.x[0], g.x[1]], [g.a, g.x[1], g.x[0]]]) { const p = per[t] ??= { n: 0, f: 0, a: 0 }; p.n++; p.f += f * k; p.a += a * k; }
  const out = {}; for (const [t, p] of Object.entries(per)) if (p.n >= 3) out[t] = [+(p.f / p.n).toFixed(2), +(p.a / p.n).toFixed(2)];
  console.log(`  shots: ${games.length}/${done.length} matches with shot data, xG for ${Object.keys(out).length}/${fdTeams.length} teams (${bbsUsed} Big Balls requests so far)`);
  return out;
}

function matchElo(code, fdTeams) {
  if (!ELO) return {};
  const pool = ELO.filter(x => x.country === ELO_COUNTRY[code]);
  const pairs = [];
  for (const t of fdTeams) for (const e of pool) {
    const name = ELO_ALIAS[e.club] || e.club;
    const sc = Math.max(sim(name, t.name), sim(name, t.shortName || ""));
    if (sc >= .5) pairs.push({ t: t.id, e, sc: sc + Math.max(jac(name, t.name), jac(name, t.shortName || "")) + (e.level === 1 ? .01 : 0) });
  }
  pairs.sort((a, b) => b.sc - a.sc);
  const out = {}, used = new Set();
  for (const p of pairs) { if (out[p.t] || used.has(p.e.club)) continue; out[p.t] = p.e.elo; used.add(p.e.club); }
  return out;
}

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

async function getJSON(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries - 1) throw new Error(`${new URL(url).host}: ${e.message}`);
      await sleep(1500 * (i + 1));
    }
  }
}
async function readJSON(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return fallback; }
}

const SHORT = {
  "Man United": "Man Utd", "Nottingham": "Nott'm Forest", "Brighton Hove": "Brighton", "Wolverhampton": "Wolves",
  "Tottenham": "Tottenham", "Bayern München": "Bayern", "Paris Saint-Germain": "PSG", "Paris SG": "PSG",
  "Atleti": "Atlético", "Leeds United": "Leeds", "Hull City": "Hull", "Ipswich Town": "Ipswich", "Coventry City": "Coventry",
  "Leicester City": "Leicester", "Norwich City": "Norwich", "Luton Town": "Luton", "Sheffield Utd": "Sheffield Utd", "Athletic": "Athletic", "Leverkusen": "Leverkusen", "Dortmund": "Dortmund", "M'gladbach": "M'gladbach"
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
const STOP = new Set(["fc","afc","cf","sc","ac","as","ssc","rc","rcd","ogc","club","de","del","la","the","and","calcio","sv","vfb","vfl","tsg","fsv","1","04","05","1899","1846","1909","1910","stade","sport","us","ud","cd","sd","ca","le","les"]);
const ALIAS = { munich: "munchen", wolves: "wolverhampton", spurs: "tottenham", psg: "paris", inter: "internazionale", man: "manchester", utd: "united", nottm: "nottingham", "saint": "st" };
function tokens(name) {
  return String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .map(t => ALIAS[t] || t).filter(t => t && !STOP.has(t));
}
function jac(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b)); let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / ((A.size + B.size - n) || 1);
}
function sim(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}

function parseOdds(ev) {
  const prices = {}; // key -> { book: price }
  const links = {};  // key -> { book: [url, kind] }   kind: "slip" (bet on the slip), "market" or "event"
  const eventLinks = {}; // book -> url
  const put = (key, price, book, link) => {
    if (!(price > 1)) return;
    const k = (prices[key] ??= {});
    if (!k[book] || price > k[book]) { k[book] = price; if (link) (links[key] ??= {})[book] = link; }
  };
  for (const bm of ev.bookmakers || []) {
    if (/^(betfair_ex|matchbook|smarkets)/.test(bm.key || "")) continue; // exchanges charge commission – compare sportsbooks only
    if (bm.link) eventLinks[bm.title] = bm.link;
    for (const mk of bm.markets || []) {
      const L = o => o.link ? [o.link, "slip"] : mk.link ? [mk.link, "market"] : bm.link ? [bm.link, "event"] : null;
      if (mk.key === "h2h") {
        for (const o of mk.outcomes || []) {
          if (o.name === "Draw") put("X", o.price, bm.title, L(o));
          else if (o.name === ev.home_team) put("1", o.price, bm.title, L(o));
          else if (o.name === ev.away_team) put("2", o.price, bm.title, L(o));
        }
      } else if (mk.key === "totals") {
        for (const o of mk.outcomes || []) {
          const line = Number(o.point);
          if (![1.5, 2.5, 3.5].includes(line)) continue;
          put((o.name === "Over" ? "O" : "U") + String(line).replace(".", ""), o.price, bm.title, L(o));
        }
      }
    }
  }
  const out = {};
  for (const [k, byBook] of Object.entries(prices)) {
    const all = Object.entries(byBook).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([book, price]) => { const l = links[k]?.[book]; return l ? [book, price, l[0], l[1]] : [book, price]; });
    const avg = all.reduce((s, x) => s + x[1], 0) / all.length;
    out[k] = { b: all[0][1], k: all[0][0], a: +avg.toFixed(3), n: all.length, all };
  }
  if (Object.keys(eventLinks).length) out._ev = eventLinks;
  return Object.keys(out).length ? out : null;
}

// ---------- bet365 prices (OddsPapi free plan, shared 250/month budget with scripts/allsports.mjs) ----------
// One request a day returns bet365's prices for all four leagues; team names come from a weekly-cached list.
const ODDSPAPI_KEY = process.env.ODDSPAPI_KEY;
const OP_TOURN = { PL: 17, PD: 8, BL1: 35, FL1: 34, SA: 23, CL: 7 };
const OP_CAP = 235;
let B365 = null; // { at, events: [{ t, start, h, a, p: { key: price } }] }
async function opGet(path, params, usage) {
  const u = new URL(`https://api.oddspapi.io/v4/${path}`);
  for (const [k, v] of Object.entries({ ...params, apiKey: ODDSPAPI_KEY })) u.searchParams.set(k, v);
  usage.used++;
  const r = await fetch(u).catch(e => ({ ok: false, status: 0, text: async () => String(e) }));
  const t = await r.text();
  if (!r.ok) { console.warn(`  OddsPapi /${path} → ${r.status}: ${t.slice(0, 150)}`); return null; }
  await new Promise(r => setTimeout(r, 1200));
  try { return JSON.parse(t); } catch { return null; }
}
async function loadBet365() {
  const saved = await readJSON("data/bet365.json", null);
  if (!ODDSPAPI_KEY) return saved;
  const fresh = saved?.at && Date.now() - new Date(saved.at) < 20 * 3600e3;
  if (fresh && !process.env.FORCE_ODDS) { console.log(`  bet365: reusing prices from ${saved.at}`); return saved; }
  const opc = await readJSON("data/oddspapi-cache.json", {});
  const month = new Date().toISOString().slice(0, 7);
  const usage = { used: opc.month === month ? opc.used || 0 : 0 };
  const teams = await readJSON("data/oddspapi-teams.json", { names: {} });
  const ids = LEAGUES.map(c => OP_TOURN[c]).filter(Boolean);
  if (usage.used + 1 + Math.ceil(ids.length / 5) > OP_CAP - 6) { console.warn(`  bet365: skipped, OddsPapi budget nearly used (${usage.used}/${OP_CAP})`); return saved; }
  // OddsPapi allows 5 competitions per request
  const list = [];
  for (let i = 0; i < ids.length; i += 5) {
    const od = await opGet("odds-by-tournaments", { tournamentIds: ids.slice(i, i + 5).join(","), bookmaker: "bet365", oddsFormat: "decimal" }, usage);
    if (Array.isArray(od)) list.push(...od);
  }
  // team names: refresh the list when a team is missing (about once a week, or when promoted sides appear)
  const need = new Set(list.flatMap(f => [f.participant1Id, f.participant2Id]).map(String));
  if ([...need].some(id => !teams.names[id]) && usage.used + 1 <= OP_CAP - 6) {
    const pa = await opGet("participants", { sportId: 10 }, usage);
    if (pa && typeof pa === "object") { teams.names = {}; for (const id of need) if (pa[id]) teams.names[id] = pa[id]; teams.at = new Date().toISOString(); await fs.writeFile("data/oddspapi-teams.json", JSON.stringify(teams)); }
  }
  // OddsPapi market/outcome ids: 101 result (101 home, 102 draw, 103 away), 104 BTTS (104 yes, 105 no),
  // 1010 over/under 2.5 (1010 over, 1011 under), 1012 over/under 3.5 (1012 over, 1013 under), plus corners and bookings below
  const MAP = { 101: { 101: "1", 102: "X", 103: "2" }, 104: { 104: "BY", 105: "BN" }, 1010: { 1010: "O25", 1011: "U25" }, 1012: { 1012: "O35", 1013: "U35" },
    // corners over/under 8.5 / 9.5 / 10.5 and bookings (cards) over/under 2.5 / 3.5 / 4.5
    10799: { 10799: "CO8.5", 10800: "CU8.5" }, 10803: { 10803: "CO9.5", 10804: "CU9.5" }, 10807: { 10807: "CO10.5", 10808: "CU10.5" },
    10922: { 10922: "KO2.5", 10923: "KU2.5" }, 10926: { 10926: "KO3.5", 10927: "KU3.5" }, 10930: { 10930: "KO4.5", 10931: "KU4.5" } };
  const events = [];
  for (const f of list) {
    const mk = f.bookmakerOdds?.bet365?.markets; const h = teams.names[f.participant1Id], a = teams.names[f.participant2Id];
    if (!mk || !h || !a) continue;
    // bet365 often flags prices "inactive" in this feed, so keep a market only when every outcome has a price
    // and together they make sense (bookie margin between 0 and 15%)
    const p = {};
    for (const [mid, outs] of Object.entries(MAP)) {
      const m = mk[mid]; if (!m || m.marketActive === false) continue;
      const got = Object.entries(outs).map(([oid, key]) => [key, m.outcomes?.[oid]?.players?.["0"]?.price]);
      if (!got.every(([, pr]) => pr > 1)) continue;
      const over = got.reduce((t, [, pr]) => t + 1 / pr, 0);
      if (over < 1 || over > 1.15) continue;
      for (const [key, pr] of got) p[key] = pr;
    }
    if (Object.keys(p).length) events.push({ t: f.tournamentId, start: f.startTime, h, a, p });
  }
  await fs.writeFile("data/oddspapi-cache.json", JSON.stringify({ ...opc, month, used: usage.used }));
  if (!events.length) { console.warn("  bet365: no prices this run"); return saved; }
  const out = { at: new Date().toISOString(), events };
  await fs.writeFile("data/bet365.json", JSON.stringify(out));
  console.log(`  bet365: ${events.length} matches priced (${usage.used}/${OP_CAP} OddsPapi requests this month)`);
  return out;
}
// add bet365 to a match's price lists (replacing any older bet365 price), then re-rank
function addBet365(code, m, o) {
  const t = OP_TOURN[code]; if (!B365 || !t) return o;
  let best = null, bestS = 0;
  for (const e of B365.events) {
    if (e.t !== t || Math.abs(new Date(e.start) - new Date(m.utcDate)) > 6 * 3600e3) continue;
    const sh = Math.max(sim(e.h, m.homeTeam.name), sim(e.h, m.homeTeam.shortName || ""));
    const sa = Math.max(sim(e.a, m.awayTeam.name), sim(e.a, m.awayTeam.shortName || ""));
    if (sh >= .5 && sa >= .5 && sh + sa >= 1.5 && sh + sa > bestS) { bestS = sh + sa; best = e; }
  }
  if (!best) return o;
  o = o ? JSON.parse(JSON.stringify(o)) : {};
  for (const [key, price] of Object.entries(best.p)) {
    const cur = o[key]?.all?.filter(x => x[0] !== "bet365") || [];
    const all = [...cur, ["bet365", price]].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const avg = all.reduce((s, x) => s + x[1], 0) / all.length;
    o[key] = { b: all[0][1], k: all[0][0], a: +avg.toFixed(3), n: all.length, all };
  }
  B365.matched = (B365.matched || 0) + 1;
  return o;
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

  // Premier League: team news + xG from the FPL feed
  const fplInj = {};   // fd team id -> [{name, full, why, chance}]
  const fplXg = {};    // fd team id -> [xgFor/game, xgAgainst/game]
  if (code === "PL" && FPL) {
    const fdTeams = {};
    for (const m of [...done, ...next]) { fdTeams[m.homeTeam.id] = m.homeTeam; fdTeams[m.awayTeam.id] = m.awayTeam; }
    const map = {}; // fpl team id -> fd team id
    for (const ft of FPL.teams || []) {
      let best = null, bs = 0;
      for (const t of Object.values(fdTeams)) {
        const sc = Math.max(sim(ft.name, t.name), sim(ft.name, t.shortName || ""), sim(ft.short_name || "", t.tla || "") );
        if (sc > bs) { bs = sc; best = t.id; }
      }
      if (best && bs >= .5) map[ft.id] = best;
    }
    const agg = {};
    for (const el of FPL.elements || []) {
      const tid = map[el.team]; if (!tid || !T[tid]) continue;
      const a = (agg[tid] ??= { xg: 0, xgc: 0 });
      a.xg += Number(el.expected_goals || 0);
      if (el.element_type === 1) a.xgc += Number(el.expected_goals_conceded || 0);
      const gp = T[tid].o[0] || 1, regular = (el.minutes || 0) >= .4 * gp * 90;
      const ch = el.chance_of_playing_next_round;
      const out = el.status === "i" || el.status === "s" || (el.status === "d" && ch != null && ch <= 50);
      if (out && regular) (fplInj[tid] ??= []).push({ name: el.web_name, full: `${el.first_name} ${el.second_name}`, why: el.news || "", chance: ch ?? 0 });
    }
    for (const [tid, a] of Object.entries(agg)) {
      const gp = T[tid].o[0];
      if (gp >= 3) fplXg[tid] = [+(a.xg / gp).toFixed(2), +(a.xgc / gp).toFixed(2)];
    }
    console.log(`  FPL: matched ${Object.keys(map).length}/20 teams, ${Object.values(fplInj).flat().length} regulars out or doubtful`);
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

  // Bookmaker odds (refreshed at most every 6 hours to save credits; otherwise reuse the last prices)
  const oddsByMatch = {};
  const prevOdds = Object.fromEntries((prev?.matches || []).filter(x => x.odds).map(x => [x.id, x.odds]));
  const fresh = !process.env.FORCE_ODDS && cache.oddsAt?.[code] && Date.now() - cache.oddsAt[code] < 6 * 3600e3 && Object.keys(prevOdds).length;
  if (fresh) { Object.assign(oddsByMatch, prevOdds); console.log(`  odds: reusing prices from ${new Date(cache.oddsAt[code]).toISOString()} (under 6 hours old)`); }
  else if (ODDS_KEY && info.odds && next.length) {
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
        (cache.oddsAt ??= {})[code] = Date.now();
      } catch (e) { console.warn("odds:", e.message); }
    }
  }

  // ClubElo ratings
  const fdTeamList = {}; for (const m of [...done, ...next]) { fdTeamList[m.homeTeam.id] = m.homeTeam; fdTeamList[m.awayTeam.id] = m.awayTeam; }
  const elo = matchElo(code, Object.values(fdTeamList));
  let shotXg = {}; try { shotXg = await loadShots(code, done, Object.values(fdTeamList)); } catch (e) { console.warn(`  shots: ${e.message}`); }
  const stats = await loadMatchStats(code, Object.values(fdTeamList), cache);
  console.log(`  ClubElo matched ${Object.keys(elo).length}/${Object.keys(fdTeamList).length} teams`);

  // rest days: time since each team's previous league or Champions League game
  const allGames = [...matches, ...(CL || [])].filter(g => !["CANCELLED", "POSTPONED", "SUSPENDED"].includes(g.status));
  const lastBefore = (tid, when) => {
    let best = null;
    for (const g of allGames) {
      if (g.homeTeam?.id !== tid && g.awayTeam?.id !== tid) continue;
      const d = new Date(g.utcDate); if (d >= when - 3600e3) continue;
      if (!best || d > best) best = d;
    }
    return best;
  };
  const restDays = (tid, iso) => { const k = new Date(iso), l = lastBefore(tid, k); return l ? Math.round((k - l) / 864e5 * 10) / 10 : null; };

  const teams = {};
  for (const [tid, t] of Object.entries(T)) teams[t.name] = { o: t.o, h: t.h, a: t.a, f: t.res.slice(-5).join(""), xg: fplXg[tid] || shotXg[tid] || null, cn: stats[tid]?.cn || null, cd: stats[tid]?.cd || null, elo: elo[tid] || null };
  const injSide = (team) => {
    const list = fplInj[team.id] || [], name = teamName(team);
    const keys = (players[name] || []);
    const keyOut = [], others = [];
    for (const x of list) {
      const k = keys.find(p => sim(p.name, x.full) >= .99 || sim(p.name, x.name) >= .99);
      if (k) keyOut.push(k.name); else others.push(x);
    }
    return { players: keyOut, others: Math.min(3, others.length),
      all: list.map(x => `${x.name}${x.why ? " – " + x.why : ""}`) };
  };
  const prevWx = Object.fromEntries((prev?.matches || []).filter(x => x.wx).map(x => [x.id, x.wx]));
  const outMatches = next.map(m => {
    const wx = weather[m.id] || prevWx[m.id] || null; // keep last forecast if the weather service had a blip
    return { id: m.id, date: m.utcDate, ...ukDate(m.utcDate), h: teamName(m.homeTeam), a: teamName(m.awayTeam),
      v: addr[m.homeTeam.id]?.venue || "", w: weatherKey(wx), wx, odds: addBet365(code, m, oddsByMatch[m.id] || null),
      rest: { h: restDays(m.homeTeam.id, m.utcDate), a: restDays(m.awayTeam.id, m.utcDate) },
      inj: { h: injSide(m.homeTeam), a: injSide(m.awayTeam) } };
  });

  const results = {}; for (const m of done) results[m.id] = { hg: m.score.fullTime.home, ag: m.score.fullTime.away };
  // league table now, plus every fixture still to play (for the season simulation)
  const table = {};
  const row = t => (table[teamName(t)] ??= { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  for (const t of Object.values(fdTeamList)) row(t);
  for (const m of done) {
    const h = row(m.homeTeam), a = row(m.awayTeam), hg = m.score.fullTime.home, ag = m.score.fullTime.away;
    h.p++; a.p++; h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.w++; a.l++; h.pts += 3; } else if (ag > hg) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  const toPlay = matches.filter(m => ["SCHEDULED", "TIMED", "POSTPONED"].includes(m.status)).map(m => ({ id: m.id, h: teamName(m.homeTeam), a: teamName(m.awayTeam) }));
  return { _results: results, _table: table, _toPlay: toPlay, code, name: info.name, round: md ? `Matchday ${md}` : (prev?.round || ""), teams,
    players: Object.keys(players).length ? players : (prev?.players || {}),
    matches: outMatches.length ? outMatches : (prev?.matches || []) };
}

async function main() {
  const cache = await readJSON("data/cache.json", {});
  cache.teams ??= {}; cache.geo ??= {};
  delete cache.stats; // left over from the API-Football version
  const previous = await readJSON("data/tips.json", null);
  const prevBy = Object.fromEntries((previous?.leagues || []).map(l => [l.code || l.name, l]));
  const prevSim = Object.fromEntries((previous?.leagues || []).filter(l => l.sim).map(l => [l.code, l.sim]));

  if (LEAGUES.includes("PL")) FPL = await loadFPL();
  ELO = await loadElo(cache);
  try { B365 = await loadBet365(); } catch (e) { console.warn("bet365:", e.message); }
  try { CL = (await fd("/competitions/CL/matches")).matches || []; console.log(`  Champions League: ${CL.length} matches (for rest days)`); }
  catch (e) { console.warn("Champions League:", e.message); CL = []; }
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
  if (BBS) await fs.writeFile("data/bbs-cache.json", JSON.stringify(BBS));
  // Champions League sides: borrow corners & cards from their domestic league (Football-Data.co.uk has no Champions League file)
  const CLg = leagues.find(L => L.code === "CL");
  if (CLg) {
    const dom = {}; for (const L of leagues) if (L.code !== "CL") for (const [n, t] of Object.entries(L.teams || {})) dom[n] = t;
    let k = 0; for (const [n, t] of Object.entries(CLg.teams || {})) if (!t.cn && dom[n]?.cn) { t.cn = dom[n].cn; t.cd = dom[n].cd; k++; }
    console.log(`  Champions League: corners & cards from domestic leagues for ${k}/${Object.keys(CLg.teams || {}).length} teams`);
  }

  // --- accuracy tracking: save each prediction until kick-off, then attach the result ---
  const hist = await readJSON("data/history.json", { entries: [] });
  const byId = new Map((hist.entries || []).map(e => [e.id, e]));
  const r4 = x => x == null ? null : Math.round(x * 1e4) / 1e4;
  const results = {};
  const now = Date.now();
  for (const L of leagues) {
    Object.assign(results, L._results || {}); delete L._results;
    const table = L._table, toPlay = L._toPlay; delete L._table; delete L._toPlay;
    const Lc = TM.prepLeague(JSON.parse(JSON.stringify(L)));
    // season simulation: every remaining fixture played 10,000 times
    if (table && toPlay?.length && L.code !== "CL") {
      try {
        const known = new Map((Lc.matches || []).map(m => [m.id, m]));
        const fx = toPlay.map(f => {
          const m = known.get(f.id), r = m ? TM.model(m, Lc, TM.outFor(Lc, m)) : TM.model({ h: f.h, a: f.a, w: "light" }, Lc, { h: 0, a: 0 });
          return r ? { h: f.h, a: f.a, lh: r.lh, la: r.la } : null;
        }).filter(Boolean);
        const N = 10000, sim = TM.simulateSeason(table, fx, N), n = sim.length, r3 = x => Math.round(x * 1000) / 1000;
        L.sim = { at: new Date().toISOString(), n: N, left: fx.length,
          rows: sim.map(x => ({ t: x.t, ...table[x.t], xp: Math.round(x.xp * 10) / 10, title: r3(x.pos[0]), top4: r3(x.pos.slice(0, 4).reduce((a, b) => a + b, 0)),
            rel: r3(x.pos.slice(n - 3).reduce((a, b) => a + b, 0)), pos: x.pos.map(r3) })).sort((a, b) => b.xp - a.xp) };
        console.log(`  ${L.name}: season simulated ${N.toLocaleString()} times (${fx.length} fixtures left)`);
      } catch (e) { console.warn(`  ${L.name}: season simulation failed: ${e.message}`); }
    } else if (prevSim[L.code]) L.sim = prevSim[L.code];
    for (const m of Lc.matches || []) {
      if (new Date(m.date) <= now) continue; // frozen at kick-off
      const r = TM.model(m, Lc, TM.outFor(Lc, m)); if (!r) continue;
      m._r = r;
      const mk = TM.markets(m), tipKey = TM.resultTip(m, r), tip = mk.find(x => x.key === tipKey);
      const value = mk.map(x => ({ x, e: TM.edgeOf(x) })).filter(v => v.e != null && v.e >= .03 && v.x.pm >= .2)
        .map(v => ({ key: v.x.key, b: v.x.o.b, k: v.x.o.k, edge: r4(v.e) }));
      const hasMkt = TM.mktProb(m, "1") != null;
      byId.set(m.id, { id: m.id, lg: L.name, date: m.date, h: m.h, a: m.a,
        p: { 1: r4(r.pH), X: r4(r.pD), 2: r4(r.pA), O25: r4(r.o25), BY: r4(r.btts) },
        pure: { 1: r4(r.pure.pH), X: r4(r.pure.pD), 2: r4(r.pure.pA), O25: r4(r.pure.o25), BY: r4(r.pure.btts) },
        mkt: hasMkt ? { 1: r4(TM.mktProb(m, "1")), X: r4(TM.mktProb(m, "X")), 2: r4(TM.mktProb(m, "2")) } : null,
        tip: { key: tipKey, p: r4(tip.p), b: tip.o?.b ?? null, k: tip.o?.k ?? null }, // best bookie price just before kick-off score: { hg: r.pred[0], ag: r.pred[1], p: r4(r.pred[2]) },
        value, res: byId.get(m.id)?.res || null });
    }
  }
  let graded = 0;
  for (const e of byId.values()) { if (!e.res && results[e.id]) e.res = results[e.id]; if (e.res) graded++; }
  const entries = [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-3000);
  await fs.writeFile("data/history.json", JSON.stringify({ updated: new Date().toISOString(), entries }));
  console.log(`History: ${entries.length} predictions saved, ${graded} with results`);

  const data = {
    updated: new Date().toISOString(), mode: "live",
    sources: ["football-data.org (fixtures, results, tables, scorers)",
      FPL ? "Fantasy Premier League feed (Premier League team news + xG)" : "FPL feed unavailable this run",
      ELO ? "ClubElo (team strength ratings)" : "ClubElo unavailable this run",
      ODDS_KEY ? "The Odds API (UK bookmaker odds)" : "Odds: not configured",
      B365?.events?.length ? "OddsPapi (bet365 prices, once a day)" : null,
      "Open-Meteo (kick-off weather)", "Football-Data.co.uk (corners & cards)", BBS_KEY ? "Big Balls Sports Data (shots → xG for every league)" : null].filter(Boolean),
    oddsCreditsLeft: oddsLeft,
    leagues
  };
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile("data/tips.json", JSON.stringify(data, null, 1));
  await fs.writeFile("data/cache.json", JSON.stringify(cache));
  console.log(`\nDone: ${leagues.map(l => `${l.name} ${l.matches.length}`).join(", ")}. football-data calls ${fdCalls}, odds credits used ${oddsUsed}${oddsLeft !== null ? `, ${oddsLeft} left this month` : ""}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
