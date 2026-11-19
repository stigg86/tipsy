const KEY=process.env.ODDSPAPI_KEY;const B="https://api.oddspapi.io/v4";
async function get(path,params){const u=new URL(B+"/"+path);for(const[k,v]of Object.entries({...params,apiKey:KEY}))u.searchParams.set(k,v);
  const r=await fetch(u);const t=await r.text();console.log(`\n=== /${path} ${JSON.stringify(params)} -> ${r.status} ${(t.length/1024).toFixed(0)}KB`);
  if(!r.ok){console.log(t.slice(0,500));return null}await new Promise(r=>setTimeout(r,1500));return JSON.parse(t);}
const od=await get("odds-by-tournaments",{tournamentIds:"17,8,35,34",bookmaker:"bet365",oddsFormat:"decimal"});
const arr=Array.isArray(od)?od:[];
const per={};for(const f of arr)per[f.tournamentId]=(per[f.tournamentId]||0)+1;console.log("fixtures per tournament",JSON.stringify(per));
const withB=arr.filter(f=>f.bookmakerOdds&&f.bookmakerOdds.bet365);console.log("with bet365 odds:",withB.length);
if(withB[0]){const f=withB[0];const{bookmakerOdds,...rest}=f;console.log("fixture:",JSON.stringify(rest).slice(0,600));
  const mk=f.bookmakerOdds.bet365.markets||{};console.log("markets:",Object.keys(mk).length);
  for(const[id,m]of Object.entries(mk).slice(0,40))console.log(id,m.bookmakerMarketId,"|",Object.values(m.outcomes||{}).map(o=>{const p=o.players&&o.players["0"];return p?`${p.bookmakerOutcomeId}=${p.price}`:"?"}).join(" "));}
const pa=await get("participants",{sportId:10});
if(pa){const a=Array.isArray(pa)?pa:Object.entries(pa);console.log("participants type",Array.isArray(pa)?"array":"object",a.length,JSON.stringify(a.slice(0,3)).slice(0,300));}
