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
const sports=await get("sports",{});
const SN={};if(Array.isArray(sports)){for(const s of sports)SN[s.sportId??s.id]=s.sportName??s.name??s.slug;console.log(sports.length,"sports:",Object.entries(SN).map(([i,n])=>i+":"+n).join(", "));}
const fx=await get("fixtures",{from:day(0),to:day(2)});
if(Array.isArray(fx)){
  console.log(fx.length,"fixtures in next 2 days. First item keys:",Object.keys(fx[0]||{}).join(","));
  console.log("sample:",JSON.stringify(fx[0]).slice(0,500));
  const T={};for(const f of fx){const k=f.tournamentId;T[k]=T[k]||{n:0,odds:0,sport:SN[f.sportId]||f.sportId,name:f.tournamentName||f.tournamentSlug||"",cat:f.categoryName||""};T[k].n++;if(f.hasOdds)T[k].odds++;}
  const bySport={};for(const f of fx){const s=SN[f.sportId]||f.sportId;bySport[s]=(bySport[s]||0)+1;}
  console.log("fixtures by sport:",JSON.stringify(bySport));
  const top=Object.entries(T).sort((a,b)=>b[1].odds-a[1].odds||b[1].n-a[1].n);
  console.log("top tournaments:");for(const[id,t]of top.slice(0,40))console.log(" ",id,t.sport,"|",t.cat,"|",t.name,"| fixtures",t.n,"with odds",t.odds);
  // pick the busiest tournament from up to 8 different sports
  const seen=new Set(),pick=[];for(const[id,t]of top){if(t.odds<1||seen.has(t.sport))continue;seen.add(t.sport);pick.push(id);if(pick.length>=8)break;}
  console.log("probing odds for tournaments",pick.join(","));
  const od=await get("odds-by-tournaments",{tournamentIds:pick.join(","),oddsFormat:"decimal"});
  const arr=Array.isArray(od)?od:(od&&od.data)||[];
  console.log("odds-by-tournaments returned",arr.length,"fixtures");
  const perT={};for(const f of arr){perT[f.tournamentId]=(perT[f.tournamentId]||0)+1;}
  console.log("fixtures per tournament:",JSON.stringify(perT));
  if(arr[0]){const f=arr[0];console.log("fixture keys:",Object.keys(f).join(","));
    const bo=f.bookmakerOdds||{};const books=Object.keys(bo);console.log("bookmakers on first fixture:",books.length,books.slice(0,60).join(","));
    const b0=bo[books.find(b=>/bet365|williamhill|skybet|paddy|ladbrokes/.test(b))||books[0]];
    console.log("one bookmaker sample:",JSON.stringify(b0).slice(0,1200));}
}
