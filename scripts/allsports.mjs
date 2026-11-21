// Tipsy – "Today's best" across all sports, from the OddsPapi free plan (250 requests a month).
// Runs once a day: 1 request for the fixture list + up to 5 odds requests (5 competitions each, Pinnacle prices).
// Writes data/allsports.json. Football from our own four leagues is added on the page from tips.json.
import { readFile, writeFile } from "node:fs/promises";

const KEY = process.env.ODDSPAPI_KEY;
const FORCE = !!process.env.FORCE_ALLSPORTS;
const BASE = "https://api.oddspapi.io/v4";
const OUT = "data/allsports.json", CACHE = "data/oddspapi-cache.json";
const MONTH_CAP = 235;          // leave a little headroom under 250
const ODDS_CALLS = 5;           // odds requests per day (5 competitions each)
const WINDOW_H = 36;            // events starting in the next 36 hours
const BOOK = "pinnacle";        // sharpest bookie: its prices, margin removed, are the best guide to true chances

const readJSON = async (p, d) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Competitions worth showing, best first. Matched against "category tournament" names from OddsPapi.
// Our own four football leagues are left out: Tipsy's model covers those.
const WANT = [
  [10, /champions league(?!.*(women|qualif|afc|caf|concacaf))/i], [10, /europa league(?!.*women)/i], [10, /conference league/i],
  [14, /\bnfl\b/i], [11, /\bnba\b(?!.*(g league|cup))/i], [15, /\bnhl\b/i],
  [12, /^(atp|wta)\b|davis cup|billie jean|united cup/i],
  [19, /pdc|premier league|world championship|grand slam|players championship|world series|world matchplay|grand prix|masters/i],
  [24, /.*/], // snooker: any
  [20, /ufc/i], [21, /.*/], // MMA (UFC), boxing: any
  [26, /premiership|top 14|united rugby|six nations|champions cup|autumn|international|nrl|super rugby|world cup/i],
  [27, /international|test|odi|t20i|ipl|indian premier|big bash|the hundred|ashes|world cup/i],
  [10, /england.*championship|efl championship/i], [10, /scotland.*premiership/i],
  [10, /netherlands.*eredivisie/i], [10, /portugal.*(liga portugal|primeira)(?! ?[23])/i], [10, /fa cup|carabao|efl cup|copa del rey|dfb pokal|coupe de france|coppa italia/i],
  [10, /world cup.*qualif|nations league|friendl.*international|euro.*qualif/i],
  [11, /euroleague/i], [31, /\bafl\b/i], [14, /ncaa/i], [11, /ncaa(?!.*women)/i]
];
const JUNK = /simulated|\bsrl\b|power slap|esoccer|virtual|cyber/i;
const OUR_FOOTBALL = /^(england premier league|spain laliga|spain la liga|germany bundesliga|france ligue 1|italy serie a)$/i;

async function get(path, params, usage) {
  const u = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries({ ...params, apiKey: KEY })) u.searchParams.set(k, v);
  usage.used++;
  for (let i = 0; i < 2; i++) {
    const r = await fetch(u).catch(e => ({ ok: false, status: 0, text: async () => String(e) }));
    if (r.status === 429) { await sleep(2500); continue; }
    const txt = await r.text();
    if (!r.ok) { console.log(`OddsPapi /${path} -> ${r.status}: ${txt.slice(0, 200)}`); return null; }
    await sleep(1200); // endpoint cooldown is 1s
    try { return JSON.parse(txt); } catch { return null; }
  }
  return null;
}

// "Shelton, Ben" -> "Ben Shelton"; doubles pairs and team names stay as they are
const person = n => /^[^,\/]+, [^,\/]+$/.test(n) ? n.split(", ").reverse().join(" ") : n;
// "ATP ATP World Tour Finals Men Singles" -> "ATP World Tour Finals Men Singles", "USA NBA" -> "NBA"
function compName(f) {
  const cat = (f.categoryName || "").trim(), t = (f.tournamentName || "").trim();
  if (!cat || /^(international|usa|world)$/i.test(cat) || t.toLowerCase().startsWith(cat.toLowerCase())) return t;
  return `${cat} ${t}`;
}

// Pinnacle's full-game moneyline: home / (draw) / away, with the margin removed
function moneyline(fx) {
  const bo = fx.bookmakerOdds && fx.bookmakerOdds[BOOK];
  if (!bo || bo.suspended || !bo.markets) return null;
  for (const mk of Object.values(bo.markets)) {
    if (!/^line\/.*\/0\/moneyline$/.test(mk.bookmakerMarketId || "") || mk.marketActive === false) continue;
    const o = {};
    for (const oc of Object.values(mk.outcomes || {})) {
      const pl = oc.players && oc.players["0"]; if (!pl || !pl.active || !(pl.price > 1)) continue;
      const side = pl.bookmakerOutcomeId; if (side === "home" || side === "away" || side === "draw") o[side] = pl.price;
    }
    if (o.home && o.away) {
      const sides = ["home", "draw", "away"].filter(s => o[s]);
      const inv = sides.reduce((s, k) => s + 1 / o[k], 0);
      if (inv < 1 || inv > 1.15) return null; // something odd in the prices
      return sides.map(s => [s, o[s], +(1 / o[s] / inv).toFixed(4)]);
    }
  }
  return null;
}

// ---------- tracking: save each Best-tab pick, then settle it from ESPN's free scoreboards ----------
const HIST = "data/history-os.json";
const MIN_P = 0.55, MAX_P = 0.96; // same range as the Best tab
// which ESPN scoreboard holds the result, from the sport and competition name
function espnPaths(e) {
  const c = e.comp.toLowerCase(), s = e.sport;
  if (s === "Basketball") return /nba/.test(c) ? ["basketball/nba"] : /ncaa/.test(c) ? [/women/.test(c) ? "basketball/womens-college-basketball" : "basketball/mens-college-basketball"] : [];
  if (s === "Ice Hockey") return /nhl/.test(c) ? ["hockey/nhl"] : [];
  if (s === "American Football") return /nfl/.test(c) ? ["football/nfl"] : /ncaa/.test(c) ? ["football/college-football"] : [];
  if (s === "MMA") return /ufc/.test(c) ? ["mma/ufc"] : [];
  if (s === "Tennis") return /^atp/.test(c) ? ["tennis/atp"] : /^wta(?! 125)/.test(c) ? ["tennis/wta"] : [];
  if (s === "Soccer") {
    const M = [[/champions league/, "uefa.champions"], [/europa league/, "uefa.europa"], [/conference league/, "uefa.europa.conf"], [/england.*championship/, "eng.2"],
      [/scotland.*premiership/, "sco.1"], [/eredivisie/, "ned.1"], [/portugal/, "por.1"], [/fa cup/, "eng.fa"], [/carabao|efl cup|league cup/, "eng.league_cup"],
      [/copa del rey/, "esp.copa_del_rey"], [/pokal/, "ger.dfb_pokal"], [/coupe de france/, "fra.coupe_de_france"], [/coppa italia/, "ita.coppa_italia"]];
    const m = M.find(([re]) => re.test(c)); return m ? ["soccer/" + m[1]] : [];
  }
  return [];
}
const norm = n => (n || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 1 && !["fc", "the", "de", "st"].includes(w));
function sim(a, b) { const A = new Set(norm(a)), B = norm(b); if (!A.size || !B.length) return 0; const hit = B.filter(w => A.has(w)).length; return hit / Math.min(A.size, new Set(B).size); }
const espnCache = new Map();
async function espnDay(path, ymd) {
  const k = path + ymd; if (espnCache.has(k)) return espnCache.get(k);
  let comps = [];
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${ymd}&limit=500`);
    if (r.ok) {
      const j = await r.json();
      for (const ev of j.events || []) {
        const list = ev.competitions?.length ? [...ev.competitions] : [];
        for (const g of ev.groupings || []) list.push(...(g.competitions || []));
        for (const c of list) {
          if (!c.status?.type?.completed) continue;
          const t = (c.competitors || []).map(x => ({ name: x.team?.displayName || x.athlete?.displayName || x.roster?.displayName || "", score: Number(x.score), winner: !!x.winner }));
          if (t.length === 2) comps.push(t);
        }
      }
    }
  } catch {}
  espnCache.set(k, comps); return comps;
}
async function settle(hist) {
  const t0 = Date.now(); let done = 0;
  for (const e of hist.entries) {
    if (e.res || e.void) continue;
    const t = new Date(e.start).getTime();
    if (t0 - t < 3 * 3600e3) continue;                          // not finished yet
    const paths = espnPaths(e);
    if (!paths.length) { e.untracked = true; continue; }         // no free results feed for this one
    let found = null;
    for (const path of paths) for (const dd of [-1, 0, 1]) {
      const ymd = new Date(t + dd * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
      for (const c of await espnDay(path, ymd)) {
        const [x, y] = c;
        const s1 = sim(e.h, x.name) + sim(e.a, y.name), s2 = sim(e.h, y.name) + sim(e.a, x.name);
        const pair = s1 >= s2 ? [x, y] : [y, x];
        if (Math.max(s1, s2) >= 1.5 && sim(e.h, pair[0].name) >= .5 && sim(e.a, pair[1].name) >= .5) { found = pair; break; }
      }
      if (found) break;
    }
    if (found) {
      const [home, away] = found;
      const winner = home.winner ? "home" : away.winner ? "away" : home.score > away.score ? "home" : away.score > home.score ? "away" : "draw";
      e.res = { winner, score: Number.isFinite(home.score) && Number.isFinite(away.score) ? `${home.score}-${away.score}` : null };
      e.won = e.side === winner; done++;
    } else if (t0 - t > 4 * 864e5) e.void = true;               // couldn't find it after 4 days: leave it out
  }
  return done;
}
function record(hist, events) {
  const byId = new Map(hist.entries.map(x => [x.id, x]));
  const t0 = Date.now(); let added = 0;
  for (const ev of events) {
    if (new Date(ev.start).getTime() <= t0) continue;
    const fav = ev.o.filter(([side]) => side !== "draw").sort((a, b) => b[2] - a[2])[0];
    if (!fav || fav[2] < MIN_P || fav[2] > MAX_P) continue;
    const cur = byId.get(ev.id);
    if (cur?.res) continue;
    const entry = { id: ev.id, sport: ev.sport, comp: ev.comp, start: ev.start, h: ev.h, a: ev.a, side: fav[0], pick: fav[0] === "home" ? ev.h : ev.a, p: fav[2], price: fav[1] };
    if (cur) Object.assign(cur, entry); else { hist.entries.push(entry); added++; }
  }
  return added;
}

async function main() {
  // settle finished picks every run (ESPN is free, no OddsPapi requests used)
  const hist = await readJSON(HIST, { entries: [] });
  const settled = await settle(hist);
  hist.entries = hist.entries.filter(x => Date.now() - new Date(x.start) < 120 * 864e5 || x.res);
  await writeFile(HIST, JSON.stringify(hist));
  console.log(`All sports: ${settled} picks settled, ${hist.entries.filter(x => x.res).length} settled in total, ${hist.entries.filter(x => !x.res && !x.void && !x.untracked).length} waiting`);
  if (!KEY) { console.log("All sports: no ODDSPAPI_KEY secret, skipping."); return; }
  const cache = await readJSON(CACHE, {});
  const month = new Date().toISOString().slice(0, 7);
  const usage = cache.month === month ? { month, used: cache.used || 0 } : { month, used: 0 };
  const ageH = cache.at ? (Date.now() - new Date(cache.at)) / 36e5 : 1e9;
  if (!FORCE && ageH < 20) { console.log(`All sports: refreshed ${ageH.toFixed(1)}h ago, skipping (${usage.used}/${MONTH_CAP} used this month).`); return; }
  if (usage.used + 1 + ODDS_CALLS > MONTH_CAP) { console.log(`All sports: monthly budget reached (${usage.used}/${MONTH_CAP}), keeping the last list.`); return; }

  const day = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const fixtures = await get("fixtures", { from: day(0), to: day(2) }, usage);
  const now = Date.now(), until = now + WINDOW_H * 36e5;
  const upcoming = (Array.isArray(fixtures) ? fixtures : []).filter(f => {
    const t = new Date(f.startTime).getTime();
    return f.hasOdds && t > now && t < until && f.participant1Name && f.participant2Name;
  });
  console.log(`All sports: ${upcoming.length} upcoming fixtures with odds in the next ${WINDOW_H}h`);

  // group by competition and choose the most wanted ones
  const comps = {};
  for (const f of upcoming) {
    const c = comps[f.tournamentId] ??= { id: f.tournamentId, sportId: f.sportId, sport: f.sportName, name: `${f.categoryName || ""} ${f.tournamentName || ""}`.trim(), n: 0 };
    c.n++;
  }
  const chosen = [], seen = new Set();
  for (const [sportId, re] of WANT) {
    const list = Object.values(comps).filter(c => c.sportId === sportId && !seen.has(c.id) && !JUNK.test(c.name) && !/uefa champions league|^champions league/i.test(c.name) && re.test(c.name) && !(sportId === 10 && OUR_FOOTBALL.test(c.name)))
      .sort((a, b) => b.n - a.n);
    for (const c of list.slice(0, sportId === 12 ? 4 : 2)) { chosen.push(c); seen.add(c.id); }
    if (chosen.length >= ODDS_CALLS * 5) break;
  }
  const picked = chosen.slice(0, ODDS_CALLS * 5);
  console.log("All sports: competitions:", picked.map(c => `${c.sport}: ${c.name} (${c.n})`).join(" | "));

  const byId = new Map(upcoming.map(f => [f.fixtureId, f]));
  const byTime = new Map(upcoming.map(f => [`${f.tournamentId}|${f.startTime}`, f]));
  const events = [];
  for (let i = 0; i < picked.length; i += 5) {
    const ids = picked.slice(i, i + 5).map(c => c.id).join(",");
    const od = await get("odds-by-tournaments", { tournamentIds: ids, bookmaker: BOOK, oddsFormat: "decimal" }, usage);
    for (const fx of Array.isArray(od) ? od : []) {
      const f = byId.get(fx.fixtureId) || byTime.get(`${fx.tournamentId}|${fx.startTime}`);
      if (!f) continue;
      const ml = moneyline(fx); if (!ml) continue;
      events.push({ id: f.fixtureId, sport: f.sportName, sportId: f.sportId, comp: compName(f),
        start: f.startTime, h: person(f.participant1Name), a: person(f.participant2Name), o: ml });
    }
  }
  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  const bySport = events.reduce((s, e) => (s[e.sport] = (s[e.sport] || 0) + 1, s), {});
  console.log(`All sports: ${events.length} events priced`, JSON.stringify(bySport), `· ${usage.used}/${MONTH_CAP} requests used this month`);

  if (events.length) { const n = record(hist, events); await writeFile(HIST, JSON.stringify(hist)); console.log(`All sports: ${n} new picks recorded`); }
  if (events.length) await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), book: "Pinnacle", used: usage.used, cap: 250, events }));
  await writeFile(CACHE, JSON.stringify({ at: events.length ? new Date().toISOString() : cache.at || null, month, used: usage.used }));
}

main().catch(e => { console.log("All sports failed:", e.message); });
