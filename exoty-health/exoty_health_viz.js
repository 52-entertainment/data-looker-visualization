/**
 * Exoty Health Cards — Looker custom visualization
 * Reproduces the "Game health" card design (per-game cards, sparklines, RAG dots)
 * from a daily Looker query.
 *
 * TWO MODES (auto-detected from the query fields):
 *   - KPI mode        : daily main_kpi query  (Acquisition, Monetization, Retention)
 *   - Technical mode  : daily Crashlytics query (General + Android / iOS split)
 *
 * Headline value = most recent MATURE trailing 7-day window; delta = vs the previous 7 days.
 * Sparkline = last 14 days (daily steps of the 7-day rolling metric).
 * Anchored on the viewer's current date. Fields matched by suffix, regardless of view prefix.
 */
(function () {
  var CSS = `
  .eh-wrap{--ink:#141a1f;--mut:#6b7280;--faint:#9aa1a9;--line:#e9ebef;--card:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);font-size:13px;padding:6px}
  .eh-games{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
  .eh-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 16px 10px;box-shadow:0 1px 3px rgba(16,24,40,.04)}
  .eh-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:2px}
  .eh-head h2{font-size:16px;margin:0;font-weight:680}
  .eh-inst{color:var(--mut);font-size:12px}
  .eh-grp{font-size:10.5px;font-weight:750;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin:14px 0 4px;padding-top:11px;border-top:1px solid #f1f2f5}
  .eh-grp:first-of-type{border-top:none;padding-top:2px}
  .eh-m{display:grid;grid-template-columns:1fr 92px auto;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f6f7f9}
  .eh-m:last-child{border-bottom:none}
  .eh-name{font-weight:570;font-size:13.5px}
  .eh-win{color:var(--faint);font-size:10.5px;margin-top:1px}
  .eh-rt{display:flex;flex-direction:column;align-items:flex-end;gap:3px;min-width:96px}
  .eh-valrow{display:flex;align-items:center;gap:7px}
  .eh-val{font-variant-numeric:tabular-nums;font-weight:680;font-size:15.5px}
  .eh-status{width:8px;height:8px;border-radius:50%;flex:none}
  .eh-good{background:#16a34a}.eh-warn{background:#e0871b}.eh-bad{background:#dc2626}.eh-neutral{background:#cfd4da}
  .eh-chip{font-size:11px;font-variant-numeric:tabular-nums;padding:1px 7px;border-radius:20px;font-weight:640}
  .eh-chip.eh-good{background:#e6f6ec;color:#15803d}
  .eh-chip.eh-warn{background:#fbefdc;color:#a35a09}
  .eh-chip.eh-bad{background:#fbe7e7;color:#b91c1c}
  .eh-chip.eh-neutral{background:#eef0f2;color:#6b7280}
  .eh-split{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:6px}
  .eh-col h3{font-size:11px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);margin:0 0 4px;padding-bottom:4px;border-bottom:1px solid #f1f2f5}
  .eh-ms{padding:7px 0;border-bottom:1px solid #f6f7f9}
  .eh-ms:last-child{border-bottom:none}
  .eh-ms .top{display:flex;align-items:center;justify-content:space-between;gap:6px}
  .eh-ms .nm{font-weight:560;font-size:12.5px}
  .eh-ms .bot{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:3px}
  .eh-empty{color:#6b7280;padding:24px;text-align:center}
  `;
 
  var CFG = {
    currency: "€", sparkDays: 14,
    thr: {
      cpi:{hb:true,warn:0.07,bad:0.15}, arpu:{hb:false,warn:0.05,bad:0.10}, arppu:{hb:false,warn:0.05,bad:0.10},
      ret:{hb:false,warn:0.05,bad:0.10}, crashVol:{hb:true,warn:0.15,bad:0.30}, spendSwing:0.25
    }
  };
 
  /* ---- dates ---- */
  function todayUTC(){ var d=new Date(); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())); }
  function iso(d){ return d.toISOString().slice(0,10); }
  function addDays(d,n){ var x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
  function dShort(s){ var d=new Date(s+"T00:00:00Z"); return d.getUTCDate()+" "+["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]; }
 
  /* ---- format ---- */
  function money(v){ return v==null||isNaN(v)?"—":CFG.currency+" "+Math.round(v).toLocaleString("en-US"); }
  function cpiF(v){ return v==null||isNaN(v)?"—":CFG.currency+" "+v.toFixed(2); }
  function arpuF(v){ return v==null||isNaN(v)?"—":CFG.currency+" "+v.toFixed(3); }
  function arppuF(v){ return v==null||isNaN(v)?"—":CFG.currency+" "+v.toFixed(2); }
  function pctF(v){ return v==null||isNaN(v)?"—":(v*100).toFixed(1)+"%"; }
  function intF(v){ return v==null||isNaN(v)?"—":Math.round(v).toLocaleString("en-US"); }
  function relD(c,p){ if(p==null||p===0||c==null||isNaN(p)||isNaN(c))return null; return (c-p)/Math.abs(p); }
  function deltaTxt(r){ if(r==null)return "—"; var a=r>0?"▲":(r<0?"▼":"▬"); return a+" "+Math.abs(r*100).toFixed(r===0?0:1)+"%"; }
  function rag(r,s){ if(r==null)return "neutral"; var bad=s.hb?r>=s.bad:r<=-s.bad, warn=s.hb?r>=s.warn:r<=-s.warn; return bad?"bad":(warn?"warn":"good"); }
 
  /* ---- sparkline (14 daily points) ---- */
  function spark(vals, ragCls, w){
    w=w||92;
    var pts=vals.filter(function(v){return v!=null && !isNaN(v);});
    if(pts.length<2) return '<svg width="'+w+'" height="28"></svg>';
    var h=28,pad=4, mn=Math.min.apply(null,pts), mx=Math.max.apply(null,pts);
    if(mn===mx){mn=mn-1;mx=mx+1;}
    var col=ragCls==="bad"?"#dc2626":ragCls==="warn"?"#e0871b":ragCls==="good"?"#16a34a":"#8b93a1";
    var n=vals.length, xs=[], ys=[];
    for(var i=0;i<n;i++){ var v=vals[i]; if(v==null||isNaN(v)){xs.push(null);ys.push(null);continue;}
      xs.push(pad+i*(w-2*pad)/(n-1)); ys.push(h-pad-(v-mn)/(mx-mn)*(h-2*pad)); }
    var line="",started=false,first=null,last=null;
    for(var j=0;j<n;j++){ if(xs[j]==null)continue; line+=(started?"L":"M")+xs[j].toFixed(1)+","+ys[j].toFixed(1)+" "; started=true; if(first==null)first=j; last=j; }
    var area="M"+xs[first].toFixed(1)+","+(h-pad)+" "+line.replace(/^M/,"L")+"L"+xs[last].toFixed(1)+","+(h-pad)+" Z";
    return '<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'">'
      +'<path d="'+area+'" fill="'+col+'" opacity="0.10"/>'
      +'<path d="'+line.trim()+'" fill="none" stroke="'+col+'" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>'
      +'<circle cx="'+xs[last].toFixed(1)+'" cy="'+ys[last].toFixed(1)+'" r="2.6" fill="'+col+'"/></svg>';
  }
 
  /* ---- field resolver ---- */
  function resolver(queryResponse){
    var names=[], f=queryResponse.fields;
    ["dimensions","measures","table_calculations"].forEach(function(k){ (f[k]||[]).forEach(function(x){ names.push(x.name); }); });
    return function(suffix){ for(var i=0;i<names.length;i++){ var p=names[i].split("."); if(p[p.length-1]===suffix) return names[i]; } return null; };
  }
  function cell(row,name){ if(!name||!row[name])return null; var v=row[name].value; return v==null?null:v; }
 
  /* ---- windows ---- */
  // window ending "daysBack" days before today (minus endOff), spanning 7 days
  function winEnding(T, endOff, daysBack){ var end=addDays(T,-(endOff+daysBack)); var start=addDays(end,-6); return [iso(start),iso(end)]; }
  var END={spend:1,cpi:1,arpu:1,arppu:1,d1:2,d3:4,d7:8,crAnd:1,anrAnd:1,crIos:1,crTot:1};
 
  function buildMetric(T, mvFn){
    // returns function(app,name) -> {cur, prev, s(14 daily points, oldest->newest)}
    return function(app,name){
      var endOff=END[name];
      var cur=mvFn(app,name, winEnding(T,endOff,0));
      var prev=mvFn(app,name, winEnding(T,endOff,7));
      var s=[]; for(var k=CFG.sparkDays-1;k>=0;k--) s.push(mvFn(app,name, winEnding(T,endOff,k)));
      return {cur:cur, prev:prev, s:s};
    };
  }
  function eachDay(rg,cb){ var d=rg[0],end=rg[1]; while(d<=end){ cb(d); d=iso(addDays(new Date(d+"T00:00:00Z"),1)); } }
 
  /* ---- KPI mode ---- */
  function renderKPI(root, rows, R){
    var fDate=R("dt_event_date"), fApp=R("st_app_name"), fInst=R("new_installs"), fCost=R("total_attribution_cost"),
        fRev=R("total_revenue"), fDau=R("count_player"), fIap=R("iap_revenue"), fPay=R("paying_player"),
        fD1=R("total_d1_cnt"), fD3=R("total_d3_cnt"), fD7=R("total_d7_cnt");
    var by={}, apps=[];
    rows.forEach(function(r){ var a=cell(r,fApp), d=cell(r,fDate); if(a==null||d==null)return; if(!by[a]){by[a]={};apps.push(a);} by[a][d]=r; });
    var T=todayUTC();
    function sum(app,rg,f){ var s=0; eachDay(rg,function(d){ var r=by[app][d]; if(r){var v=cell(r,f); if(v!=null)s+=(+v||0);} }); return s; }
    function ratio(a,b){ return b>0?a/b:null; }
    function mv(app,name,rg){ switch(name){
      case "spend": return sum(app,rg,fCost);
      case "cpi":   return ratio(sum(app,rg,fCost),sum(app,rg,fInst));
      case "arpu":  return ratio(sum(app,rg,fRev),sum(app,rg,fDau));
      case "arppu": return ratio(sum(app,rg,fIap),sum(app,rg,fPay));
      case "d1":    return ratio(sum(app,rg,fD1),sum(app,rg,fInst));
      case "d3":    return ratio(sum(app,rg,fD3),sum(app,rg,fInst));
      case "d7":    return ratio(sum(app,rg,fD7),sum(app,rg,fInst));
    } }
    var M=buildMetric(T,mv);
    function winL(name){ var r=winEnding(T,END[name],0); return dShort(r[0])+"→"+dShort(r[1]); }
    function mrow(nm,sub,val,c,rc){ return '<div class="eh-m"><div><div class="eh-name">'+nm+'</div><div class="eh-win">'+sub+'</div></div>'
      +'<div>'+spark(c.s,rc)+'</div><div class="eh-rt"><div class="eh-valrow"><span class="eh-val">'+val+'</span><span class="eh-status eh-'+rc+'"></span></div>'
      +'<span class="eh-chip eh-'+rc+'">'+deltaTxt(relD(c.cur,c.prev))+'</span></div></div>'; }
 
    var html='<div class="eh-games">'+apps.map(function(app){
      var m={}; ["spend","cpi","arpu","arppu","d1","d3","d7"].forEach(function(n){m[n]=M(app,n);});
      var inst=sum(app,winEnding(T,1,0),fInst);
      var rl=function(n){return relD(m[n].cur,m[n].prev);};
      var spendRag=(rl("spend")!=null&&Math.abs(rl("spend"))>=CFG.thr.spendSwing)?"warn":"neutral";
      var rg2=function(n,s){return rag(rl(n),s);};
      return '<section class="eh-card"><div class="eh-head"><h2>'+app+'</h2><span class="eh-inst">'+intF(inst)+' installs · 7d</span></div>'
        +'<div class="eh-grp">Acquisition</div>'
        +mrow("Ad spend","7d rolling ("+winL("spend")+")",money(m.spend.cur),m.spend,spendRag)
        +mrow("CPI","7d rolling",cpiF(m.cpi.cur),m.cpi,rg2("cpi",CFG.thr.cpi))
        +'<div class="eh-grp">Monetization</div>'
        +mrow("ARPU (IAP+Ad)","7d rolling",arpuF(m.arpu.cur),m.arpu,rg2("arpu",CFG.thr.arpu))
        +mrow("ARPPU (IAP)","7d rolling",arppuF(m.arppu.cur),m.arppu,rg2("arppu",CFG.thr.arppu))
        +'<div class="eh-grp">Retention (mature cohorts)</div>'
        +mrow("Retention D1","cohort "+winL("d1"),pctF(m.d1.cur),m.d1,rg2("d1",CFG.thr.ret))
        +mrow("Retention D3","cohort "+winL("d3"),pctF(m.d3.cur),m.d3,rg2("d3",CFG.thr.ret))
        +mrow("Retention D7","cohort "+winL("d7"),pctF(m.d7.cur),m.d7,rg2("d7",CFG.thr.ret))
        +'</section>';
    }).join("")+'</div>';
    root.innerHTML=html;
  }
 
  /* ---- Technical mode : General (top) + Android/iOS split ---- */
  function renderTech(root, rows, R){
    var fDate=R("dt_crash_date"), fApp=R("st_app_name"), fPlat=R("cd_platform"), fType=R("st_error_type"), fCnt=R("count_crash");
    var by={}, apps=[];
    rows.forEach(function(r){ var a=cell(r,fApp), d=cell(r,fDate); if(a==null||d==null)return;
      if(!by[a]){by[a]={};apps.push(a);} if(!by[a][d])by[a][d]={};
      var key=cell(r,fPlat)+"|"+cell(r,fType); by[a][d][key]=(by[a][d][key]||0)+(+cell(r,fCnt)||0); });
    var T=todayUTC();
    function sumKey(app,rg,key){ var s=0; eachDay(rg,function(d){ var day=by[app][d]; if(day&&day[key]!=null)s+=day[key]; }); return s; }
    function mv(app,name,rg){
      if(name==="crAnd") return sumKey(app,rg,"ANDROID|FATAL");
      if(name==="anrAnd")return sumKey(app,rg,"ANDROID|ANR");
      if(name==="crIos") return sumKey(app,rg,"IOS|FATAL");
      if(name==="crTot") return sumKey(app,rg,"ANDROID|FATAL")+sumKey(app,rg,"IOS|FATAL");
    }
    var M=buildMetric(T,mv);
    function rgV(c){ return rag(relD(c.cur,c.prev),CFG.thr.crashVol); }
    // full-width row (general)
    function mrow(nm,sub,val,c,rc){ return '<div class="eh-m"><div><div class="eh-name">'+nm+'</div><div class="eh-win">'+sub+'</div></div>'
      +'<div>'+spark(c.s,rc)+'</div><div class="eh-rt"><div class="eh-valrow"><span class="eh-val">'+val+'</span><span class="eh-status eh-'+rc+'"></span></div>'
      +'<span class="eh-chip eh-'+rc+'">'+deltaTxt(relD(c.cur,c.prev))+'</span></div></div>'; }
    // compact stacked metric (for split columns)
    function ms(nm,val,c,rc){ return '<div class="eh-ms"><div class="top"><span class="nm">'+nm+'</span><span class="eh-status eh-'+rc+'"></span></div>'
      +'<div class="bot"><span class="eh-val">'+val+'</span><span>'+spark(c.s,rc,84)+'</span><span class="eh-chip eh-'+rc+'">'+deltaTxt(relD(c.cur,c.prev))+'</span></div></div>'; }
 
    var html='<div class="eh-games">'+apps.map(function(app){
      var tot=M(app,"crTot"), cra=M(app,"crAnd"), anr=M(app,"anrAnd"), cio=M(app,"crIos");
      return '<section class="eh-card"><div class="eh-head"><h2>'+app+'</h2><span class="eh-inst">volumes · 7d</span></div>'
        +'<div class="eh-grp">Général (toutes plateformes)</div>'
        +mrow("Total crashes","FATAL · 7d rolling",intF(tot.cur),tot,rgV(tot))
        +'<div class="eh-grp">Par plateforme</div>'
        +'<div class="eh-split">'
          +'<div class="eh-col"><h3>Android</h3>'
            +ms("Crashes",intF(cra.cur),cra,rgV(cra))
            +ms("ANR",intF(anr.cur),anr,rgV(anr))
          +'</div>'
          +'<div class="eh-col"><h3>iOS</h3>'
            +ms("Crashes",intF(cio.cur),cio,rgV(cio))
          +'</div>'
        +'</div>'
        +'</section>';
    }).join("")+'</div>';
    root.innerHTML=html;
  }
 
  looker.plugins.visualizations.add({
    id: "exoty_health_cards",
    label: "Exoty Health Cards",
    options: {},
    create: function (element) {
      var s=document.createElement("style"); s.innerHTML=CSS; element.appendChild(s);
      this._root=document.createElement("div"); this._root.className="eh-wrap"; element.appendChild(this._root);
    },
    updateAsync: function (data, element, config, queryResponse, details, done) {
      try{
        var R=resolver(queryResponse);
        if(!data || !data.length){ this._root.innerHTML='<div class="eh-empty">No data returned by the query.</div>'; return done(); }
        if(R("count_crash")){ renderTech(this._root, data, R); }
        else if(R("dt_event_date")){ renderKPI(this._root, data, R); }
        else { this._root.innerHTML='<div class="eh-empty">Unrecognized query. Provide a daily main_kpi query (KPI) or a daily Crashlytics query (technical).</div>'; }
      }catch(e){ this._root.innerHTML='<div class="eh-empty">Error: '+(e&&e.message?e.message:e)+'</div>'; }
      done();
    }
  });
})();
