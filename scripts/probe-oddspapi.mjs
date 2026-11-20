const d=new Date(Date.now()-864e5).toISOString().slice(0,10).replace(/-/g,"");
const L=["basketball/nba","hockey/nhl","football/nfl","football/college-football","basketball/mens-college-basketball","basketball/womens-college-basketball","tennis/atp","tennis/wta","mma/ufc","soccer/eng.2","soccer/sco.1","soccer/ned.1","soccer/uefa.champions","boxing/boxing","australian-football/afl"];
for(const l of L){
  try{const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/${l}/scoreboard?dates=${d}&limit=300`);const j=r.ok?await r.json():null;
    const ev=j?.events||[];const fin=ev.filter(e=>e.status?.type?.completed);
    let s="";if(fin[0]){const c=fin[0].competitions?.[0];s=(c?.competitors||[]).map(x=>`${x.team?.displayName||x.athlete?.displayName}:${x.score??"?"}${x.winner?"(W)":""}`).join(" v ");
      if(!s&&fin[0].groupings)s="tennis groupings "+fin[0].groupings.length;}
    console.log(l,r.status,"events",ev.length,"finished",fin.length,"|",s.slice(0,160));
    if(l==="tennis/atp"&&j){const g=j.events?.[0]?.groupings?.[0]?.competitions?.[0];console.log("  atp comp sample:",JSON.stringify(g).slice(0,500));}
  }catch(e){console.log(l,"ERR",e.message)}
}
