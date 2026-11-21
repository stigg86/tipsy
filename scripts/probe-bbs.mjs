const K=process.env.BIGBALLS_KEY; if(!K){console.log("NO KEY");process.exit(0);}
const B="https://api.bigballsdata.com";
async function g(p){try{const r=await fetch(B+p,{headers:{Authorization:"Bearer "+K}});const t=await r.text();
  const lim={};r.headers.forEach((v,k)=>{if(/limit|remain|quota|plan/i.test(k))lim[k]=v;});
  console.log(`\n=== ${p} -> ${r.status} ${(t.length/1024).toFixed(0)}KB ${JSON.stringify(lim)}`);console.log(t.slice(0,900));
  try{return JSON.parse(t)}catch{return null}}catch(e){console.log(p,"ERR",e.message);return null}}
await g("/v1/sports");
const lg=await g("/v1/leagues?sport=football");
await g("/v1/coverage?sport=football");
await g("/v1/injuries?sport=football&league=laliga");
await g("/v1/injuries?sport=football");
const m=await g("/v1/matches?sport=football&league=laliga&status=finished&limit=3");
const id=(m?.data||m?.matches||[])[0]?.id; if(id){await g(`/v1/stored/matches/${id}/stats`);await g(`/v1/stored/matches/${id}/lineups`);await g(`/v1/matches/${id}/statistics?sport=football`);}
for(const s of ["darts","boxing","cricket","tennis","snooker"])await g(`/v1/matches?sport=${s}&limit=2`);
