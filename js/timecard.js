/* timecard.js
   Timecard: clock in / out, hours worked, and when you can leave - the personal version of the work timecard app.
   Data lives in Records, one row per DATE (so every device writes the same row, never a duplicate):
     mod "clock"     {id: dayId(date), date, time: clock-in "HH:MM", text: note, extra: JSON {out:"HH:MM", lunch?:minutes, smoke?:count}}
     mod "clockcfg"  {id: CFG_ID, extra: JSON {hoursPerDay, lunchMin, smokeMin, workDays, smokeOn, mode}}
   Smoking taps come from the Counters module ("smoke") unless a day has its own count.
   Rules (same as the work timecard app):
     worked = (out - in) - lunch - smokeCount x smokeMin          ("pure": smoke breaks are not work)
     total  = (out - in) - lunch                                   (smoke breaks count as work)
     leave  = in + hoursPerDay + lunch + smokeCount x smokeMin
   The week runs Monday..workDays; once the rest of the week needs less than a full day, you can leave early. */
(function(){
var CFG_ID=390000000000000;
var DEF={hoursPerDay:8,lunchMin:60,smokeMin:7,workDays:5,smokeOn:true,mode:"pure"};
var PLAN_KEY="pocketledger.tc.plan";
var selDate=null,wkOff=0,editKey=null;

/* ---- dates and times (plain "yyyy-mm-dd" / "HH:MM" strings, never time zones) ---- */
function pad(n){return String(n).padStart(2,"0")}
function toMin(t){return /^\d\d:\d\d$/.test(t||"")?+t.slice(0,2)*60+ +t.slice(3,5):null}
function fromMin(m){m=((Math.round(m)%1440)+1440)%1440;return pad(Math.floor(m/60))+":"+pad(m%60)}
function hm(m){var neg=m<0;m=Math.abs(Math.round(m));return (neg?"−":"")+Math.floor(m/60)+":"+pad(m%60)}
function hms(sec){sec=Math.max(0,Math.floor(sec));return Math.floor(sec/3600)+":"+pad(Math.floor(sec/60)%60)+":"+pad(sec%60)}
function addDays(date,n){var d=new Date(date+"T00:00:00");d.setDate(d.getDate()+n);return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function dow(date){return (new Date(date+"T00:00:00").getDay()+6)%7}            /* Monday = 0 */
function mondayOf(date){return addDays(date,-dow(date))}
function dayId(date){var p=date.split("-");return 4e14+Math.round((Date.UTC(+p[0],+p[1]-1,+p[2])-Date.UTC(2000,0,1))/864e5)}
function nowMin(){var n=new Date();return n.getHours()*60+n.getMinutes()}
function nowSec(){var n=new Date();return n.getHours()*3600+n.getMinutes()*60+n.getSeconds()}

/* ---- settings ---- */
function cfg(mode){
  var r=PL.rec.get(CFG_ID),x=r?PL.rec.data(r):{},o={};
  Object.keys(DEF).forEach(function(k){o[k]=x[k]!==undefined?x[k]:DEF[k]});
  if(mode)o.mode=mode;                                                  /* "pure" | "total": try the other way of counting without saving it */
  return o;
}
function saveCfg(patch){
  var c=cfg();Object.keys(patch).forEach(function(k){c[k]=patch[k]});
  PL.rec.add({id:CFG_ID,mod:"clockcfg",date:"2000-01-01",extra:c});
}

/* ---- one day ---- */
function tapSum(id,date){
  try{var m=PL.counters&&PL.counters.index()[id];var t=0;((m&&m[date])||[]).forEach(function(r){t+=r.val});return Math.round(t*1000)/1000}catch(e){return 0}
}
function smokeCount(date){return Math.round(tapSum("smoke",date))}
function isSet(v){return v!==undefined&&v!==null&&v!==""}
function day(date){
  var r=PL.rec.get(dayId(date)),x=r?PL.rec.data(r):{};
  var c=cfg();
  var smoke=isSet(x.smoke)?+x.smoke:smokeCount(date);
  return {date:date,row:r||null,in:r?r.time:"",out:x.out||"",note:r?r.text:"",lunchSet:x.lunch,lunch:isSet(x.lunch)?+x.lunch:c.lunchMin,smokeSet:x.smoke,smoke:c.smokeOn?smoke:0,smokeRaw:smoke,
    coffeeSet:x.coffee,waterSet:x.water,coffee:isSet(x.coffee)?+x.coffee:tapSum("coffee",date),water:isSet(x.water)?+x.water:tapSum("water",date),
    smokeTaps:smokeCount(date),coffeeTaps:tapSum("coffee",date),waterTaps:tapSum("water",date)};
}
function saveDay(date,patch){
  var d=day(date),n={in:d.in,out:d.out,note:d.note,lunch:d.lunchSet,smoke:d.smokeSet,coffee:d.coffeeSet,water:d.waterSet};
  Object.keys(patch).forEach(function(k){n[k]=patch[k]});
  var empty=!n.in&&!n.out&&!n.note&&!isSet(n.lunch)&&!isSet(n.smoke)&&!isSet(n.coffee)&&!isSet(n.water);
  if(empty){if(d.row)PL.rec.del(d.row.id);return null}
  var x={out:n.out||""};
  if(isSet(n.lunch))x.lunch=+n.lunch;
  if(isSet(n.smoke))x.smoke=+n.smoke;
  if(isSet(n.coffee))x.coffee=+n.coffee;
  if(isSet(n.water))x.water=+n.water;
  return PL.rec.add({id:dayId(date),mod:"clock",date:date,time:n.in||"",text:n.note||"",extra:x});
}
/* minutes: span, pure work, total work, minutes of smoke breaks; null until both clock times exist */
function hours(d){
  var i=toMin(d.in),o=toMin(d.out);
  if(i===null||o===null)return null;
  var span=(o-i+1440)%1440,sm=d.smoke*cfg().smokeMin;
  return {span:span,pure:Math.max(0,span-d.lunch-sm),total:Math.max(0,span-d.lunch),smokeMin:sm};
}
function worked(h,mode){return h?(mode==="total"?h.total:h.pure):0}
/* when today's work is done if you clocked in at `inM` */
function leaveAt(inM,d,c){return inM+c.hoursPerDay*60+d.lunch+(c.mode==="pure"?d.smoke*c.smokeMin:0)}

/* ---- the week ---- */
function weekDays(date,c){var m=mondayOf(date),o=[];for(var i=0;i<c.workDays;i++)o.push(addDays(m,i));return o}
function weekInfo(date,mode){
  var c=cfg(mode),days=weekDays(date,c),t=today(),done=0,before=0,rows=[];
  days.forEach(function(dt){
    var d=day(dt),h=hours(d),w=worked(h,c.mode);
    done+=w;if(dt<t)before+=w;
    rows.push({date:dt,d:d,h:h,w:w,over:h?w-c.hoursPerDay*60:null,future:dt>t,today:dt===t});
  });
  return {cfg:c,days:days,rows:rows,done:done,before:before,target:c.workDays*c.hoursPerDay*60};
}
/* can you leave early today? remaining = what the week still needs before today's work */
function leaveToday(date,mode){
  var c=cfg(mode),wi=weekInfo(date,mode),d=day(date),i=toMin(d.in);
  if(i===null)return null;
  var before=0;wi.rows.forEach(function(r){if(r.date<date)before+=r.w});                /* what was done on the days before this one */
  var remaining=Math.max(0,wi.target-before),need=Math.min(c.hoursPerDay*60,remaining);
  return {normal:leaveAt(i,d,c),need:need,remaining:remaining,leave:i+need+d.lunch+(c.mode==="pure"?d.smoke*c.smokeMin:0),early:remaining<c.hoursPerDay*60};
}
/* the last workday's leave time: past days as recorded, today as assumed, the days in between as normal days */
function planWeek(date,opt){
  var c=cfg(opt.mode),wi=weekInfo(date,opt.mode),t=today(),last=wi.days[wi.days.length-1];
  if(date!==t||t>last)return null;
  var sum=0,sm=0,n=0;
  wi.rows.forEach(function(r){if(r.h){sm+=r.d.smoke;n++}});
  var expSmoke=c.mode==="pure"&&n?Math.round(sm/n)*c.smokeMin:0;
  wi.rows.forEach(function(r){
    if(r.date===last&&t!==last)return;
    if(r.date<t){sum+=r.w}
    else if(r.date===t){
      if(r.h)sum+=r.w;
      else{var i=toMin(r.d.in),lv=opt.todayLeave!==undefined?opt.todayLeave:(i!==null?leaveAt(i,r.d,c):null);
        if(i!==null&&lv!==null){var span=(lv-i+1440)%1440,s2=c.mode==="pure"?r.d.smoke*c.smokeMin:0;sum+=Math.max(0,span-r.d.lunch-s2)}else sum+=c.hoursPerDay*60}
    }else sum+=c.hoursPerDay*60;
  });
  var need=wi.target-sum;
  if(t===last)return null;
  var inM=toMin(opt.lastIn)!==null?toMin(opt.lastIn):9*60;
  if(need<=0)return {last:last,need:0,leave:null,sum:sum,target:wi.target};
  return {last:last,need:need,leave:inM+need+c.lunchMin+expSmoke,sum:sum,target:wi.target,inM:inM,expSmoke:expSmoke};
}

/* ---- tapping ---- */
function clockIn(){var t=today();saveDay(t,{in:fromMin(nowMin())});toast(tl("上班打卡"),fromMin(nowMin()))}
function clockOut(){var t=today();saveDay(t,{out:fromMin(nowMin())});var h=hours(day(t));toast(tl("下班打卡"),h?tl("今天工作 {0}",hm(worked(h,cfg().mode))):fromMin(nowMin()))}

/* ---- home card ---- */
function plan(){try{return JSON.parse(localStorage.getItem(PLAN_KEY)||"{}")}catch(e){return {}}}
function setPlan(o){var p=plan();Object.keys(o).forEach(function(k){p[k]=o[k]});try{localStorage.setItem(PLAN_KEY,JSON.stringify(p))}catch(e){}}
var liveLeave=null;                                                   /* minutes: today's leave time for the ticking countdown */
function drawHome(el){
  var c=cfg(),t=today(),d=day(t),h=hours(d),wi=weekInfo(t),b="",sub="";
  liveLeave=null;
  if(!d.in){
    b='<div class="tcmain"><div class="tcbig">'+esc(tl("还没上班打卡"))+'</div></div><div class="row" style="margin-top:12px"><button class="btn grow" id="tcIn">'+esc(tl("上班打卡"))+'</button></div>';
  }else if(!d.out){
    var lt=leaveToday(t);liveLeave=lt.early?lt.leave:lt.normal;
    sub=tl("上班 {0}",d.in);
    b='<div class="tcmain"><div class="tcbig" id="tcLive">—</div><div class="tclabel" id="tcLabel"></div></div>'+
      '<div class="msg" style="margin:6px 0 0">'+esc(tl("预计下班 {0}",fromMin(liveLeave)))+(d.smoke>0&&c.mode==="pure"?esc(tl(" · 抽烟 {0} 根，下班延后 {1} 分钟",d.smoke,d.smoke*c.smokeMin)):"")+'</div>'+
      (lt.early?'<div class="hint good" style="margin-top:8px">'+tl("本周快达标了，今天 <b>{0}</b> 就能下班（正常是 {1}）",fromMin(lt.leave),fromMin(lt.normal))+'</div>':"")+
      '<div class="row" style="margin-top:12px"><button class="btn grow" id="tcOut">'+esc(tl("下班打卡"))+'</button></div>';
  }else{
    var w=worked(h,c.mode);
    sub=tl("{0} – {1}",d.in,d.out);
    b='<div class="tcmain"><div class="tcbig">'+hm(w)+'</div><div class="tclabel">'+esc(tl("今天工作"))+' · <span class="'+(w>=c.hoursPerDay*60?"tcok":"tcshort")+'">'+esc(tl(w>=c.hoursPerDay*60?"超时 {0}":"还差 {0}",hm(Math.abs(w-c.hoursPerDay*60))))+'</span></div></div>';
  }
  var pct=wi.target>0?Math.min(100,wi.done/wi.target*100):0;
  b+='<div class="msg" style="margin:12px 0 0;display:flex;justify-content:space-between"><span>'+esc(tl("本周"))+'</span><span>'+hm(wi.done)+' / '+hm(wi.target)+'</span></div><div class="bar"><i class="'+(wi.done>=wi.target?"":"")+'" style="'+(wi.done>=wi.target?"background:var(--good);":"")+'width:'+pct+'%"></i></div>';
  el.innerHTML='<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px"><h2 style="margin:0;font-size:13px;font-weight:600;color:var(--muted)">'+esc(tl("打卡"))+'</h2><button class="lkbtn" id="tcMore" style="margin:0">'+esc(sub||tl("详情"))+' ›</button></div>'+b;
  tick();
}
function tick(){
  var el=$("tcLive");if(!el||liveLeave===null)return;
  var left=liveLeave*60-nowSec();
  if(left>=0){el.textContent=hms(left);el.className="tcbig";$("tcLabel").textContent=tl("距离下班")}
  else{el.textContent="+"+hms(-left);el.className="tcbig tcover";$("tcLabel").textContent=tl("已经过了下班时间")}
}

/* ---- the day's timeline: clock in / out and every counter tap, in time order ---- */
function timeline(date){
  var d=day(date),items=[],ix=PL.counters?PL.counters.index():{};
  if(d.in)items.push({key:"in",rank:0,time:d.in,icon:"🟢",label:"上班",kind:"in"});
  if(PL.counters)PL.counters.defs().forEach(function(df){
    (((ix[df.id]||{})[date])||[]).forEach(function(r){items.push({key:"tap:"+r.id,rank:1,time:r.time||"",icon:df.icon,label:df.name,kind:"tap",row:r,def:df})});
  });
  if(d.out)items.push({key:"out",rank:2,time:d.out,icon:"🔴",label:"下班",kind:"out"});
  items.sort(function(a,b){return a.time<b.time?-1:a.time>b.time?1:a.rank-b.rank});
  return items;
}
/* totals typed in by hand for a day that have no time of their own: "N more without a time" */
function untimed(d){
  var o=[];
  [["smoke","smokeSet","smokeTaps"],["coffee","coffeeSet","coffeeTaps"],["water","waterSet","waterTaps"]].forEach(function(k){
    if(!isSet(d[k[1]]))return;
    var n=Math.round((+d[k[1]]-d[k[2]])*1000)/1000;
    if(n>0){var df=PL.counters&&PL.counters.def(k[0]);o.push({id:k[0],n:n,def:df})}
  });
  return o;
}
function timelineHtml(date){
  var d=day(date),items=timeline(date),h="",t=today();
  h+='<h3 style="margin:16px 0 2px;font-size:13px;color:var(--muted);font-weight:600">'+esc(date===t?tl("今天的时间线"):tl("{0} 的时间线",date.slice(5).replace("-","/")))+'</h3>';
  h+=items.length?items.map(function(it){
    var q=it.kind==="tap"?PL.counters.qty(it.def,it.row.val):"";
    var row='<div class="tlrow" data-tlkey="'+esc(it.key)+'" role="button" tabindex="0"><b>'+esc(it.time||"—")+'</b><span class="tll"><span aria-hidden="true">'+esc(it.icon)+'</span> <span>'+esc(it.label)+'</span></span><span class="tlq">'+esc(q)+'</span></div>';
    if(editKey===it.key){
      row+='<div class="tled"><div class="grid"><div><label>'+esc(tl("时间"))+'</label><input type="time" id="tlTime" value="'+esc(it.time)+'"></div>'+(it.kind==="tap"?'<div><label>'+esc(tl("数量"))+'</label><input type="number" inputmode="decimal" step="any" min="0" id="tlAmt" value="'+it.row.val+'"></div>':"")+'</div>'+
        '<div class="row" style="margin-top:8px"><button class="btn small" id="tlSave">'+esc(tl("保存"))+'</button><button class="btn ghost small" id="tlDel">'+esc(it.kind==="tap"?tl("删除"):tl("清除"))+'</button><button class="btn ghost small" id="tlCancel">'+esc(tl("取消"))+'</button></div><div class="msg" id="tlMsg"></div></div>';
    }
    return row;
  }).join(""):'<div class="empty" style="padding:8px 0">'+esc(tl("这一天还没有记录。"))+'</div>';
  untimed(d).forEach(function(u){h+='<p class="msg" style="margin:4px 0 0">'+esc(tl("另有 {0} {1} 没有记录时间（{2}）",PL.counters.qty({unit:""},u.n),u.def&&u.def.unit?u.def.unit:"",u.def?u.def.name:u.id))+'</p>'});
  /* add one that was forgotten */
  if(PL.counters){
    h+='<details class="more" style="margin-top:8px"><summary>'+esc(tl("补记一笔"))+'</summary><div class="grid" style="margin-top:8px"><div class="full"><select id="tlAddC" aria-label="'+esc(tl("计数器"))+'">'+PL.counters.defs().map(function(df){return '<option value="'+esc(df.id)+'">'+esc(tl("{0} {1}",df.icon,df.name))+'</option>'}).join("")+'</select></div><div><label>'+esc(tl("时间"))+'</label><input type="time" id="tlAddT" value="'+fromMin(nowMin())+'"></div><div><label>'+esc(tl("数量"))+'</label><input type="number" inputmode="decimal" step="any" min="0" id="tlAddA"></div></div><button class="btn small" id="tlAdd" style="margin-top:10px">'+esc(tl("补记"))+'</button><div class="msg" id="tlAddMsg"></div></details>';
  }
  return h;
}

/* ---- detail window ---- */
function drawDetail(){
  var body=$("tcDetailBody");if(!body)return;
  var c=cfg(),t=today(),ref=addDays(t,wkOff*7),wi=weekInfo(ref),sel=selDate||t,sd=day(sel),sh=hours(sd),h="";
  /* week navigation + list */
  var m=mondayOf(ref);
  h+='<div class="row" style="justify-content:space-between;margin-bottom:6px"><h3 style="margin:0;font-size:13px;color:var(--muted);font-weight:600">'+esc(wkOff===0?tl("本周"):tl("{0} 那一周",m.slice(5).replace("-","/")))+'</h3><div class="wnav"><button class="x" data-tcprev aria-label="'+esc(tl("上一周"))+'">‹</button><button class="x" data-tcnext aria-label="'+esc(tl("下一周"))+'">›</button></div></div>';
  h+=wi.rows.map(function(r){
    var lab=tl("周{0}",["一","二","三","四","五","六","日"][dow(r.date)]);
    return '<button class="tcrow'+(r.date===sel?" sel":"")+(r.future?" fut":"")+'" data-tcday="'+r.date+'"><span class="tcd">'+esc(lab)+' <small>'+r.date.slice(5).replace("-","/")+'</small></span><span class="tct">'+(r.d.in?esc(r.d.in):"—")+' – '+(r.d.out?esc(r.d.out):"—")+'</span><span class="tcw">'+(r.h?hm(r.w):"")+'</span><span class="tco '+(r.over===null?"":r.over>=0?"tcok":"tcshort")+'">'+(r.over===null?"":(r.over>=0?"+":"")+hm(r.over))+'</span></button>';
  }).join("");
  var pct=wi.target>0?Math.min(100,wi.done/wi.target*100):0;
  h+='<div class="msg" style="margin:8px 0 0;display:flex;justify-content:space-between"><span>'+esc(tl("本周合计"))+'</span><b>'+hm(wi.done)+' / '+hm(wi.target)+'</b></div><div class="bar"><i style="'+(wi.done>=wi.target?"background:var(--good);":"")+'width:'+pct+'%"></i></div>';
  h+=timelineHtml(sel);
  /* the two ways of counting */
  var pureW=0,totW=0,pureT=0,totT=0;
  wi.rows.forEach(function(r){if(r.h){pureW+=r.h.pure;totW+=r.h.total}});
  var th=hours(day(t));if(th){pureT=th.pure;totT=th.total}
  h+='<h3 style="margin:16px 0 4px;font-size:13px;color:var(--muted);font-weight:600">'+esc(tl("工时明细"))+'</h3><div class="stat" style="grid-template-columns:repeat(2,1fr)"><div><small>'+esc(tl("纯工作（扣抽烟）"))+'</small><strong>'+esc(tl("今天 {0}",hm(pureT)))+'</strong><small>'+esc(tl("本周 {0}",hm(pureW)))+'</small></div><div><small>'+esc(tl("总工时（抽烟也算）"))+'</small><strong>'+esc(tl("今天 {0}",hm(totT)))+'</strong><small>'+esc(tl("本周 {0}",hm(totW)))+'</small></div></div>';
  /* planning (this week only, on a workday) */
  if(wkOff===0&&wi.days.indexOf(t)>=0){
    var pl=plan(),pm=pl.mode||c.mode,lt=leaveToday(t,pm),pw=planWeek(t,{lastIn:pl.lastIn||"09:00",todayLeave:pl.todayLeave?toMin(pl.todayLeave):undefined,mode:pm});
    h+='<h3 style="margin:16px 0 4px;font-size:13px;color:var(--muted);font-weight:600">'+esc(tl("本周下班规划"))+'</h3>'+
      '<div class="chips" style="margin-bottom:8px"><button class="chip" data-tcmode="pure" aria-pressed="'+(pm==="pure")+'">'+esc(tl("纯工作（扣抽烟）"))+'</button><button class="chip" data-tcmode="total" aria-pressed="'+(pm==="total")+'">'+esc(tl("总工时（抽烟也算）"))+'</button></div>';
    if(lt&&!hours(day(t))){
      h+='<p class="msg" style="margin:0 0 6px">'+tl(lt.early?"今天最早 <b>{0}</b> 可以下班（本周只差 {1}，正常是 {2}）":"今天 <b>{0}</b> 下班（正常，本周还差 {1}）",fromMin(lt.leave),hm(lt.remaining),fromMin(lt.normal))+'</p>';
    }
    if(pw){
      h+='<div class="grid"><div><label>'+esc(tl("最后一个工作日几点上班"))+'</label><input type="time" id="tcPlanIn" value="'+esc(pl.lastIn||"09:00")+'"></div><div><label>'+esc(tl("今天几点下班（假设）"))+'</label><input type="time" id="tcPlanOut" value="'+esc(pl.todayLeave||(lt?fromMin(lt.normal):""))+'"></div></div>';
      h+=pw.leave===null?'<div class="hint good">'+tl("照这样，本周的工时在最后一个工作日之前就够了，最后一天可以不上班或随时走。")+'</div>':'<div class="hint">'+tl("最后一个工作日（周{0}）要工作 <b>{1}</b>，{2} 上班的话 <b>{3}</b> 就能下班。",["一","二","三","四","五","六","日"][dow(pw.last)],hm(pw.need),fromMin(pw.inM),fromMin(pw.leave))+'</div>';
    }else if(!lt){h+='<div class="empty" style="padding:8px 0">'+esc(tl("上班打卡后，这里会算出本周几点可以下班。"))+'</div>'}
    else if(t===wi.days[wi.days.length-1]){h+='<p class="msg" style="margin:0">'+esc(tl("今天是本周最后一个工作日。"))+'</p>'}
  }
  /* edit one day */
  h+='<h3 style="margin:16px 0 4px;font-size:13px;color:var(--muted);font-weight:600">'+esc(tl("修改这一天"))+'</h3>'+
    '<div class="grid"><div class="full"><label>'+esc(tl("日期"))+'</label><input type="date" id="tcDate" value="'+sel+'"></div>'+
    '<div><label>'+esc(tl("上班"))+'</label><input type="time" id="tcEIn" value="'+esc(sd.in)+'"></div><div><label>'+esc(tl("下班"))+'</label><input type="time" id="tcEOut" value="'+esc(sd.out)+'"></div>'+
    '<div><label>'+esc(tl("午休（分）"))+'</label><input type="number" inputmode="numeric" min="0" id="tcELunch" placeholder="'+c.lunchMin+'" value="'+(sd.lunchSet!==undefined?esc(String(sd.lunchSet)):"")+'"></div>'+
    '<div><label>'+esc(tl("抽烟（根）"))+'</label><input type="number" inputmode="numeric" min="0" id="tcESmoke" placeholder="'+sd.smokeRaw+'" value="'+(sd.smokeSet!==undefined?esc(String(sd.smokeSet)):"")+'"></div>'+
    '<div><label>'+esc(tl("咖啡（杯）"))+'</label><input type="number" inputmode="decimal" step="any" min="0" id="tcECoffee" placeholder="'+sd.coffeeTaps+'" value="'+(isSet(sd.coffeeSet)?esc(String(sd.coffeeSet)):"")+'"></div><div><label>'+esc(tl("喝水（ml）"))+'</label><input type="number" inputmode="decimal" step="any" min="0" id="tcEWater" placeholder="'+sd.waterTaps+'" value="'+(isSet(sd.waterSet)?esc(String(sd.waterSet)):"")+'"></div>'+
    '<div class="full"><label>'+esc(tl("备注"))+'</label><input type="text" id="tcENote" maxlength="80" value="'+esc(sd.note)+'"></div></div>'+
    '<div class="row" style="margin-top:12px"><button class="btn grow" id="tcESave">'+esc(tl("保存"))+'</button><button class="btn ghost grow" id="tcEClear">'+esc(tl("清除这一天"))+'</button></div><div class="msg" id="tcEMsg"></div>'+
    '<p class="msg">'+esc(tl("抽烟、咖啡、喝水的次数默认来自首页的计数器；这里留空就用默认值，填了就以这里为准（多出来的会显示成「没有记录时间」）。午休留空就用默认值。"))+'</p>';
  body.innerHTML=h;
}
function openDetail(){
  PL.popup("tcDetail","打卡",'<div class="card" id="tcDetail"><div id="tcDetailBody"></div></div>');
  if(!$("tcDetailBody").getAttribute("data-wired")){$("tcDetailBody").setAttribute("data-wired","1");$("tcDetailBody").addEventListener("click",detailClick);$("tcDetailBody").addEventListener("change",detailChange);$("tcDetailBody").addEventListener("keydown",function(e){if((e.key==="Enter"||e.key===" ")&&e.target.getAttribute&&e.target.getAttribute("data-tlkey")){e.preventDefault();e.target.click()}})}
  PL.popTitle("tcDetail","打卡");
  wkOff=0;selDate=today();editKey=null;drawDetail();openPop("tcDetail");
}
function detailClick(e){
  var tr=e.target.closest&&e.target.closest("[data-tlkey]");
  if(tr){var k=tr.getAttribute("data-tlkey");editKey=editKey===k?null:k;drawDetail();return}
  var b=e.target.closest&&e.target.closest("button");if(!b)return;
  if(b.hasAttribute("data-tcprev")){wkOff--;drawDetail();return}
  if(b.hasAttribute("data-tcnext")){wkOff++;drawDetail();return}
  if(b.getAttribute("data-tcday")){selDate=b.getAttribute("data-tcday");editKey=null;drawDetail();var f=$("tcEIn");if(f&&f.scrollIntoView)f.scrollIntoView({block:"center",behavior:"smooth"});return}
  if(b.getAttribute("data-tcmode")){setPlan({mode:b.getAttribute("data-tcmode")});drawDetail();return}
  if(b.id==="tlCancel"){editKey=null;drawDetail();return}
  if(b.id==="tlSave"||b.id==="tlDel"){timelineSave(b.id==="tlDel");return}
  if(b.id==="tlAdd"){
    var cid=$("tlAddC").value,tm=$("tlAddT").value,df=PL.counters.def(cid),am=$("tlAddA").value.trim()===""?(df?df.step:1):parseFloat($("tlAddA").value);
    if(!tm){$("tlAddMsg").textContent=tl("请填时间");return}
    if(!(am>0)){$("tlAddMsg").textContent=tl("数量要大于 0");return}
    if(!PL.counters.log(cid,am,{date:selDate||today(),time:tm,quiet:true})){$("tlAddMsg").textContent=tl("日期或时间不对");return}
    toast(tl("已补记 {0}",df.name),(selDate||today())+" "+tm);drawDetail();return;
  }
  if(b.id==="tcESave"){
    var date=$("tcDate").value,i=$("tcEIn").value,o=$("tcEOut").value,msg=$("tcEMsg");
    if(!date){msg.textContent=tl("请选日期");return}
    if(!i&&o){msg.textContent=tl("要先有上班时间，才能记下班时间");return}
    var lunch=$("tcELunch").value.trim(),smoke=$("tcESmoke").value.trim(),coffee=$("tcECoffee").value.trim(),water=$("tcEWater").value.trim();
    if([lunch,smoke,coffee,water].some(function(v){return v!==""&&!(+v>=0)})){msg.textContent=tl("午休、抽烟、咖啡、喝水请填 0 或更大的数字");return}
    saveDay(date,{in:i,out:o,note:$("tcENote").value.trim(),lunch:lunch===""?undefined:+lunch,smoke:smoke===""?undefined:+smoke,coffee:coffee===""?undefined:+coffee,water:water===""?undefined:+water});
    selDate=date;
    toast(tl("已保存"),date+(i?" "+i:"")+(o?" – "+o:""));drawDetail();return;
  }
  if(b.id==="tcEClear"){
    var dt=$("tcDate").value;
    if(b.getAttribute("data-sure")!=="1"){b.setAttribute("data-sure","1");b.textContent=tl("再按确认");setTimeout(function(){if(b.isConnected){b.removeAttribute("data-sure");b.textContent=tl("清除这一天")}},3000);return}
    saveDay(dt,{in:"",out:"",note:"",lunch:undefined,smoke:undefined});toast(tl("已清除"),dt);drawDetail();
  }
}
function timelineSave(del){
  var key=editKey,date=selDate||today(),msg=$("tlMsg");if(!key)return;
  if(key==="in"||key==="out"){
    var v=$("tlTime").value;
    if(!del&&!v){msg.textContent=tl("请填时间");return}
    if(key==="out"&&del===false&&!day(date).in){msg.textContent=tl("要先有上班时间，才能记下班时间");return}
    saveDay(date,key==="in"?{in:del?"":v}:{out:del?"":v});
  }else{
    var id=+key.slice(4),r=PL.rec.get(id);
    if(!r){editKey=null;drawDetail();return}
    if(del)PL.rec.del(id);
    else{
      var tm=$("tlTime").value,am=parseFloat($("tlAmt").value);
      if(!tm){msg.textContent=tl("请填时间");return}
      if(!(am>0)){msg.textContent=tl("数量要大于 0");return}
      PL.rec.update(id,{time:tm,val:am});
    }
  }
  editKey=null;drawDetail();
}
function detailChange(e){
  var t=e.target;
  if(t.id==="tcDate"&&t.value){selDate=t.value;wkOff=0;editKey=null;drawDetail()}
  else if(t.id==="tcPlanIn"){setPlan({lastIn:t.value});drawDetail()}
  else if(t.id==="tcPlanOut"){setPlan({todayLeave:t.value});drawDetail()}
}

/* ---- settings ---- */
var SET_HTML='<div class="card" id="tcSet"><h2>打卡设置</h2><div class="grid">'+
  '<div><label for="tcsH">每天工时（小时）</label><input id="tcsH" type="number" inputmode="decimal" step="0.25" min="1" max="16"></div><div><label for="tcsL">午休（分钟）</label><input id="tcsL" type="number" inputmode="numeric" min="0" max="240"></div>'+
  '<div><label for="tcsD">每周工作几天</label><input id="tcsD" type="number" inputmode="numeric" min="1" max="7"></div><div><label for="tcsS">每根烟扣几分钟</label><input id="tcsS" type="number" inputmode="numeric" min="0" max="60"></div>'+
  '<div class="full"><label for="tcsM">工时怎么算</label><select id="tcsM"><option value="pure">抽烟的时间不算工作（扣掉）</option><option value="total">抽烟也算工作（不扣）</option></select></div>'+
  '<div class="full"><label class="chk"><input type="checkbox" id="tcsO">打卡时把抽烟次数算进去</label></div></div>'+
  '<h3 style="margin:16px 0 6px;font-size:13px;color:var(--muted);font-weight:600">喝水和咖啡</h3><div class="grid">'+
  '<div class="full"><label class="chk"><input type="checkbox" id="tcsDrink">首页显示喝水和咖啡</label></div>'+
  '<div><label for="tcsCup">一杯水多少 ml（点一下加多少）</label><input id="tcsCup" type="number" inputmode="decimal" min="1" step="any"></div><div><label for="tcsGoal">喝水每天目标 (ml)</label><input id="tcsGoal" type="number" inputmode="decimal" min="0" step="any"></div>'+
  '<div class="full"><label for="tcsCof">咖啡每天上限（杯，0 = 不设）</label><input id="tcsCof" type="number" inputmode="decimal" min="0" step="any"></div></div>'+
  '<div class="msg" id="tcsMsg"></div><p class="msg">下班时间 = 上班 + 每天工时 + 午休 + 抽烟次数 × 每根扣的分钟。每周目标 = 每天工时 × 每周工作天数。设置存在 Records 分页，所有设备同步。</p></div>';
var SET_IDS=["tcsH","tcsL","tcsD","tcsS","tcsM","tcsO","tcsDrink","tcsCup","tcsGoal","tcsCof"];
function fillSet(){
  if(!$("tcsH"))return;
  var c=cfg(),a=document.activeElement,free=function(id){return a!==$(id)&&!$(id).getAttribute("data-dirty")};   /* never overwrite a field that is being typed in */
  [["tcsH",c.hoursPerDay],["tcsL",c.lunchMin],["tcsD",c.workDays],["tcsS",c.smokeMin]].forEach(function(p){if(free(p[0]))$(p[0]).value=p[1]});
  $("tcsM").value=c.mode;$("tcsO").checked=!!c.smokeOn;
  var w=PL.counters&&PL.counters.def("water"),cf=PL.counters&&PL.counters.def("coffee");
  if(w&&cf){
    $("tcsDrink").checked=!(w.hide&&cf.hide);
    if(free("tcsCup"))$("tcsCup").value=w.step;if(free("tcsGoal"))$("tcsGoal").value=w.limit>0?w.limit:0;if(free("tcsCof"))$("tcsCof").value=cf.limit>0?cf.limit:0;
  }
}
function saveSet(){
  var h=parseFloat($("tcsH").value),l=parseInt($("tcsL").value,10),d=parseInt($("tcsD").value,10),s=parseInt($("tcsS").value,10),msg=$("tcsMsg");
  if(!(h>=1&&h<=16)){msg.textContent=tl("每天工时请填 1 到 16 小时");return}
  if(!(l>=0&&l<=240)){msg.textContent=tl("午休请填 0 到 240 分钟");return}
  if(!(d>=1&&d<=7)){msg.textContent=tl("每周工作天数请填 1 到 7");return}
  if(!(s>=0&&s<=60)){msg.textContent=tl("每根烟扣的分钟请填 0 到 60");return}
  var cup=parseFloat($("tcsCup").value),goal=parseFloat($("tcsGoal").value),cof=parseFloat($("tcsCof").value);
  if(!(cup>0)){msg.textContent=tl("一杯水请填大于 0 的毫升数");return}
  if(!(goal>=0)||!(cof>=0)){msg.textContent=tl("喝水目标和咖啡上限请填 0 或更大的数字");return}
  msg.textContent="";
  var mode=$("tcsM").value,smokeOn=$("tcsO").checked,hide=!$("tcsDrink").checked;     /* read everything first: saving redraws these fields */
  SET_IDS.forEach(function(id){$(id).removeAttribute("data-dirty")});
  saveCfg({hoursPerDay:h,lunchMin:l,workDays:d,smokeMin:s,mode:mode,smokeOn:smokeOn});
  if(PL.counters){
    var w=PL.counters.def("water"),cf=PL.counters.def("coffee");
    if(w.step!==cup||w.limit!==goal||w.hide!==hide||w.kind!==(goal>0?"goal":"none"))PL.counters.patch("water",{step:cup,limit:goal,kind:goal>0?"goal":"none",hide:hide});
    if(cf.limit!==cof||cf.hide!==hide||cf.kind!==(cof>0?"limit":"none"))PL.counters.patch("coffee",{limit:cof,kind:cof>0?"limit":"none",hide:hide});
  }
}

PL.module({
  id:"timecard",
  title:"打卡",
  home:{id:"tcHome",html:"",render:drawHome},
  settings:[{id:"tcSet",label:"打卡设置",sub:function(){var c=cfg();return tl("{0} 小时 / 天",c.hoursPerDay)},html:SET_HTML}],
  init:function(){
    fillSet();
    PL.on("data",function(){fillSet();if($("sheetP_tcDetail")&&sheetOpen("P_tcDetail"))drawDetail()});
    $("tcHome").addEventListener("click",function(e){
      var b=e.target.closest&&e.target.closest("button");if(!b)return;
      if(b.id==="tcIn")clockIn();else if(b.id==="tcOut")clockOut();else if(b.id==="tcMore")openDetail();
    });
    SET_IDS.forEach(function(id){$(id).addEventListener("change",saveSet);$(id).addEventListener("input",function(){this.setAttribute("data-dirty","1")})});
    setInterval(function(){if(!document.hidden)tick()},1000);
    document.addEventListener("visibilitychange",function(){if(!document.hidden)drawHome($("tcHome"))});
  },
  en:{
    exact:{"打卡":"Clock","详情":"Details","还没上班打卡":"Not clocked in yet","上班打卡":"Clock in","下班打卡":"Clock out","今天工作":"Worked today","本周":"This week","距离下班":"Until you can leave","已经过了下班时间":"Past leaving time","本周合计":"Week total","工时明细":"Hours breakdown","纯工作（扣抽烟）":"Work only (smoke breaks removed)","总工时（抽烟也算）":"Total (smoke breaks count)","本周下班规划":"This week's leaving plan","最后一个工作日几点上班":"Last workday: clock-in time","今天几点下班（假设）":"Today's clock-out (assumed)","修改这一天":"Edit a day","日期":"Date","上班":"In","下班":"Out","午休（分）":"Lunch (min)","抽烟（根）":"Smoking (cigarettes)","备注":"Note","保存":"Save","清除这一天":"Clear this day","再按确认":"Tap again to confirm","上一周":"Previous week","下一周":"Next week","请选日期":"Please choose a date","要先有上班时间，才能记下班时间":"Add a clock-in time before a clock-out time","午休和抽烟请填 0 或更大的数字":"Lunch and smoking must be 0 or more","已保存":"Saved","已清除":"Cleared","上班打卡后，这里会算出本周几点可以下班。":"After you clock in, this shows when you can leave this week.","今天是本周最后一个工作日。":"Today is the last workday of the week.","照这样，本周的工时在最后一个工作日之前就够了，最后一天可以不上班或随时走。":"At this pace the week's hours are done before the last workday, so you can skip it or leave any time.","抽烟的次数默认来自首页的「抽烟」计数器；午休和抽烟栏位留空就用默认值。":"The smoking count comes from the Smoking counter on the home page by default; leave lunch and smoking empty to use the defaults.","打卡设置":"Timecard settings","每天工时（小时）":"Hours per day","午休（分钟）":"Lunch (minutes)","每周工作几天":"Workdays per week","每根烟扣几分钟":"Minutes deducted per cigarette","工时怎么算":"How hours are counted","抽烟的时间不算工作（扣掉）":"Smoke breaks are not work (deducted)","抽烟也算工作（不扣）":"Smoke breaks count as work (not deducted)","打卡时把抽烟次数算进去":"Include smoking in the hours","下班时间 = 上班 + 每天工时 + 午休 + 抽烟次数 × 每根扣的分钟。每周目标 = 每天工时 × 每周工作天数。设置存在 Records 分页，所有设备同步。":"Leave time = clock-in + hours per day + lunch + smoking count × minutes per cigarette. Weekly target = hours per day × workdays per week. Settings live in the Records sheet and sync to all devices.","每天工时请填 1 到 16 小时":"Hours per day must be 1 to 16","午休请填 0 到 240 分钟":"Lunch must be 0 to 240 minutes","每周工作天数请填 1 到 7":"Workdays per week must be 1 to 7","每根烟扣的分钟请填 0 到 60":"Minutes per cigarette must be 0 to 60","今天的时间线":"Today's timeline","这一天还没有记录。":"Nothing recorded for this day.","时间":"Time","数量":"Amount","取消":"Cancel","删除":"Delete","清除":"Clear","补记一笔":"Add a missed one","补记":"Add","计数器":"Counter","请填时间":"Please enter a time","数量要大于 0":"The amount must be above 0","日期或时间不对":"The date or time isn't valid","咖啡（杯）":"Coffee (cups)","喝水（ml）":"Water (ml)","午休、抽烟、咖啡、喝水请填 0 或更大的数字":"Lunch, smoking, coffee and water must be 0 or more","抽烟、咖啡、喝水的次数默认来自首页的计数器；这里留空就用默认值，填了就以这里为准（多出来的会显示成「没有记录时间」）。午休留空就用默认值。":"Smoking, coffee and water counts come from the home-page counters by default. Leave a field empty to use that; fill it in to override it (the extra shows up as “no time recorded”). Leave lunch empty for the default.","喝水和咖啡":"Water and coffee","首页显示喝水和咖啡":"Show water and coffee on the home page","一杯水多少 ml（点一下加多少）":"Water per tap (ml)","喝水每天目标 (ml)":"Daily water target (ml)","咖啡每天上限（杯，0 = 不设）":"Daily coffee limit (cups, 0 = none)","一杯水请填大于 0 的毫升数":"Water per tap must be above 0 ml","喝水目标和咖啡上限请填 0 或更大的数字":"Water target and coffee limit must be 0 or more","已补记 {0}":"Added a missed {0}"},
    tpl:{"上班 {0}":"In {0}","{0} – {1}":"{0} – {1}","预计下班 {0}":"Leave at {0}"," · 抽烟 {0} 根，下班延后 {1} 分钟":" · {0} {0|cigarette|cigarettes}, leaving {1} min later","本周快达标了，今天 <b>{0}</b> 就能下班（正常是 {1}）":"The week is almost done — you can leave at <b>{0}</b> today (normally {1})","超时 {0}":"Overtime {0}","还差 {0}":"{0} short","今天工作 {0}":"Worked {0} today","{0} 那一周":"Week of {0}","周{0}":"{0}","今天 {0}":"Today {0}","本周 {0}":"Week {0}","今天最早 <b>{0}</b> 可以下班（本周只差 {1}，正常是 {2}）":"You can leave as early as <b>{0}</b> today (only {1} left this week; normally {2})","今天 <b>{0}</b> 下班（正常，本周还差 {1}）":"Leave at <b>{0}</b> today (normal; {1} left this week)","最后一个工作日（周{0}）要工作 <b>{1}</b>，{2} 上班的话 <b>{3}</b> 就能下班。":"Last workday ({0}) needs <b>{1}</b> of work: clock in at {2} and you can leave at <b>{3}</b>.","{0} 小时 / 天":"{0} h / day","{0} 的时间线":"Timeline for {0}","另有 {0} {1} 没有记录时间（{2}）":"{0} {1} more with no time recorded ({2})"}
  }
});
PL.timecard={cfg:cfg,saveCfg:saveCfg,day:day,saveDay:saveDay,hours:hours,weekInfo:weekInfo,leaveToday:leaveToday,planWeek:planWeek,leaveAt:leaveAt,dayId:dayId,hm:hm,toMin:toMin,fromMin:fromMin,clockIn:clockIn,clockOut:clockOut};   /* for tests */
})();
