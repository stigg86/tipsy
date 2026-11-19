const KEY=process.env.ODDSPAPI_KEY;const B="https://api.oddspapi.io/v4";
async function get(path,params){const u=new URL(B+"/"+path);for(const[k,v]of Object.entries({...params,apiKey:KEY}))u.searchParams.set(k,v);
  const r=await fetch(u);const t=await r.text();console.log(`\n=== /${path} ${JSON.stringify(params)} -> ${r.status} ${(t.length/1024).toFixed(0)}KB`);
  if(!r.ok){console.log(t.slice(0,500));return null}await new Promise(r=>setTimeout(r,1500));return JSON.parse(t);}
const mk=await get("markets",{sportId:10});
const list=Array.isArray(mk)?mk:Object.values(mk||{});
console.log("markets",list.length,"sample",JSON.stringify(list[0]).slice(0,600));
for(const m of list){const id=String(m.marketId??m.id);if(["101","104","1010","1012","1014","1016","10182","10258","10260"].includes(id))console.log(JSON.stringify(m).slice(0,700));}
