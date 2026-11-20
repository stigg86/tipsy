const KEY=process.env.ODDSPAPI_KEY;
const u=new URL("https://api.oddspapi.io/v4/markets");u.searchParams.set("sportId","10");u.searchParams.set("apiKey",KEY);
const r=await fetch(u);const j=await r.json();const list=Array.isArray(j)?j:Object.values(j);
console.log("markets",list.length,"sample keys",Object.keys(list[0]||{}).join(","));
const hit=list.filter(m=>/card|booking/i.test(m.marketName||"")&&/total|over/i.test((m.marketType||"")+(m.marketName||""))&&[2.5,3.5,4.5].includes(m.handicap)&&m.period==="fulltime");
for(const m of hit)console.log(JSON.stringify(m).slice(0,260));
