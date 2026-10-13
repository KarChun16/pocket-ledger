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
var selDate=null,wkOff=0,editKey=null,editOpen=false;

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
/* only smoke breaks taken while clocked in cost work time: from the clock-in to the clock-out (to now, while still working).
   before clocking in or after clocking out they do not count. A tap with no time at all is counted. */
function smokeInWork(date,inT,outT){
  var a=toMin(inT),b=toMin(outT),rows=[];
  if(a===null)return 0;
  try{var m=PL.counters&&PL.counters.index()["smoke"];rows=(m&&m[date])||[]}catch(e){}
  var n=0;
  rows.forEach(function(r){
    var t=toMin(r.time),ok=t===null||(b===null?t>=a:(b>=a?(t>=a&&t<=b):(t>=a||t<=b)));
    if(ok)n+=r.val;
  });
  return Math.round(n);
}
function isSet(v){return v!==undefined&&v!==null&&v!==""}
function day(date){
  var r=PL.rec.get(dayId(date)),x=r?PL.rec.data(r):{};
  var c=cfg();
  var smokeIn=smokeInWork(date,r?r.time:"",x.out||""),smoke=isSet(x.smoke)?+x.smoke:smokeIn;
  return {date:date,row:r||null,in:r?r.time:"",out:x.out||"",note:r?r.text:"",lunchSet:x.lunch,lunch:isSet(x.lunch)?+x.lunch:c.lunchMin,smokeSet:x.smoke,smoke:c.smokeOn?smoke:0,smokeRaw:smokeIn,
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
  var sum=0,sm=0,n=0,rows=[];
  wi.rows.forEach(function(r){if(r.h){sm+=r.d.smoke;n++}});
  var avg=n?Math.round(sm/n):0,nS=opt.smoke!==undefined&&opt.smoke!==null?opt.smoke:avg;
  var expSmoke=c.mode==="pure"?nS*c.smokeMin:0;
  wi.rows.forEach(function(r){
    if(r.date===last&&t!==last)return;
    var m,kind;
    if(r.date<t||(r.date===t&&r.h)){m=r.w;kind="actual"}
    else if(r.date===t){
      var i=toMin(r.d.in),lv=opt.todayLeave!==undefined?opt.todayLeave:(i!==null?leaveAt(i,r.d,c):null);
      if(i!==null&&lv!==null){var span=(lv-i+1440)%1440,s2=c.mode==="pure"?r.d.smoke*c.smokeMin:0;m=Math.max(0,span-r.d.lunch-s2);kind="today"}else{m=c.hoursPerDay*60;kind="plan"}
    }else{m=c.hoursPerDay*60;kind="plan"}
    sum+=m;rows.push({date:r.date,min:m,kind:kind});
  });
  var need=wi.target-sum;
  if(t===last)return null;
  var inM=toMin(opt.lastIn)!==null?toMin(opt.lastIn):9*60;
  rows.push({date:last,min:Math.max(0,need),kind:"need"});
  if(need<=0)return {last:last,need:0,leave:null,sum:sum,target:wi.target,rows:rows,avgN:avg,smokeN:nS};
  return {last:last,need:need,leave:inM+need+c.lunchMin+expSmoke,sum:sum,target:wi.target,inM:inM,expSmoke:expSmoke,rows:rows,avgN:avg,smokeN:nS};
}

/* ---- tapping ---- */
function clockIn(){var t=today();saveDay(t,{in:fromMin(nowMin())});toast(tl("上班打卡"),fromMin(nowMin()))}
function clockOut(){var t=today();saveDay(t,{out:fromMin(nowMin())});var h=hours(day(t));toast(tl("下班打卡"),h?tl("今天工作 {0}",hm(worked(h,cfg().mode))):fromMin(nowMin()))}

/* ---- the hero: countdown ring, in / leave / smoking, the big clock button (home card and top of the 打卡 page) ---- */
function plan(){try{return JSON.parse(localStorage.getItem(PLAN_KEY)||"{}")}catch(e){return {}}}
function setPlan(o){var p=plan();Object.keys(o).forEach(function(k){p[k]=o[k]});try{localStorage.setItem(PLAN_KEY,JSON.stringify(p))}catch(e){}}
var liveLeave=null,liveIn=null,RING=590.6;                            /* minutes: today's leave time and clock-in for the ticking countdown */
function heroHtml(full){
  var c=cfg(),t=today(),d=day(t),h=hours(d),cap="",big="",sub="",prog=0,col="var(--accent)",out,btn,banner="",lt=null;
  liveLeave=null;liveIn=null;
  var wi=weekInfo(t),third=c.smokeOn?['抽烟',tl("{0} 次",d.smokeRaw)]:['本周还需',wi.target-wi.done>0?hm(wi.target-wi.done):"✓"];
  if(!d.in){
    cap=tl("现在");big='<span class="tcbig" id="tcNow">'+fromMin(nowMin())+'</span>';sub=tl("还没上班打卡");
    out=fromMin(nowMin()+c.hoursPerDay*60+c.lunchMin);
    btn='<button class="btn tcmain" id="tcIn">'+esc(tl("上班打卡"))+'</button>';
  }else if(!d.out){
    lt=leaveToday(t);liveLeave=lt.early?lt.leave:lt.normal;liveIn=toMin(d.in);out=fromMin(lt.normal);
    cap='<span id="tcLabel"></span>';big='<span class="tcbig" id="tcLive">—</span>';sub=esc(tl("预计下班 {0}",fromMin(liveLeave)));
    if(lt.early)banner='<div class="hint good">'+tl("本周快达标了，今天 <b>{0}</b> 就能下班（正常是 {1}）",fromMin(lt.leave),fromMin(lt.normal))+'</div>';
    if(full&&d.smoke>0&&c.mode==="pure")banner+='<p class="msg" style="margin:0">'+esc(tl("抽烟 {0} 根，下班延后 {1} 分钟",d.smoke,d.smoke*c.smokeMin))+'</p>';
    btn='<button class="btn tcmain orange" id="tcOut">'+esc(tl("下班打卡"))+'</button>';
  }else{
    var w=worked(h,c.mode),over=w>=c.hoursPerDay*60;
    prog=Math.min(1,w/(c.hoursPerDay*60));col=over?"var(--good)":"var(--warn)";out=d.out;
    cap=esc(tl("今天工作"));big='<span class="tcbig">'+hm(w)+'</span>';
    sub='<span class="'+(over?"tcok":"tcshort")+'">'+esc(tl(over?"超时 {0}":"还差 {0}",hm(Math.abs(w-c.hoursPerDay*60))))+'</span>';
    btn='<button class="btn tcmain ghost" id="tcDone">'+esc(tl("修改今天记录"))+'</button>';
  }
  return '<button class="tcringw" id="tcMore" aria-label="'+esc(tl("打卡"))+'"><svg class="tcring" viewBox="0 0 220 220" aria-hidden="true"><circle class="trk" cx="110" cy="110" r="94"/><circle class="prg" id="tcRing" cx="110" cy="110" r="94" stroke-dasharray="'+RING+'" stroke-dashoffset="'+(RING*(1-prog))+'" style="stroke:'+col+'"/></svg>'+
    '<span class="tcrc"><span class="tccap">'+(cap.charAt(0)==="<"?cap:esc(cap))+'</span>'+big+'<span class="tcsub">'+sub+'</span></span></button>'+
    '<div class="tcstats"><div><small>'+esc(tl("上班"))+'</small><b>'+(d.in||"--:--")+'</b></div><div><small>'+esc(tl(d.out?"下班":"预计下班"))+'</small><b>'+out+'</b></div><div><small>'+esc(tl(third[0]))+'</small><b>'+third[1]+'</b></div></div>'+
    banner+'<div class="tcbot">'+btn+
    '<div class="tcacts">'+(c.smokeOn&&PL.counters?'<button class="btn ghost" id="tcSmoke">'+esc(tl("🚬 抽烟"))+'</button>':"")+'<button class="btn ghost" id="tcEditToday">'+esc(tl("✎ 编辑"))+'</button></div></div>';
}
function drawHome(el){
  var html='<div class="tchero">'+heroHtml()+'</div>';
  if(el._h!==html||!el.firstChild){var y=window.scrollY;el.innerHTML=html;el._h=html;if(window.scrollY!==y)window.scrollTo(0,y)}   /* never rebuild an unchanged card: the page would jump */
  tick();
}
function tick(){
  var all=function(id){return document.querySelectorAll("#"+id)};                 /* the hero is on the home page and on the 打卡 page */
  all("tcNow").forEach(function(n){n.textContent=fromMin(nowMin())});
  if(liveLeave===null)return;
  var left=liveLeave*60-nowSec(),tot=(liveLeave-liveIn+1440)%1440*60,el2=(nowSec()-liveIn*60+86400)%86400,p=tot>0?Math.min(1,el2/tot):1;
  all("tcLive").forEach(function(el){
    if(left>=0){el.textContent=hms(left);el.className="tcbig"}else{el.textContent="+"+hms(-left);el.className="tcbig tcover"}
  });
  all("tcLabel").forEach(function(l){l.textContent=tl(left>=0?"距离下班":"已经过了下班时间")});
  all("tcRing").forEach(function(rg){rg.style.strokeDashoffset=RING*(1-p);rg.style.stroke=left>=0?"var(--accent)":"var(--good)"});
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
  h+='<div class="card tchero">'+heroHtml(true)+'</div>'+drinksHtml();
  h+='<div class="card">'+timelineHtml(sel)+'</div>';
  /* the week: navigation, tiles, one row per day */
  h+='<div class="card">';
  var m=mondayOf(ref);
  h+='<div class="row" style="justify-content:space-between;margin-bottom:6px"><h3 style="margin:0;font-size:13px;color:var(--muted);font-weight:600">'+esc(wkOff===0?tl("本周"):tl("{0} 那一周",m.slice(5).replace("-","/")))+'</h3><div class="wnav"><button class="x" data-tcprev aria-label="'+esc(tl("上一周"))+'">‹</button><button class="x" data-tcnext aria-label="'+esc(tl("下一周"))+'">›</button></div></div>';
  var overSum=0,nd=0;wi.rows.forEach(function(r){if(r.over!==null){overSum+=r.over;nd++}});
  var left=wi.target-wi.done,ppw=wkOff===0&&wi.days.indexOf(t)>=0?planWeek(t,planOpts()):null,t4;
  if(ppw)t4='<button id="tcPlanTile"><small>'+esc(tl("{0}可走（预计）",tl("周{0}",["一","二","三","四","五","六","日"][dow(ppw.last)])))+'</small><strong>'+(ppw.leave===null?esc(tl("随时")):fromMin(ppw.leave))+'</strong><small>'+esc(tl("{0} 上班 · 点开规划",fromMin(ppw.inM||toMin(planOpts().lastIn))))+'</small></button>';
  else t4='<div><small>'+esc(tl("平均每天"))+'</small><strong>'+(nd?hm(wi.done/nd):"--")+'</strong><small>'+esc(tl("{0} 天",nd))+'</small></div>';
  h+='<div class="stat" style="grid-template-columns:repeat(2,1fr);margin-bottom:10px"><div><small>'+esc(tl("已工作"))+'</small><strong>'+hm(wi.done)+'</strong><small>'+esc(tl("{0} 天 · 目标 {1}",nd,hm(wi.target)))+'</small></div>'+
    '<div><small>'+esc(tl("本周还需"))+'</small><strong class="'+(left>0?"tcshort":"tcok")+'">'+(left>0?hm(left):esc(tl("已达标")))+'</strong><small>'+esc(left>0?tl("离目标还有这些"):tl("本周完成"))+'</small></div>'+
    '<div><small>'+esc(tl("超时合计"))+'</small><strong class="'+(overSum>=0?"tcok":"tcshort")+'">'+(overSum>=0?"+":"")+hm(overSum)+'</strong><small>'+esc(tl("每天对比 {0}",hm(c.hoursPerDay*60)))+'</small></div>'+t4+'</div>';
  h+=wi.rows.map(function(r){
    var lab=tl("周{0}",["一","二","三","四","五","六","日"][dow(r.date)]);
    return '<button class="tcrow'+(r.date===sel?" sel":"")+(r.future?" fut":"")+'" data-tcday="'+r.date+'"><span class="tcd">'+esc(lab)+' <small>'+r.date.slice(5).replace("-","/")+'</small></span><span class="tct">'+(r.d.in?esc(r.d.in):"—")+' – '+(r.d.out?esc(r.d.out):"—")+'</span><span class="tcw">'+(r.h?hm(r.w):"")+'</span><span class="tco '+(r.over===null?"":r.over>=0?"tcok":"tcshort")+'">'+(r.over===null?"":(r.over>=0?"+":"")+hm(r.over))+'</span></button>';
  }).join("");
  var pct=wi.target>0?Math.min(100,wi.done/wi.target*100):0;
  h+='<div class="msg" style="margin:8px 0 0;display:flex;justify-content:space-between"><span>'+esc(tl("本周合计"))+'</span><b>'+hm(wi.done)+' / '+hm(wi.target)+'</b></div><div class="bar"><i style="'+(wi.done>=wi.target?"background:var(--good);":"")+'width:'+pct+'%"></i></div>';
  /* the two ways of counting */
  h+='<div class="tcbtns"><button class="btn ghost" id="tcBrkBtn">'+esc(tl("⏱ 工时明细"))+' ›</button>'+(wkOff===0&&wi.days.indexOf(t)>=0?'<button class="btn ghost" id="tcPlanBtn">'+esc(tl("📅 本周下班规划"))+' ›</button>':"")+'</div>';
  h+='</div>';
  /* edit one day */
  h+='<div class="card"><details class="more" id="tcEditD"'+(editOpen?" open":"")+' style="margin:0"><summary style="margin:0">'+esc(tl("修改这一天"))+' · '+sel.slice(5).replace("-","/")+'</summary><div class="grid" style="margin-top:10px"><div class="full"><label>'+esc(tl("日期"))+'</label><input type="date" id="tcDate" value="'+sel+'"></div>'+
    '<div><label>'+esc(tl("上班"))+'</label><input type="time" id="tcEIn" value="'+esc(sd.in)+'"></div><div><label>'+esc(tl("下班"))+'</label><input type="time" id="tcEOut" value="'+esc(sd.out)+'"></div>'+
    '<div><label>'+esc(tl("午休（分）"))+'</label><input type="number" inputmode="numeric" min="0" id="tcELunch" placeholder="'+c.lunchMin+'" value="'+(sd.lunchSet!==undefined?esc(String(sd.lunchSet)):"")+'"></div>'+
    '<div><label>'+esc(tl("抽烟（根）"))+'</label><input type="number" inputmode="numeric" min="0" id="tcESmoke" placeholder="'+sd.smokeRaw+'" value="'+(sd.smokeSet!==undefined?esc(String(sd.smokeSet)):"")+'"></div>'+
    '<div><label>'+esc(tl("咖啡（杯）"))+'</label><input type="number" inputmode="decimal" step="any" min="0" id="tcECoffee" placeholder="'+sd.coffeeTaps+'" value="'+(isSet(sd.coffeeSet)?esc(String(sd.coffeeSet)):"")+'"></div><div><label>'+esc(tl("喝水（ml）"))+'</label><input type="number" inputmode="decimal" step="any" min="0" id="tcEWater" placeholder="'+sd.waterTaps+'" value="'+(isSet(sd.waterSet)?esc(String(sd.waterSet)):"")+'"></div>'+
    '<div class="full"><label>'+esc(tl("备注"))+'</label><input type="text" id="tcENote" maxlength="80" value="'+esc(sd.note)+'"></div></div>'+
    '<div class="row" style="margin-top:12px"><button class="btn grow" id="tcESave">'+esc(tl("保存"))+'</button><button class="btn ghost grow" id="tcEClear">'+esc(tl("清除这一天"))+'</button></div><div class="msg" id="tcEMsg"></div>'+
    '<p class="msg">'+esc(tl("抽烟、咖啡、喝水的次数默认来自首页的计数器（抽烟只算上班打卡之后、下班打卡之前的）；这里留空就用默认值，填了就以这里为准（多出来的会显示成「没有记录时间」）。午休留空就用默认值。"))+'</p></details></div>';
  if(body._h!==h){var y=window.scrollY;body.innerHTML=h;body._h=h;if(window.scrollY!==y)window.scrollTo(0,y)}
}
/* the 打卡 page (under 时间): the detail is a page now, not a window */
function showPage(){
  if(!$("tcDetailBody").getAttribute("data-wired")){$("tcDetailBody").setAttribute("data-wired","1");$("tcDetailBody").addEventListener("click",detailClick);$("tcDetailBody").addEventListener("change",detailChange);$("tcDetailBody").addEventListener("keydown",function(e){if((e.key==="Enter"||e.key===" ")&&e.target.getAttribute&&e.target.getAttribute("data-tlkey")){e.preventDefault();e.target.click()}})}
  wkOff=0;selDate=today();editKey=null;editOpen=false;drawDetail();
}
/* the buttons of the hero, on the home card (home=true) and on the page */
function heroClick(b,home){
  var id=b.id;
  if(id==="tcIn")clockIn();else if(id==="tcOut")clockOut();
  else if(id==="tcSmoke"){PL.counters.log("smoke")}
  else if(id==="tcMore"||id==="tcDone"||id==="tcEditToday"){
    if(id==="tcMore"&&!home)return;
    if(home){tab("timecard");if(id!=="tcMore"){editOpen=true;selDate=today();drawDetail()}}
    else if(id!=="tcMore"){selDate=today();wkOff=0;editOpen=true;editKey=null;drawDetail();var f=$("tcEIn");if(f&&f.scrollIntoView)f.scrollIntoView({block:"center",behavior:"smooth"})}
  }
  else if(b.hasAttribute("data-tcdrink")){var df=PL.counters.def(b.getAttribute("data-tcdrink"));if(df)PL.counters.log(df.id)}
  else return;
  drawHome($("tcHome"));if(pageOpen()&&!home)drawDetail();
}
function drinksHtml(){
  if(!PL.counters)return "";
  var ds=["coffee","water"].map(function(id){return PL.counters.def(id)}).filter(function(d){return d&&!d.hide});
  if(!ds.length)return "";
  var t=today(),ix=PL.counters.index();
  return '<div class="card tcdrinks">'+ds.map(function(d){
    var n=0;(((ix[d.id]||{})[t])||[]).forEach(function(r){n+=r.val});
    var pct=d.limit>0?Math.min(100,n/d.limit*100):0,over=d.kind==="limit"&&d.limit>0&&n>d.limit;
    return '<button class="tcdrink" data-tcdrink="'+esc(d.id)+'"><span class="tcdh"><span class="tcdi" aria-hidden="true">'+esc(d.icon)+'</span><span>'+esc(d.name)+'</span></span><span class="tcdp" aria-hidden="true">+</span><b class="'+(over?"tcshort":"")+'">'+esc(PL.counters.qty(d,Math.round(n*1000)/1000))+'</b><small>'+(d.limit>0?esc(tl(d.kind==="limit"?"上限 {0}":"目标 {0}",PL.counters.qty(d,d.limit))):"")+'</small>'+(d.limit>0?'<span class="tcbar"><i style="width:'+pct+'%'+(over?";background:var(--warn)":"")+'"></i></span>':"")+'</button>';
  }).join("")+'</div>';
}
/* ---- the hours breakdown window: work only (smoke breaks removed) against total (they count), today and this week ---- */
function brkRow(lbl,sub,val,big){return '<div class="tcprow"><span>'+esc(lbl)+(sub?' <small>'+esc(sub)+'</small>':"")+'</span><b class="'+(big?"tcok":"")+'">'+val+'</b></div>'}
function brkHtml(){
  var c=cfg(),t=today(),d=day(t),h="",wi=weekInfo(t,"pure"),wt=weekInfo(t,"total");
  var block=function(pure,total,n,sm){return brkRow(tl("纯工作时间"),tl("扣掉所有抽烟时间"),hm(pure),true)+brkRow(tl("总工时"),tl("抽烟也算工作"),hm(total),false)+brkRow(tl("抽烟扣掉"),"",tl("−{0}（{1} 次）",hm(total-pure),n))};
  var title=tl("今天");
  if(!d.in)h+='<h3 class="tcph">'+esc(title)+'</h3><p class="msg">'+esc(tl("今天还没上班打卡"))+'</p>';
  else{
    var x={in:d.in,out:d.out||fromMin(nowMin()),lunch:d.lunch,smoke:d.smoke},hh=hours(x);
    if(!d.out)title=tl("今天 · 如果现在下班");
    h+='<h3 class="tcph">'+esc(title)+'</h3>'+block(hh.pure,hh.total,d.smoke);
    if(!d.out){var pu=leaveAt(toMin(d.in),d,cfg("pure")),tt=leaveAt(toMin(d.in),d,cfg("total"));h+=brkRow(tl("下班时间"),"",tl("{0} · 不算抽烟 {1}",fromMin(pu),fromMin(tt)),false)}
  }
  var ws=mondayOf(t),pn=0,tn=0;wi.rows.forEach(function(r){if(r.h)pn+=r.d.smoke});
  var left=function(x){return x.target-x.done>0?hm(x.target-x.done):tl("✓ 已达标")};
  h+='<h3 class="tcph">'+esc(tl("本周"))+' · '+ws.slice(5).replace("-","/")+' – '+addDays(ws,6).slice(5).replace("-","/")+'</h3>'+block(wi.done,wt.done,pn)+brkRow(tl("还需工作"),"",tl("{0} · 不算抽烟 {1}",left(wi),left(wt)),false);
  h+='<p class="msg">'+esc(tl("每次抽烟算 {0} 分钟。「纯工作时间」就是 App 平常用的数字；「总工时」只是给你参考，不会改动记录。本周只算已经打了下班卡的日子。",c.smokeMin))+'</p>';
  return h;
}
function openBrk(){
  PL.popup("tcBrk","工时明细",'<div class="card" id="tcBrk"><div id="tcBrkBody"></div></div>');
  PL.popTitle("tcBrk","工时明细","⏱");
  $("tcBrkBody").innerHTML=brkHtml();openPop("tcBrk");
}

/* ---- the plan window: when can you leave on the last workday ---- */
function planOpts(){var c=cfg(),pl=plan();return {mode:pl.mode||c.mode,lastIn:pl.lastIn||"09:00",todayLeave:pl.todayLeave?toMin(pl.todayLeave):undefined,smoke:pl.smoke}}
function planDyn(){
  var t=today(),o=planOpts(),pw=planWeek(t,o),lt=leaveToday(t,o.mode),wi=weekInfo(t,o.mode),last=wi.days[wi.days.length-1],h="";
  var dn=function(d){return tl("周{0}",["一","二","三","四","五","六","日"][dow(d)])+" "+d.slice(5).replace("-","/")};
  if(wi.days.indexOf(t)<0)return '<p class="msg">'+esc(tl("本周的工作日已经结束了"))+'</p>';
  if(pw){
    h+='<div class="tcphero"><div class="tcpday">'+esc(dn(pw.last))+'</div>'+(pw.leave===null?'<div class="tcpbig tcok">'+esc(tl("随时可以走"))+'</div>':'<div class="tcpbig">'+fromMin(pw.leave)+'</div>')+
      '<div class="tclabel">'+esc(pw.leave===null?tl("本周工时已经够了，最后一天随时可以走"):tl("可以下班 · 那天要工作 {0}",hm(pw.need)))+'</div>';
    var om=o.mode==="pure"?"total":"pure",q=planWeek(t,{mode:om,lastIn:o.lastIn,todayLeave:o.todayLeave,smoke:o.smoke});
    if(q)h+='<div class="tclabel" style="margin-top:6px">'+esc(tl("如果{0}：{1}",tl(om==="total"?"抽烟也算工作":"扣掉抽烟"),q.leave===null?tl("随时可走"):fromMin(q.leave)))+'</div>';
    h+='</div>';
    h+=pw.leave===null?'<div class="hint good">'+tl("照这样，本周的工时在最后一个工作日之前就够了，最后一天可以不上班或随时走。")+'</div>':'<div class="hint">'+tl("最后一个工作日（周{0}）要工作 <b>{1}</b>，{2} 上班的话 <b>{3}</b> 就能下班。",["一","二","三","四","五","六","日"][dow(pw.last)],hm(pw.need),fromMin(pw.inM),fromMin(pw.leave))+'</div>';
    if(pw.need>12*60)h+='<p class="msg tcshort">'+esc(tl("最后一天要做 {0}，前几天可能要多做一点",hm(pw.need)))+'</p>';
    return h;
  }
  return h;
}
function planRows(){
  var t=today(),o=planOpts(),pw=planWeek(t,o),lt=leaveToday(t,o.mode),wi=weekInfo(t,o.mode),last=wi.days[wi.days.length-1],h="";
  var dn=function(d){return tl("周{0}",["一","二","三","四","五","六","日"][dow(d)])+" "+d.slice(5).replace("-","/")};
  if(wi.days.indexOf(t)<0)return "";
  if(pw){
    h+='<h3 class="tcph">'+esc(tl("每天工时"))+'</h3>'+pw.rows.map(function(r){
      var k={actual:"实际",today:"今天（预计）",plan:"预计（正常）",need:"需要"}[r.kind];
      return '<div class="tcprow"><span>'+esc(dn(r.date))+' <small>'+esc(tl(k))+'</small></span><b class="'+(r.kind==="need"?"tcok":"")+'">'+hm(r.min)+'</b></div>';
    }).join("");
    h+='<p class="msg">'+esc(tl("还没到的日子以正常 {0} 小时计算。最后一天的下班时间 = 上班 + 需要的工时 + 午休 + 抽烟。改上面的时间，结果会马上更新。",cfg().hoursPerDay))+'</p>';
  }else if(lt&&t===last){
    h+='<p class="msg">'+esc(tl("今天是本周最后一个工作日。"))+'</p>';
  }else if(!lt){h+='<div class="empty">'+esc(tl("上班打卡后，这里会算出本周几点可以下班。"))+'</div>'}
  if(lt&&!hours(day(t)))h+='<p class="msg" style="margin-top:8px">'+tl(lt.early?"今天最早 <b>{0}</b> 可以下班（本周只差 {1}，正常是 {2}）":"今天 <b>{0}</b> 下班（正常，本周还差 {1}）",fromMin(lt.leave),hm(lt.remaining),fromMin(lt.normal))+'</p>';
  return h;
}
function planHtml(){
  var c=cfg(),t=today(),o=planOpts(),pl=plan(),d=day(t),pw=planWeek(t,o),lt=leaveToday(t,o.mode),h="";
  h+='<div id="tcPlanDyn">'+planDyn()+'</div><h3 class="tcph">'+esc(tl("假设（可以改）"))+'</h3>';
  var rowsHtml='<div id="tcPlanRows">'+planRows()+'</div>';
  h+='<div class="chips" style="margin-bottom:8px"><button class="chip" data-tcmode="pure" aria-pressed="'+(o.mode==="pure")+'">'+esc(tl("纯工作（扣抽烟）"))+'</button><button class="chip" data-tcmode="total" aria-pressed="'+(o.mode==="total")+'">'+esc(tl("总工时（抽烟也算）"))+'</button></div>';
  h+='<div class="grid">';
  if(pw)h+='<div><label>'+esc(tl("最后一个工作日几点上班"))+'</label><input type="time" id="tcPlanIn" value="'+esc(pl.lastIn||"09:00")+'"></div>';
  if(d.in&&!d.out&&t!==weekInfo(t).days[weekInfo(t).days.length-1])h+='<div><label>'+esc(tl("今天几点下班（假设）"))+'</label><input type="time" id="tcPlanOut" value="'+esc(pl.todayLeave||(lt?fromMin(lt.normal):""))+'"></div>';
  if(pw&&c.smokeOn&&o.mode==="pure")h+='<div class="full"><label>'+esc(tl("每天抽烟（预计）"))+'</label><div class="row" style="align-items:center"><button class="btn ghost" data-tcsm="-1" aria-label="−" style="min-height:40px;padding:4px 16px">−</button><b id="tcPlanSm" style="min-width:64px;text-align:center">'+esc(tl("{0} 次",pw.smokeN))+'</b><button class="btn ghost" data-tcsm="1" aria-label="+" style="min-height:40px;padding:4px 16px">+</button></div></div>';
  h+='</div>'+rowsHtml;
  return h;
}
function drawPlan(){var b=$("tcPlanBody");if(b)b.innerHTML=planHtml()}
function paintPlan(){var b=$("tcPlanDyn");if(b)b.innerHTML=planDyn();var r=$("tcPlanRows");if(r)r.innerHTML=planRows();var pw=planWeek(today(),planOpts()),e=$("tcPlanSm");if(e&&pw)e.textContent=tl("{0} 次",pw.smokeN)}
function openPlan(){
  PL.popup("tcPlan","本周下班规划",'<div class="card" id="tcPlan"><div id="tcPlanBody"></div></div>');
  PL.popTitle("tcPlan","本周下班规划","📅");
  drawPlan();openPop("tcPlan");
}
function planEvent(e){
  var t=e.target,b=t.closest&&t.closest("button");
  if(e.type==="click"&&b){
    if(b.getAttribute("data-tcmode")){setPlan({mode:b.getAttribute("data-tcmode"),smoke:undefined});drawPlan();if(pageOpen())drawDetail();return}
    if(b.getAttribute("data-tcsm")){var pw=planWeek(today(),planOpts());if(pw){setPlan({smoke:Math.max(0,Math.min(30,pw.smokeN+ +b.getAttribute("data-tcsm")))});paintPlan()}return}
  }
  if(e.type==="change"){
    if(t.id==="tcPlanIn"){setPlan({lastIn:t.value||"09:00"});paintPlan();return}
    if(t.id==="tcPlanOut"){setPlan({todayLeave:t.value});paintPlan();return}
  }
}
function pageOpen(){var p=$("p-timecard");return p&&!p.hidden}
function detailClick(e){
  var sm=e.target.closest&&e.target.closest("#tcEditD>summary");
  if(sm){editOpen=!$("tcEditD").open;return}
  var tr=e.target.closest&&e.target.closest("[data-tlkey]");
  if(tr){var k=tr.getAttribute("data-tlkey");editKey=editKey===k?null:k;drawDetail();return}
  var b=e.target.closest&&e.target.closest("button");if(!b)return;
  if(b.id==="tcPlanBtn"||b.id==="tcPlanTile"){openPlan();return}
  if(b.id==="tcBrkBtn"){openBrk();return}
  if(b.hasAttribute("data-tcprev")){wkOff--;drawDetail();return}
  if(b.hasAttribute("data-tcnext")){wkOff++;drawDetail();return}
  if(b.getAttribute("data-tcday")){selDate=b.getAttribute("data-tcday");editKey=null;editOpen=true;drawDetail();var f=$("tcEIn");if(f&&f.scrollIntoView)f.scrollIntoView({block:"center",behavior:"smooth"});return}
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
  '<div class="msg" id="tcsMsg"></div><p class="msg">下班时间 = 上班 + 每天工时 + 午休 + 抽烟次数 × 每根扣的分钟；抽烟只算上班打卡之后、下班打卡之前的，上班前和下班后的不算。每周目标 = 每天工时 × 每周工作天数。设置存在 Records 分页，所有设备同步。</p></div>';
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
  page:{group:"time",label:"打卡",html:'<div id="tcDetail"><div id="tcDetailBody"></div></div>'},
  show:showPage,
  home:{id:"tcHome",html:"",render:drawHome},
  settings:[{id:"tcSet",label:"打卡设置",sub:function(){var c=cfg();return tl("{0} 小时 / 天",c.hoursPerDay)},html:SET_HTML}],
  init:function(){
    fillSet();
    PL.on("data",function(){fillSet();if(pageOpen()&&!(document.activeElement&&$("tcDetailBody").contains(document.activeElement)&&/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)))drawDetail()});
    $("tcHome").addEventListener("click",function(e){
      var b=e.target.closest&&e.target.closest("button");if(!b)return;
      heroClick(b,true);
    });
    $("tcDetailBody").addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("button");if(b)heroClick(b,false)});
    document.addEventListener("click",function(e){if(e.target.closest&&e.target.closest("#tcPlanBody"))planEvent(e)});
    document.addEventListener("change",function(e){if(e.target.closest&&e.target.closest("#tcPlanBody"))planEvent(e)});
    SET_IDS.forEach(function(id){$(id).addEventListener("change",saveSet);$(id).addEventListener("input",function(){this.setAttribute("data-dirty","1")})});
    setInterval(function(){if(!document.hidden)tick()},1000);
    document.addEventListener("visibilitychange",function(){if(!document.hidden)drawHome($("tcHome"))});
  },
  en:{
    exact:{"打卡":"Clock","⏱ 工时明细":"⏱ Hours breakdown","纯工作时间":"Work only","扣掉所有抽烟时间":"all smoke breaks removed","总工时":"Total time","抽烟也算工作":"Smoking counts as work","抽烟扣掉":"Smoke removed","今天":"Today","今天 · 如果现在下班":"Today · if you clock out now","今天还没上班打卡":"Not clocked in today","下班时间":"Clock-out time","还需工作":"Still needed","✓ 已达标":"✓ Done","📅 本周下班规划":"📅 Plan my week","本周的工作日已经结束了":"This week's workdays are over","随时可以走":"Leave any time","随时可走":"any time","随时":"Any time","本周工时已经够了，最后一天随时可以走":"This week's hours are already covered; you can leave any time on the last day","每天工时":"Hours per day","假设（可以改）":"Assumptions (you can change)","每天抽烟（预计）":"Cigarettes per day (expected)","抽烟也算工作":"Smoking counts as work","扣掉抽烟":"Smoke breaks removed","实际":"Actual","今天（预计）":"Today (planned)","预计（正常）":"Planned (normal day)","需要":"Needed","已工作":"Worked","已达标":"Done","离目标还有这些":"Still to reach the target","本周完成":"Week complete","超时合计":"Overtime total","平均每天":"Daily average","现在":"Now","抽烟":"Smoking","本周还需":"Left this week","🚬 抽烟":"🚬 Smoke","✎ 编辑今天":"✎ Edit today","✎ 编辑":"✎ Edit","修改今天记录":"Edit today","详情":"Details","还没上班打卡":"Not clocked in yet","上班打卡":"Clock in","下班打卡":"Clock out","今天工作":"Worked today","本周":"This week","距离下班":"Until you can leave","已经过了下班时间":"Past leaving time","本周合计":"Week total","工时明细":"Hours breakdown","纯工作（扣抽烟）":"Work only (smoke breaks removed)","总工时（抽烟也算）":"Total (smoke breaks count)","本周下班规划":"This week's leaving plan","最后一个工作日几点上班":"Last workday: clock-in time","今天几点下班（假设）":"Today's clock-out (assumed)","修改这一天":"Edit a day","日期":"Date","上班":"In","下班":"Out","午休（分）":"Lunch (min)","抽烟（根）":"Smoking (cigarettes)","备注":"Note","保存":"Save","清除这一天":"Clear this day","再按确认":"Tap again to confirm","上一周":"Previous week","下一周":"Next week","请选日期":"Please choose a date","要先有上班时间，才能记下班时间":"Add a clock-in time before a clock-out time","午休和抽烟请填 0 或更大的数字":"Lunch and smoking must be 0 or more","已保存":"Saved","已清除":"Cleared","上班打卡后，这里会算出本周几点可以下班。":"After you clock in, this shows when you can leave this week.","今天是本周最后一个工作日。":"Today is the last workday of the week.","预计下班":"Expected leave time","打开完整打卡页":"Open the full clock page","照这样，本周的工时在最后一个工作日之前就够了，最后一天可以不上班或随时走。":"At this pace the week's hours are done before the last workday, so you can skip it or leave any time.","抽烟的次数默认来自首页的「抽烟」计数器；午休和抽烟栏位留空就用默认值。":"The smoking count comes from the Smoking counter on the home page by default; leave lunch and smoking empty to use the defaults.","打卡设置":"Timecard settings","每天工时（小时）":"Hours per day","午休（分钟）":"Lunch (minutes)","每周工作几天":"Workdays per week","每根烟扣几分钟":"Minutes deducted per cigarette","工时怎么算":"How hours are counted","抽烟的时间不算工作（扣掉）":"Smoke breaks are not work (deducted)","抽烟也算工作（不扣）":"Smoke breaks count as work (not deducted)","打卡时把抽烟次数算进去":"Include smoking in the hours","下班时间 = 上班 + 每天工时 + 午休 + 抽烟次数 × 每根扣的分钟；抽烟只算上班打卡之后、下班打卡之前的，上班前和下班后的不算。每周目标 = 每天工时 × 每周工作天数。设置存在 Records 分页，所有设备同步。":"Leave time = clock-in + hours per day + lunch + smoking count × minutes per cigarette; only smoke breaks between clock-in and clock-out count — before clocking in or after clocking out they do not. Weekly target = hours per day × workdays per week. Settings live in the Records sheet and sync to all devices.","每天工时请填 1 到 16 小时":"Hours per day must be 1 to 16","午休请填 0 到 240 分钟":"Lunch must be 0 to 240 minutes","每周工作天数请填 1 到 7":"Workdays per week must be 1 to 7","每根烟扣的分钟请填 0 到 60":"Minutes per cigarette must be 0 to 60","今天的时间线":"Today's timeline","这一天还没有记录。":"Nothing recorded for this day.","时间":"Time","数量":"Amount","取消":"Cancel","删除":"Delete","清除":"Clear","补记一笔":"Add a missed one","补记":"Add","计数器":"Counter","请填时间":"Please enter a time","数量要大于 0":"The amount must be above 0","日期或时间不对":"The date or time isn't valid","咖啡（杯）":"Coffee (cups)","喝水（ml）":"Water (ml)","午休、抽烟、咖啡、喝水请填 0 或更大的数字":"Lunch, smoking, coffee and water must be 0 or more","抽烟、咖啡、喝水的次数默认来自首页的计数器（抽烟只算上班打卡之后、下班打卡之前的）；这里留空就用默认值，填了就以这里为准（多出来的会显示成「没有记录时间」）。午休留空就用默认值。":"Smoking, coffee and water counts come from the home-page counters by default (smoking only counts between clock-in and clock-out). Leave a field empty to use that; fill it in to override it (the extra shows up as “no time recorded”). Leave lunch empty for the default.","喝水和咖啡":"Water and coffee","首页显示喝水和咖啡":"Show water and coffee on the home page","一杯水多少 ml（点一下加多少）":"Water per tap (ml)","喝水每天目标 (ml)":"Daily water target (ml)","咖啡每天上限（杯，0 = 不设）":"Daily coffee limit (cups, 0 = none)","一杯水请填大于 0 的毫升数":"Water per tap must be above 0 ml","喝水目标和咖啡上限请填 0 或更大的数字":"Water target and coffee limit must be 0 or more","已补记 {0}":"Added a missed {0}"},
    tpl:{"−{0}（{1} 次）":"−{0} ({1} smoke breaks)","{0} · 不算抽烟 {1}":"{0} · without smoke {1}","每次抽烟算 {0} 分钟。「纯工作时间」就是 App 平常用的数字；「总工时」只是给你参考，不会改动记录。本周只算已经打了下班卡的日子。":"Each smoke break counts as {0} min. “Work only” is the number the app normally uses; “Total time” is for reference only — no records change. This week only counts days you have clocked out.","可以下班 · 那天要工作 {0}":"You can leave · that day needs {0}","如果{0}：{1}":"If {0}: {1}","最后一天要做 {0}，前几天可能要多做一点":"The last day needs {0}; you may have to do a bit more on the earlier days","还没到的日子以正常 {0} 小时计算。最后一天的下班时间 = 上班 + 需要的工时 + 午休 + 抽烟。改上面的时间，结果会马上更新。":"Days that have not come yet count as a normal {0}-hour day. Last-day leave time = clock-in + hours needed + lunch + smoking. Change the times above and the result updates at once.","{0}可走（预计）":"Leave {0} (planned)","{0} 上班 · 点开规划":"In at {0} · tap to plan","{0} 天 · 目标 {1}":"{0} d · target {1}","每天对比 {0}":"vs {0} a day","{0} 天":"{0} d","{0} 次":"{0}×","上限 {0}":"Limit {0}","目标 {0}":"Goal {0}","上班 {0}":"In {0}","{0} – {1}":"{0} – {1}","预计下班 {0}":"Leave at {0}"," · 抽烟 {0} 根，下班延后 {1} 分钟":" · {0} {0|cigarette|cigarettes}, leaving {1} min later","本周快达标了，今天 <b>{0}</b> 就能下班（正常是 {1}）":"The week is almost done — you can leave at <b>{0}</b> today (normally {1})","超时 {0}":"Overtime {0}","还差 {0}":"{0} short","今天工作 {0}":"Worked {0} today","{0} 那一周":"Week of {0}","周{0}":"{0}","今天 {0}":"Today {0}","本周 {0}":"Week {0}","今天最早 <b>{0}</b> 可以下班（本周只差 {1}，正常是 {2}）":"You can leave as early as <b>{0}</b> today (only {1} left this week; normally {2})","今天 <b>{0}</b> 下班（正常，本周还差 {1}）":"Leave at <b>{0}</b> today (normal; {1} left this week)","最后一个工作日（周{0}）要工作 <b>{1}</b>，{2} 上班的话 <b>{3}</b> 就能下班。":"Last workday ({0}) needs <b>{1}</b> of work: clock in at {2} and you can leave at <b>{3}</b>.","{0} 小时 / 天":"{0} h / day","提前（正常是 {0}）":"early (normally {0})","抽烟 {0} 根，下班延后 {1} 分钟":"{0} {0|cigarette|cigarettes}, leaving {1} min later","{0} 的时间线":"Timeline for {0}","另有 {0} {1} 没有记录时间（{2}）":"{0} {1} more with no time recorded ({2})"}
  }
});
PL.timecard={cfg:cfg,saveCfg:saveCfg,day:day,saveDay:saveDay,hours:hours,weekInfo:weekInfo,leaveToday:leaveToday,planWeek:planWeek,leaveAt:leaveAt,dayId:dayId,hm:hm,toMin:toMin,fromMin:fromMin,clockIn:clockIn,clockOut:clockOut};   /* for tests */
})();
