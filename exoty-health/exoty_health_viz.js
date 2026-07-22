/**
 * Exoty Health Cards — Looker custom visualization
 * Per-game (or per-game x platform) health cards with sparklines and RAG dots,
 * from a daily Looker query.
 *
 * THREE MODES (auto-detected from the query fields):
 *   - KPI by game            : daily main_kpi query (dt_event_date, no platform dim)
 *   - KPI by game x platform  : daily main_kpi query WITH cd_install_platform (Android/iOS cards)
 *   - Technical (volumes)     : daily Crashlytics query (Android crashes / ANR, iOS crashes)
 *
 * Headline value = most recent MATURE trailing 7-day window; delta = vs the previous 7 days.
 * Sparkline = last 14 days (daily steps of the 7-day rolling metric), with hover tooltips.
 * RAG thresholds are editable from the tile's visualization settings (section "Thresholds").
 * Anchored on the viewer's current date. Fields matched by suffix, regardless of view prefix.
 */
(function () {
  var CSS = `
  .eh-wrap{--ink:#141a1f;--mut:#6b7280;--faint:#9aa1a9;--line:#e9ebef;--card:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);font-size:13px;padding:6px}
  .eh-games{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
  .eh-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 16px 10px;box-shadow:0 1px 3px rgba(16,24,40,.04)}
  .eh-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
  .eh-head h2{font-size:15.5px;margin:0;font-weight:680}
  .eh-inst{color:var(--mut);font-size:12px}
  .eh-fresh{color:var(--faint);font-size:11px;margin:1px 0 2px}
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
  .eh-note{margin-top:16px;background:#f8fafc;border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:12px;color:#4b5563;line-height:1.5}
  .eh-note b{color:var(--ink)} .eh-note .t{font-weight:680;font-size:12.5px;color:var(--ink);margin-bottom:4px}
  .eh-m2{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #f6f7f9}
  .eh-m2:last-child{border-bottom:none}
  .eh-empty{color:#6b7280;padding:24px;text-align:center}
  `;
 
  var CUR = "€", SPARK_DAYS = 14;
 
  function todayUTC(){ var d=new Date(); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())); }
  function iso(d){ return d.toISOString().slice(0,10); }
  function addDays(d,n){ var x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
  function dShort(s){ var d=new Date(s+"T00:00:00Z"); return d.getUTCDate()+" "+["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]; }
 
  function money(v){ return v==null||isNaN(v)?"—":CUR+" "+Math.round(v).toLocaleString("en-US"); }
  function cpiF(v){ return v==null||isNaN(v)?"—":CUR+" "+v.toFixed(2); }
  function arpuF(v){ return v==null||isNaN(v)?"—":CUR+" "+v.toFixed(3); }
  function arppuF(v){ return v==null||isNaN(v)?"—":CUR+" "+v.toFixed(2); }
  function pctF(v){ return v==null||isNaN(v)?"—":(v*100).toFixed(1)+"%"; }
  function intF(v){ return v==null||isNaN(v)?"—":Math.round(v).toLocaleString("en-US"); }
  function relD(c,p){ if(p==null||p===0||c==null||isNaN(p)||isNaN(c))return null; return (c-p)/Math.abs(p); }
  function deltaTxt(r){ if(r==null)return "—"; var a=r>0?"▲":(r<0?"▼":"▬"); return a+" "+Math.abs(r*100).toFixed(r===0?0:1)+"%"; }
  function rag(r,s){ if(r==null)return "neutral"; var bad=s.hb?r>=s.bad:r<=-s.bad, warn=s.hb?r>=s.warn:r<=-s.warn; return bad?"bad":(warn?"warn":"good"); }
  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
 
  function spark(vals, ragCls, opts){
    opts=opts||{}; var w=opts.w||92, dates=opts.dates||[], fmt=opts.fmt||function(v){return v;};
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
    var hits="";
    for(var q=0;q<n;q++){ if(xs[q]==null)continue; var lbl=(dates[q]?dShort(dates[q])+" — ":"")+fmt(vals[q]);
      hits+='<circle cx="'+xs[q].toFixed(1)+'" cy="'+ys[q].toFixed(1)+'" r="6" fill="transparent"><title>'+esc(lbl)+'</title></circle>'; }
    return '<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'">'
      +'<path d="'+area+'" fill="'+col+'" opacity="0.10"/>'
      +'<path d="'+line.trim()+'" fill="none" stroke="'+col+'" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>'
      +'<circle cx="'+xs[last].toFixed(1)+'" cy="'+ys[last].toFixed(1)+'" r="2.6" fill="'+col+'"/>'+hits+'</svg>';
  }
 
  function resolver(queryResponse){
    var names=[], f=queryResponse.fields;
    ["dimensions","measures","table_calculations"].forEach(function(k){ (f[k]||[]).forEach(function(x){ names.push(x.name); }); });
    return function(suffix){ for(var i=0;i<names.length;i++){ var p=names[i].split("."); if(p[p.length-1]===suffix) return names[i]; } return null; };
  }
  function cell(row,name){ if(!name||!row[name])return null; var v=row[name].value; return v==null?null:v; }
 
  function num(v,d){ var x=parseFloat(v); return isNaN(x)?d:x; }
  function buildThr(config){ config=config||{}; return {
    spendSwing:num(config.spend_swing,25)/100,
    cpi:{hb:true, warn:num(config.cpi_warn,7)/100,  bad:num(config.cpi_bad,15)/100},
    arpu:{hb:false,warn:num(config.mon_warn,5)/100, bad:num(config.mon_bad,10)/100},
    arppu:{hb:false,warn:num(config.mon_warn,5)/100,bad:num(config.mon_bad,10)/100},
    ret:{hb:false,warn:num(config.ret_warn,5)/100,  bad:num(config.ret_bad,10)/100},
    crashVol:{hb:true,warn:num(config.crash_warn,15)/100, bad:num(config.crash_bad,30)/100}
  }; }
 
  function winEnding(T, endOff, daysBack){ var end=addDays(T,-(endOff+daysBack)); var start=addDays(end,-6); return [iso(start),iso(end)]; }
  var END={spend:1,cpi:1,arpu:1,arppu:1,d1:2,d3:4,d7:8,crAnd:1,anrAnd:1,crIos:1};
  function eachDay(rg,cb){ var d=rg[0],end=rg[1]; while(d<=end){ cb(d); d=iso(addDays(new Date(d+"T00:00:00Z"),1)); } }
  function buildMetric(T, mvFn){ return function(key,name){
    var e=END[name];
    var cur=mvFn(key,name, winEnding(T,e,0)), prev=mvFn(key,name, winEnding(T,e,7));
    var s=[], dates=[]; for(var k=SPARK_DAYS-1;k>=0;k--){ var rg=winEnding(T,e,k); s.push(mvFn(key,name,rg)); dates.push(rg[1]); }
    return {cur:cur, prev:prev, s:s, dates:dates};
  }; }
 
  function noteKPI(){ return '<div class="eh-note"><div class="t">How to read — windows &amp; maturity</div>'
    +'Each metric is the most recent <b>mature trailing 7-day window</b>, compared to the <b>previous 7 days</b> (rolling — works any day). Sparkline = last <b>14 days</b>.<br>'
    +'<b>Maturity:</b> retention counts a cohort only once matured — D1 uses installs up to 2 days ago, D3 up to 4 days, D7 up to 8 days (D3/D7 reflect slightly older cohorts than D1).<br>'
    +'Ad spend, CPI, ARPU, ARPPU are rebuilt from daily building blocks and match Looker\'s native measures.</div>'; }
  function noteTech(){ return '<div class="eh-note"><div class="t">How to read</div>'
    +'Exact crash/ANR <b>volumes</b> over the most recent 7-day window vs the previous 7 days (Firebase Crashlytics). Sparkline = last 14 days. '
    +'A true crash-free rate needs Android Vitals + App Store Connect ingestion.</div>'; }
 
  /* ---- KPI cards (by game, or by game x platform) ---- */
  function renderKPICards(root, rows, R, thr, byPlatform){
    var fDate=R("dt_event_date"), fApp=R("st_app_name"), fPlat=R("cd_install_platform"),
        fInst=R("new_installs"), fCost=R("total_attribution_cost"), fRev=R("total_revenue"),
        fDau=R("count_player"), fIap=R("iap_revenue"), fPay=R("paying_player"),
        fD1=R("total_d1_cnt"), fD3=R("total_d3_cnt"), fD7=R("total_d7_cnt");
    var by={}, appOrder=[];
    function keyOf(r){
      var a=cell(r,fApp); if(a==null)return null;
      if(byPlatform){ var p=cell(r,fPlat); if(p==null)return null; if(!/^(android|ios)$/i.test(String(p)))return null;
        var lab=/ios/i.test(String(p))?"iOS":"Android"; return {k:a+" — "+lab, app:a}; }
      return {k:a, app:a};
    }
    rows.forEach(function(r){ var d=cell(r,fDate); if(d==null)return; var ko=keyOf(r); if(!ko)return;
      if(!by[ko.k]){by[ko.k]={rows:{},app:ko.app};} by[ko.k].rows[d]=r;
      if(appOrder.indexOf(ko.app)<0)appOrder.push(ko.app); });
    var keys=[];
    if(byPlatform){ appOrder.forEach(function(a){ ["Android","iOS"].forEach(function(pl){ if(by[a+" — "+pl])keys.push(a+" — "+pl); }); }); }
    else { appOrder.forEach(function(a){ if(by[a])keys.push(a); }); }
    if(!keys.length){ root.innerHTML='<div class="eh-empty">No data for the selected scope.</div>'; return; }
 
    var T=todayUTC();
    function sum(k,rg,f){ var s=0; eachDay(rg,function(d){ var r=by[k].rows[d]; if(r){var v=cell(r,f);if(v!=null)s+=(+v||0);} }); return s; }
    function ratio(a,b){ return b>0?a/b:null; }
    function mv(k,name,rg){ switch(name){
      case "spend": return sum(k,rg,fCost);
      case "cpi":   return ratio(sum(k,rg,fCost),sum(k,rg,fInst));
      case "arpu":  return ratio(sum(k,rg,fRev),sum(k,rg,fDau));
      case "arppu": return ratio(sum(k,rg,fIap),sum(k,rg,fPay));
      case "d1":    return ratio(sum(k,rg,fD1),sum(k,rg,fInst));
      case "d3":    return ratio(sum(k,rg,fD3),sum(k,rg,fInst));
      case "d7":    return ratio(sum(k,rg,fD7),sum(k,rg,fInst));
    } }
    function freshness(k){ var mx=null; for(var d in by[k].rows){ var r=by[k].rows[d]; if((+cell(r,fInst)||0)>0||(+cell(r,fDau)||0)>0){ if(mx==null||d>mx)mx=d; } } return mx; }
    var M=buildMetric(T,mv);
    function winL(name){ var r=winEnding(T,END[name],0); return dShort(r[0])+"→"+dShort(r[1]); }
    function mrow(nm,sub,val,c,rc,fmt){ return '<div class="eh-m"><div><div class="eh-name">'+nm+'</div><div class="eh-win">'+sub+'</div></div>'
      +'<div>'+spark(c.s,rc,{dates:c.dates,fmt:fmt})+'</div><div class="eh-rt"><div class="eh-valrow"><span class="eh-val">'+val+'</span><span class="eh-status eh-'+rc+'"></span></div>'
      +'<span class="eh-chip eh-'+rc+'">'+deltaTxt(relD(c.cur,c.prev))+'</span></div></div>'; }
 
    var html='<div class="eh-games">'+keys.map(function(k){
      var m={}; ["spend","cpi","arpu","arppu","d1","d3","d7"].forEach(function(n){m[n]=M(k,n);});
      var inst=sum(k,winEnding(T,1,0),fInst), fr=freshness(k);
      var rl=function(n){return relD(m[n].cur,m[n].prev);};
      var spendRag=(rl("spend")!=null&&Math.abs(rl("spend"))>=thr.spendSwing)?"warn":"neutral";
      var rg2=function(n,s){return rag(rl(n),s);};
      return '<section class="eh-card"><div class="eh-head"><h2>'+esc(k)+'</h2><span class="eh-inst">'+intF(inst)+' installs · 7d</span></div>'
        +'<div class="eh-fresh">Data through '+(fr?dShort(fr):"—")+'</div>'
        +'<div class="eh-grp">Acquisition</div>'
        +mrow("Ad spend","7d rolling ("+winL("spend")+")",money(m.spend.cur),m.spend,spendRag,money)
        +mrow("CPI","7d rolling",cpiF(m.cpi.cur),m.cpi,rg2("cpi",thr.cpi),cpiF)
        +'<div class="eh-grp">Monetization</div>'
        +mrow("ARPU (IAP+Ad)","7d rolling",arpuF(m.arpu.cur),m.arpu,rg2("arpu",thr.arpu),arpuF)
        +mrow("ARPPU (IAP)","7d rolling",arppuF(m.arppu.cur),m.arppu,rg2("arppu",thr.arppu),arppuF)
        +'<div class="eh-grp">Retention (mature cohorts)</div>'
        +mrow("Retention D1","cohort "+winL("d1"),pctF(m.d1.cur),m.d1,rg2("d1",thr.ret),pctF)
        +mrow("Retention D3","cohort "+winL("d3"),pctF(m.d3.cur),m.d3,rg2("d3",thr.ret),pctF)
        +mrow("Retention D7","cohort "+winL("d7"),pctF(m.d7.cur),m.d7,rg2("d7",thr.ret),pctF)
        +'</section>';
    }).join("")+'</div>'+noteKPI();
    root.innerHTML=html;
  }
 
  /* ---- Technical (v1 style: stacked volumes per game, no split) ---- */
  function renderTech(root, rows, R, thr){
    var fDate=R("dt_crash_date"), fApp=R("st_app_name"), fPlat=R("cd_platform"), fType=R("st_error_type"), fCnt=R("count_crash");
    var by={}, apps=[];
    rows.forEach(function(r){ var a=cell(r,fApp), d=cell(r,fDate); if(a==null||d==null)return;
      if(!by[a]){by[a]={};apps.push(a);} if(!by[a][d])by[a][d]={};
      var key=cell(r,fPlat)+"|"+cell(r,fType); by[a][d][key]=(by[a][d][key]||0)+(+cell(r,fCnt)||0); });
    var T=todayUTC();
    function sumKey(app,rg,key){ var s=0; eachDay(rg,function(d){ var day=by[app][d]; if(day&&day[key]!=null)s+=day[key]; }); return s; }
    function mv(app,name,rg){ if(name==="crAnd")return sumKey(app,rg,"ANDROID|FATAL"); if(name==="anrAnd")return sumKey(app,rg,"ANDROID|ANR"); if(name==="crIos")return sumKey(app,rg,"IOS|FATAL"); }
    function freshness(app){ var mx=null; for(var d in by[app]){ var day=by[app][d],t=0; for(var kk in day)t+=day[kk]; if(t>0){ if(mx==null||d>mx)mx=d; } } return mx; }
    var M=buildMetric(T,mv);
    function rgV(c){ return rag(relD(c.cur,c.prev),thr.crashVol); }
    function mrow(nm,sub,val,c,rc){ return '<div class="eh-m"><div><div class="eh-name">'+nm+'</div><div class="eh-win">'+sub+'</div></div>'
      +'<div>'+spark(c.s,rc,{dates:c.dates,fmt:intF})+'</div><div class="eh-rt"><div class="eh-valrow"><span class="eh-val">'+val+'</span><span class="eh-status eh-'+rc+'"></span></div>'
      +'<span class="eh-chip eh-'+rc+'">'+deltaTxt(relD(c.cur,c.prev))+'</span></div></div>'; }
    var html='<div class="eh-games">'+apps.map(function(app){
      var cra=M(app,"crAnd"), anr=M(app,"anrAnd"), cio=M(app,"crIos"); var fr=freshness(app);
      return '<section class="eh-card"><div class="eh-head"><h2>'+esc(app)+'</h2><span class="eh-inst">volumes · 7d</span></div>'
        +'<div class="eh-fresh">Data through '+(fr?dShort(fr):"—")+'</div>'
        +'<div class="eh-grp">Technical stability (7d volumes)</div>'
        +mrow("Android crashes","FATAL · 7d rolling",intF(cra.cur),cra,rgV(cra))
        +mrow("Android ANR","7d rolling",intF(anr.cur),anr,rgV(anr))
        +mrow("iOS crashes","FATAL · 7d rolling",intF(cio.cur),cio,rgV(cio))
        +'</section>';
    }).join("")+'</div>'+noteTech();
    root.innerHTML=html;
  }
 
  /* ---- Monthly summary : MTD spend + organic/paid installs, vs prev month (same days elapsed) ---- */
  function renderMonthly(root, rows, R){
    var fDate=R("dt_event_date"), fApp=R("st_app_name"), fPaid=R("is_paid"), fInst=R("new_installs"), fCost=R("total_attribution_cost");
    var MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var by={}, apps=[];
    rows.forEach(function(r){ var a=cell(r,fApp), d=cell(r,fDate); if(a==null||d==null)return;
      if(!by[a]){by[a]={};apps.push(a);}
      if(!by[a][d])by[a][d]={spend:0,paid:0,org:0};
      var cost=+cell(r,fCost)||0, inst=+cell(r,fInst)||0, pd=String(cell(r,fPaid)||"");
      by[a][d].spend+=cost; if(/paid/i.test(pd)) by[a][d].paid+=inst; else by[a][d].org+=inst; });
    // reference = today's calendar day: compare the same number of elapsed days month-over-month
    if(!apps.length){ root.innerHTML='<div class="eh-empty">No data.</div>'; return; }
    var T=todayUTC(); var N=T.getUTCDate(); var curYM=iso(T).slice(0,7);
    var y=parseInt(curYM.slice(0,4),10), m=parseInt(curYM.slice(5,7),10); var pm=m-1, py=y; if(pm<1){pm=12;py--;}
    var prevYM=py+"-"+(pm<10?"0"+pm:pm);
    function agg(a,ym){ var s={spend:0,paid:0,org:0}; for(var d in by[a]){ if(d.slice(0,7)!==ym)continue; if(parseInt(d.slice(8,10),10)>N)continue; var x=by[a][d]; s.spend+=x.spend;s.paid+=x.paid;s.org+=x.org; } return s; }
    function monLbl(ym){ return MON[parseInt(ym.slice(5,7),10)-1]; }
    var sub="Month-to-date, days 1–"+N+": "+monLbl(curYM)+" vs "+monLbl(prevYM)+" (same elapsed days)";
    function row2(nm,val,cur,prev,growth){ var r=relD(cur,prev); var rc=growth?(r==null?"neutral":(r>=0?"good":"bad")):"neutral";
      return '<div class="eh-m2"><div class="eh-name">'+nm+'</div><div class="eh-rt"><div class="eh-valrow"><span class="eh-val">'+val+'</span></div><span class="eh-chip eh-'+rc+'">'+deltaTxt(r)+'</span></div></div>'; }
 
    var html='<div class="eh-games">'+apps.map(function(app){
      var c=agg(app,curYM), p=agg(app,prevYM);
      return '<section class="eh-card"><div class="eh-head"><h2>'+esc(app)+'</h2><span class="eh-inst">Month to date</span></div>'
        +'<div class="eh-fresh">'+sub+'</div>'
        +'<div class="eh-grp">Spend</div>'
        +row2("Global spend (MTD)",money(c.spend),c.spend,p.spend,false)
        +'<div class="eh-grp">Installs</div>'
        +row2("Paid installs",intF(c.paid),c.paid,p.paid,true)
        +row2("Organic installs",intF(c.org),c.org,p.org,true)
        +'</section>';
    }).join("")+'</div>';
    root.innerHTML=html;
  }
 
  looker.plugins.visualizations.add({
    id: "exoty_health_cards",
    label: "Exoty Health Cards",
    options: {
      spend_swing:{type:"number", label:"Spend swing alert (± % WoW)", default:25, section:"Thresholds", order:1},
      cpi_warn:{type:"number", label:"CPI warn (+% WoW)", default:7, section:"Thresholds", order:2},
      cpi_bad:{type:"number", label:"CPI alert (+% WoW)", default:15, section:"Thresholds", order:3},
      mon_warn:{type:"number", label:"ARPU/ARPPU warn (−% WoW)", default:5, section:"Thresholds", order:4},
      mon_bad:{type:"number", label:"ARPU/ARPPU alert (−% WoW)", default:10, section:"Thresholds", order:5},
      ret_warn:{type:"number", label:"Retention warn (−% WoW)", default:5, section:"Thresholds", order:6},
      ret_bad:{type:"number", label:"Retention alert (−% WoW)", default:10, section:"Thresholds", order:7},
      crash_warn:{type:"number", label:"Crashes/ANR warn (+% WoW)", default:15, section:"Thresholds", order:8},
      crash_bad:{type:"number", label:"Crashes/ANR alert (+% WoW)", default:30, section:"Thresholds", order:9}
    },
    create: function (element) {
      var s=document.createElement("style"); s.innerHTML=CSS; element.appendChild(s);
      this._root=document.createElement("div"); this._root.className="eh-wrap"; element.appendChild(this._root);
    },
    updateAsync: function (data, element, config, queryResponse, details, done) {
      try{
        var R=resolver(queryResponse), thr=buildThr(config);
        if(!data || !data.length){ this._root.innerHTML='<div class="eh-empty">No data returned by the query.</div>'; return done(); }
        if(R("is_paid") && R("dt_event_date")){ renderMonthly(this._root, data, R); }
        else if(R("count_crash")){ renderTech(this._root, data, R, thr); }
        else if(R("dt_event_date")){ renderKPICards(this._root, data, R, thr, !!R("cd_install_platform")); }
        else { this._root.innerHTML='<div class="eh-empty">Unrecognized query. Provide a daily main_kpi query (KPI) or a daily Crashlytics query (technical).</div>'; }
      }catch(e){ this._root.innerHTML='<div class="eh-empty">Error: '+(e&&e.message?e.message:e)+'</div>'; }
      done();
    }
  });
})();
