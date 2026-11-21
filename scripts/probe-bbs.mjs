const K=process.env.BIGBALLS_KEY;const B="https://api.bigballsdata.com";
async function g(p){const r=await fetch(B+p,{headers:{Authorization:"Bearer "+K}});const j=await r.json().catch(()=>null);return [r.status,j];}
for(const lg of ["laliga","ucl","epl"]){
  const [s,j]=await g(`/v1/matches?sport=football&league=${lg}&status=finished&limit=100`);
  const d=j?.data||[];console.log(lg,s,"rows",d.length,"meta",JSON.stringify(j?.meta).slice(0,400));
  if(d.length)console.log(" first",d[0].kickoff_utc,d[0].home.name,"| last",d[d.length-1].kickoff_utc,d[d.length-1].home.name);
}
const [s2,j2]=await g(`/v1/matches?sport=football&league=laliga&status=finished&season=2026-27&limit=100`);console.log("season param",s2,(j2?.data||[]).length,JSON.stringify(j2?.meta).slice(0,300));
const [s3,j3]=await g(`/v1/matches?sport=football&league=laliga&status=finished&from=2026-08-01&to=2026-11-22&limit=100`);console.log("from/to",s3,(j3?.data||[]).length,JSON.stringify(j3?.meta||j3?.error).slice(0,300));
