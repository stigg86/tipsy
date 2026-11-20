// Tipsy prediction model – shared by the page (index.html) and the data builder (scripts/build.mjs)
(function (G) {
  const WX = { dry: ["Dry / clear", 1], light: ["Light rain / showers", .98], rain: ["Heavy rain", .94], wind: ["Strong wind", .93], cold: ["Freezing / snow", .90] };
  const RHO = -0.10;          // Dixon–Coles low-score correction (more 0–0 and 1–1, fewer 1–0 and 0–1)
  const W_MARKET_TIP = 0.5;   // tips: 50/50 blend of our model and the bookmakers (geometric, on expected goals)
  const W_MODEL_VALUE = 0.3;  // value finder: 30% pure model + 70% bookmaker consensus

  const shrink = x => 0.7 * x + 0.3;
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  function formPPG(s) { if (!s) return 1.4; const w = [1, 2, 3, 4, 5].slice(-s.length); let p = 0, ws = 0;[...s].forEach((r, i) => { p += w[i] * (r === "W" ? 3 : r === "D" ? 1 : 0); ws += w[i] }); return ws ? p / ws : 1.4 }
  function formFactor(s) { const f = 1 + 0.15 * (formPPG(s) - 1.4) / 1.6; return Math.max(.85, Math.min(1.15, f)) }
  function pois(l, k) { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p }
  function nbOver(mu, phi, line) {
    if (!(mu > 0)) return null;
    const r = mu / (phi - 1), q = mu / (r + mu);
    let p = Math.pow(r / (r + mu), r), cdf = 0;
    for (let k = 0; k <= Math.floor(line); k++) { cdf += p; p = p * (k + r) / (k + 1) * q; }
    return Math.max(0, Math.min(1, 1 - cdf));
  }

  function prepLeague(L) {
    L.T = {}; L.XG = {}; L.CN = {}; L.CD = {}; L.P = {}; L.ELO = {};
    for (const [k, v] of Object.entries(L.teams || {})) {
      L.T[k] = { o: v.o, h: v.h, a: v.a, f: v.f || "" };
      if (v.xg) L.XG[k] = v.xg; if (v.cn) L.CN[k] = v.cn; if (v.cd) L.CD[k] = v.cd; if (v.elo) L.ELO[k] = v.elo;
    }
    for (const [k, v] of Object.entries(L.players || {})) L.P[k] = v.map(p => [p.name, p.g, p.a, Math.max(1, p.apps || 1)]);
    let hg = 0, hp = 0, ag = 0, ap = 0;
    for (const t of Object.values(L.T)) { hg += t.h[1]; hp += t.h[0]; ag += t.a[1]; ap += t.a[0]; }
    L.AVG_H = hp ? hg / hp : 1.5; L.AVG_A = ap ? ag / ap : 1.2; L.AVG = (hp + ap) ? (hg + ag) / (hp + ap) : 1.35;
    L.XGAVG = mean(Object.values(L.XG).map(v => v[0])) || 1.4;
    return L;
  }

  // who's missing, from the match's team news
  function outFor(L, m) {
    const inj = m.inj || { h: { players: [], others: 0 }, a: { players: [], others: 0 } };
    const known = t => new Set((L.P[t] || []).map(p => p[0]));
    return {
      h: Math.min(3, inj.h.others || 0), a: Math.min(3, inj.a.others || 0),
      ph: new Set((inj.h.players || []).filter(n => known(m.h).has(n))),
      pa: new Set((inj.a.players || []).filter(n => known(m.a).has(n)))
    };
  }
  function playerHit(L, team, names) {
    if (!names || !names.size) return 0;
    const goals = (L.T[team] && L.T[team].o[1]) || 1; let s = 0;
    (L.P[team] || []).forEach(p => { if (names.has(p[0])) s += (p[1] + .5 * p[2]) / goals; });
    return Math.min(.35, s * .6);
  }

  // scoreline probabilities with the Dixon–Coles adjustment
  function scoreProbs(lh, la) {
    let pH = 0, pD = 0, pA = 0, btts = 0, best = [0, 0, 0], tot = new Array(17).fill(0), s = 0; const cells = [];
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      let p = pois(lh, i) * pois(la, j);
      if (i === 0 && j === 0) p *= Math.max(0, 1 - lh * la * RHO);
      else if (i === 0 && j === 1) p *= Math.max(0, 1 + lh * RHO);
      else if (i === 1 && j === 0) p *= Math.max(0, 1 + la * RHO);
      else if (i === 1 && j === 1) p *= 1 - RHO;
      s += p;
      if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
      tot[i + j] += p; if (i > 0 && j > 0) btts += p; if (p > best[2]) best = [i, j, p];
      cells.push([i, j, p]);
    }
    const sorted = cells.sort((a, b) => b[2] - a[2]);
    const scores = sorted.slice(0, 6).map(([i, j, p]) => [i, j, p / s]);
    // predicted score: the most likely scoreline for the most likely result
    const res = pH >= pD && pH >= pA ? "1" : pA >= pD ? "2" : "X";
    const fit = sorted.find(([i, j]) => res === "1" ? i > j : res === "2" ? j > i : i === j);
    const pred = [fit[0], fit[1], fit[2] / s];
    const over = l => tot.reduce((acc, p, k) => k > l ? acc + p : acc, 0) / s;
    return { pH: pH / s, pD: pD / s, pA: pA / s, btts: btts / s, o15: over(1.5), o25: over(2.5), o35: over(3.5), best: [best[0], best[1], best[2] / s], scores, pred };
  }

  // bookmaker consensus probability (average odds, margin removed within each market)
  const MGROUPS = [["1", "X", "2"], ["O15", "U15"], ["O25", "U25"], ["O35", "U35"], ["BY", "BN"],
    ["CO8.5", "CU8.5"], ["CO9.5", "CU9.5"], ["CO10.5", "CU10.5"], ["KO2.5", "KU2.5"], ["KO3.5", "KU3.5"], ["KO4.5", "KU4.5"]];
  function mktProb(m, key) {
    if (!m.odds || !m.odds[key]) return null;
    const g = MGROUPS.find(g => g.includes(key)); if (!g) return null;
    if (!g.every(k => m.odds[k])) return null;
    const inv = g.map(k => 1 / m.odds[k].a), s = inv.reduce((a, b) => a + b, 0);
    return inv[g.indexOf(key)] / s;
  }

  // expected goals that reproduce the bookmakers' prices (result, plus over/under 2.5 when available)
  function fitMarket(m) {
    const t1 = mktProb(m, "1"), t2 = mktProb(m, "2"); if (t1 == null || t2 == null) return null;
    const to = mktProb(m, "O25");
    const err = (lh, la) => { const r = scoreProbs(lh, la); let e = (r.pH - t1) ** 2 + (r.pA - t2) ** 2; if (to != null) e += .5 * (r.o25 - to) ** 2; return e; };
    let best = [1.4, 1.1], be = Infinity;
    for (let lh = .2; lh <= 4.01; lh += .1) for (let la = .2; la <= 4.01; la += .1) { const e = err(lh, la); if (e < be) { be = e; best = [lh, la]; } }
    const [h0, a0] = best;
    for (let lh = Math.max(.05, h0 - .1); lh <= h0 + .1001; lh += .01) for (let la = Math.max(.05, a0 - .1); la <= a0 + .1001; la += .01) { const e = err(lh, la); if (e < be) { be = e; best = [lh, la]; } }
    return { lh: best[0], la: best[1] };
  }

  // our own expected goals (no bookmaker input)
  function lambdas(m, L, o) {
    const H = L.T[m.h], A = L.T[m.a]; if (!H || !A) return null;
    const XH = L.XG[m.h] || null, XA = L.XG[m.a] || null;
    const mix = (g, x) => x == null ? g : .5 * g + .5 * x, r0 = (x, n) => n ? x / n : 0;
    const hAtt = shrink(mix(.5 * r0(H.h[1], H.h[0]) / L.AVG_H + .5 * r0(H.o[1], H.o[0]) / L.AVG, XH && XH[0] / L.XGAVG));
    const hDef = shrink(mix(.5 * r0(H.h[2], H.h[0]) / L.AVG_A + .5 * r0(H.o[2], H.o[0]) / L.AVG, XH && XH[1] / L.XGAVG));
    const aAtt = shrink(mix(.5 * r0(A.a[1], A.a[0]) / L.AVG_A + .5 * r0(A.o[1], A.o[0]) / L.AVG, XA && XA[0] / L.XGAVG));
    const aDef = shrink(mix(.5 * r0(A.a[2], A.a[0]) / L.AVG_H + .5 * r0(A.o[2], A.o[0]) / L.AVG, XA && XA[1] / L.XGAVG));
    let lh = L.AVG_H * hAtt * aDef, la = L.AVG_A * aAtt * hDef;
    // ClubElo prior: long-run strength, weighted more when few games have been played
    const eH = L.ELO[m.h], eA = L.ELO[m.a]; let eloW = 0;
    if (eH && eA) {
      const T = L.AVG_H + L.AVG_A, ratio = (L.AVG_H / L.AVG_A) * Math.pow(10, (eH - eA) / 800);
      const lhE = T * ratio / (1 + ratio), laE = T / (1 + ratio);
      const gp = (H.o[0] + A.o[0]) / 2; eloW = 10 / (10 + gp);
      lh = Math.exp((1 - eloW) * Math.log(lh) + eloW * Math.log(lhE));
      la = Math.exp((1 - eloW) * Math.log(la) + eloW * Math.log(laE));
    }
    const fh = formFactor(H.f), fa = formFactor(A.f), wx = (WX[m.w] || WX.light)[1];
    const kh = playerHit(L, m.h, o.ph), ka = playerHit(L, m.a, o.pa);
    // rest: 3 days or fewer since the last game (league or Champions League)
    const tiredH = m.rest && m.rest.h != null && m.rest.h <= 3, tiredA = m.rest && m.rest.a != null && m.rest.a <= 3;
    lh *= fh / Math.sqrt(fa) * wx * (1 - .06 * o.h) * (1 + .03 * o.a) * (1 - kh) * (tiredH ? .96 : 1) * (tiredA ? 1.03 : 1);
    la *= fa / Math.sqrt(fh) * wx * (1 - .06 * o.a) * (1 + .03 * o.h) * (1 - ka) * (tiredA ? .96 : 1) * (tiredH ? 1.03 : 1);
    return { lh, la, eloW, tiredH, tiredA };
  }

  function model(m, L, o) {
    const base = lambdas(m, L, o); if (!base) return null;
    const pure = scoreProbs(base.lh, base.la);
    const mk = fitMarket(m);
    let lh = base.lh, la = base.la;
    if (mk) {
      lh = Math.exp((1 - W_MARKET_TIP) * Math.log(lh) + W_MARKET_TIP * Math.log(mk.lh));
      la = Math.exp((1 - W_MARKET_TIP) * Math.log(la) + W_MARKET_TIP * Math.log(mk.la));
    }
    const fin = mk ? scoreProbs(lh, la) : pure;
    const wx = (WX[m.w] || WX.light)[1];
    const CH = L.CN[m.h], CA = L.CN[m.a], DH = L.CD[m.h], DA = L.CD[m.a];
    const cMu = CH && CA ? ((CH[0] + CA[1]) / 2 + (CA[0] + CH[1]) / 2) * (wx < .95 ? 1.03 : 1) : null;
    const kMu = DH && DA ? ((DH[0] + DA[1]) / 2 + (DA[0] + DH[1]) / 2) : null;
    return {
      ...fin, lh, la, pure: { ...pure, lh: base.lh, la: base.la }, mkt: mk, eloW: base.eloW, tiredH: base.tiredH, tiredA: base.tiredA,
      cMu, kMu,
      c85: cMu && nbOver(cMu, 1.4, 8.5), c95: cMu && nbOver(cMu, 1.4, 9.5), c105: cMu && nbOver(cMu, 1.4, 10.5),
      k25: kMu && nbOver(kMu, 1.3, 2.5), k35: kMu && nbOver(kMu, 1.3, 3.5), k45: kMu && nbOver(kMu, 1.3, 4.5)
    };
  }

  // every bet for a match: p = tip chance (model + bookies), pm = pure model chance, mp = bookmaker consensus
  function markets(m) {
    const r = m._r; if (!r) return [];
    const q = r.pure || r;
    const M = [
      ["Result", "1", m.h + " to win", r.pH, q.pH], ["Result", "X", "Draw", r.pD, q.pD], ["Result", "2", m.a + " to win", r.pA, q.pA],
      ["Double chance", "1X", m.h + " or draw", r.pH + r.pD, q.pH + q.pD], ["Double chance", "X2", m.a + " or draw", r.pA + r.pD, q.pA + q.pD], ["Double chance", "12", "Home or Away (no draw)", r.pH + r.pA, q.pH + q.pA],
      ["Goals", "O15", "Over 1.5 goals", r.o15, q.o15], ["Goals", "U15", "Under 1.5 goals", 1 - r.o15, 1 - q.o15],
      ["Goals", "O25", "Over 2.5 goals", r.o25, q.o25], ["Goals", "U25", "Under 2.5 goals", 1 - r.o25, 1 - q.o25],
      ["Goals", "O35", "Over 3.5 goals", r.o35, q.o35], ["Goals", "U35", "Under 3.5 goals", 1 - r.o35, 1 - q.o35],
      ["Both teams to score", "BY", "BTTS – Yes", r.btts, q.btts], ["Both teams to score", "BN", "BTTS – No", 1 - r.btts, 1 - q.btts]
    ];
    if (r.cMu) { for (const [k, l] of [["c85", 8.5], ["c95", 9.5], ["c105", 10.5]]) { M.push(["Corners", "CO" + l, `Over ${l} corners`, r[k], r[k]], ["Corners", "CU" + l, `Under ${l} corners`, 1 - r[k], 1 - r[k]]); } }
    if (r.kMu) { for (const [k, l] of [["k25", 2.5], ["k35", 3.5], ["k45", 4.5]]) { M.push(["Cards", "KO" + l, `Over ${l} cards`, r[k], r[k]], ["Cards", "KU" + l, `Under ${l} cards`, 1 - r[k], 1 - r[k]]); } }
    return M.map(([group, key, label, p, pm]) => {
      const mp = mktProb(m, key);
      // corners & cards: the model alone is rough, so lean half on bet365's view when it has a price (goals already do this inside the model)
      if ((group === "Corners" || group === "Cards") && mp != null) p = (1 - W_MARKET_TIP) * pm + W_MARKET_TIP * mp;
      return { group, key, label, p, pm, o: (m.odds && m.odds[key]) || null, mp };
    });
  }

  // value: 30% pure model + 70% bookmakers, only for believable cases
  const blendP = x => x.mp != null ? W_MODEL_VALUE * x.pm + (1 - W_MODEL_VALUE) * x.mp : x.p;
  const credible = x => x.o && x.mp != null && x.o.b <= 5 && Math.abs(x.pm - x.mp) <= .15 && x.o.n >= 2;
  const edgeOf = x => credible(x) ? blendP(x) * x.o.b - 1 : null;

  function grade(p) { return p >= .6 ? ["Strong", "b-strong"] : p >= .5 ? ["Good", "b-good"] : p >= .4 ? ["Lean", "b-lean"] : ["Avoid", "b-avoid"] }
  function resultTip(m, r) {
    const o = [[r.pH, "1"], [r.pD, "X"], [r.pA, "2"]].sort((x, y) => y[0] - x[0]);
    if (o[0][0] < .45) return (r.pH + r.pD >= r.pA + r.pD) ? "1X" : "X2";
    return o[0][1];
  }
  // did a bet win, given the final score?
  function settle(key, hg, ag) {
    const t = hg + ag;
    switch (key) {
      case "1": return hg > ag; case "X": return hg === ag; case "2": return ag > hg;
      case "1X": return hg >= ag; case "X2": return ag >= hg; case "12": return hg !== ag;
      case "O15": return t > 1.5; case "U15": return t < 1.5; case "O25": return t > 2.5; case "U25": return t < 2.5;
      case "O35": return t > 3.5; case "U35": return t < 3.5; case "BY": return hg > 0 && ag > 0; case "BN": return !(hg > 0 && ag > 0);
      default: return null;
    }
  }

  G.TipsyModel = { WX, RHO, W_MARKET_TIP, W_MODEL_VALUE, formPPG, formFactor, pois, nbOver, prepLeague, outFor, playerHit, scoreProbs,
    mktProb, fitMarket, lambdas, model, markets, blendP, credible, edgeOf, grade, resultTip, settle };
})(typeof window !== "undefined" ? window : globalThis);
