// One-off probe of the OddsPapi free plan. Uses 3 requests. Never prints the key.
const KEY=process.env.ODDSPAPI_KEY; if(!KEY){console.log("NO KEY");process.exit(1);}
const B="https://api.oddspapi.io/v4";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(path,params){
  const u=new URL(B+"/"+path);for(const[k,v]of Object.entries({...params,apiKey:KEY}))u.searchParams.set(k,v);
  const r=await fetch(u);const txt=await r.text();
  const hdr={};r.headers.forEach((v,k)=>{if(/limit|remain|quota|usage|credit|request/i.test(k))hdr[k]=v;});
  console.log(`\n=== /${path} ${JSON.stringify(params)} -> ${r.status}, ${(txt.length/1024).toFixed(0)} KB, headers ${JSON.stringify(hdr)}`);
  let j=null;try{j=JSON.parse(txt)}catch{console.log(txt.slice(0,400))}
  if(r.status!==200)console.log(txt.slice(0,600));
  await sleep(1500);return j;
}
const day=d=>new Date(Date.now()+d*864e5).toISOString().slice(0,10);
const T="132,234,138,904526,33994,28333,24327,131,904297,648";
for(const bk of ["pinnacle"]){
  const od=await get("odds-by-tournaments",{tournamentIds:T,bookmaker:bk,oddsFormat:"decimal"});
  const arr=Array.isArray(od)?od:(od&&od.data)||[];
  console.log(bk,"returned",arr.length,"fixtures");
  const perT={};for(const f of arr){perT[f.tournamentId]=(perT[f.tournamentId]||0)+1;}
  console.log("fixtures per tournament:",JSON.stringify(perT));
  if(arr[0]){const f=arr[0];console.log("fixture keys:",Object.keys(f).join(","));
    console.log("sample fixture:",JSON.stringify(f).slice(0,2500));}
  const nba=arr.find(f=>f.tournamentId==132);if(nba)console.log("NBA sample:",JSON.stringify(nba).slice(0,1500));
}
