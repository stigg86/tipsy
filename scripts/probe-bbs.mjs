const K=process.env.BIGBALLS_KEY;const B="https://api.bigballsdata.com";
async function g(p){const r=await fetch(B+p,{headers:{Authorization:"Bearer "+K}});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{};return [r.status,j,t];}
let [s,j,t]=await g("/v1/injuries?sport=football&league=laliga");
const inj=j?.data?.injuries;console.log("injuries keys:",Object.keys(j?.data||{}),"inner:",Object.keys(inj||{}));
const v=inj?.value||[];console.log("count",v.length,"first full:",JSON.stringify(v[0]));console.log("data other:",JSON.stringify({...j.data,injuries:undefined}).slice(0,600));console.log("meta:",JSON.stringify(j.meta).slice(0,500));
const tid=v[0]?.current_team_id;
for(const p of [`/v1/teams/${tid}?sport=football`,`/v1/teams?sport=football&league=laliga`,`/v1/players/${v[0]?.id}?sport=football`]){[s,j,t]=await g(p);console.log("\n===",p,s,t.slice(0,700));}
