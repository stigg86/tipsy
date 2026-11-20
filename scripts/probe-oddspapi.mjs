const KEY=process.env.ODDSPAPI_KEY;
const day=d=>new Date(Date.now()+d*864e5).toISOString().slice(0,10);
const u=new URL("https://api.oddspapi.io/v4/fixtures");for(const[k,v]of Object.entries({from:day(-1),to:day(0),apiKey:KEY}))u.searchParams.set(k,v);
const r=await fetch(u);const t=await r.text();console.log("status",r.status,(t.length/1024|0)+"KB");
const a=JSON.parse(t);console.log("fixtures",a.length);
const keys=new Set();for(const f of a)Object.keys(f).forEach(k=>keys.add(k));console.log("all keys:",[...keys].join(","));
const st={};for(const f of a)st[f.statusId]=(st[f.statusId]||0)+1;console.log("statusId counts",JSON.stringify(st));
const nba=a.filter(f=>/NBA/.test(f.tournamentName||"")).slice(0,3);for(const f of nba)console.log("NBA:",JSON.stringify(f).slice(0,700));
const ten=a.find(f=>f.sportId===12&&f.statusId!==0);if(ten)console.log("Tennis:",JSON.stringify(ten).slice(0,700));
