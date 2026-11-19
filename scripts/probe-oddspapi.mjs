const KEY=process.env.ODDSPAPI_KEY;
const u=new URL("https://api.oddspapi.io/v4/odds-by-tournaments");for(const[k,v]of Object.entries({tournamentIds:"17,8,35,34",bookmaker:"bet365",oddsFormat:"decimal",apiKey:KEY}))u.searchParams.set(k,v);
const r=await fetch(u);const arr=await r.json();console.log("status",r.status,"fixtures",arr.length);
let shown=0,stats={no365:0,no101:0,ok:0,other:0};
for(const f of arr){const b=f.bookmakerOdds?.bet365;if(!b){stats.no365++;continue}
  const m=b.markets?.["101"];if(!m){stats.no101++;if(shown<2){shown++;console.log("NO 101:",f.startTime,"bk keys",Object.keys(b).join(","),"markets",Object.keys(b.markets||{}).slice(0,15).join(","))}continue}
  const ok=["101","102","103"].every(o=>m.outcomes?.[o]?.players?.["0"]?.price>1);
  if(ok)stats.ok++;else{stats.other++;if(shown<4){shown++;console.log("BAD 101:",f.startTime,JSON.stringify(m).slice(0,900))}}}
console.log(JSON.stringify(stats));
