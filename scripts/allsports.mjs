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
  [10, /netherlands.*eredivisie/i], [10, /portugal.*(liga portugal|primeira)/i], [10, /fa cup|carabao|efl cup|copa del rey|dfb pokal|coupe de france|coppa italia/i],
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

async function main() {
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
    const list = Object.values(comps).filter(c => c.sportId === sportId && !seen.has(c.id) && !JUNK.test(c.name) && re.test(c.name) && !(sportId === 10 && OUR_FOOTBALL.test(c.name)))
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

  if (events.length) await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), book: "Pinnacle", used: usage.used, cap: 250, events }));
  await writeFile(CACHE, JSON.stringify({ at: events.length ? new Date().toISOString() : cache.at || null, month, used: usage.used }));
}

main().catch(e => { console.log("All sports failed:", e.message); });
