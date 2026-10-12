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
var selDate=null,wkOff=0;

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
function cfg(){
  var r=PL.rec.get(CFG_ID),x=r?PL.rec.data(r):{},o={};
  Object.keys(DEF).forEach(function(k){o[k]=x[k]!==undefined?x[k]:DEF[k]});
  return o;
}
function saveCfg(patch){
  var c=cfg();Object.keys(patch).forEach(function(k){c[k]=patch[k]});
  PL.rec.add({id:CFG_ID,mod:"clockcfg",date:"2000-01-01",extra:c});
}

/* ---- one day ---- */
function smokeCount(date){
  try{var m=PL.counters&&PL.counters.index()["smoke"];var t=0;((m&&m[date])||[]).forEach(function(r){t+=r.val});return Math.round(t)}catch(e){return 0}
}
function day(date){
  var r=PL.rec.get(dayId(date)),x=r?PL.rec.data(r):{};
  var c=cfg();
  var smoke=x.smoke!==undefined&&x.smoke!==null&&x.smoke!==""?+x.smoke:smokeCount(date);
  return {date:date,row:r||null,in:r?r.time:"",out:x.out||"",note:r?r.text:"",lunchSet:x.lunch,lunch:x.lunch!==undefined&&x.lunch!==null&&x.lunch!==""?+x.lunch:c.lunchMin,smokeSet:x.smoke,smoke:c.smokeOn?smoke:0,smokeRaw:smoke};
}
function saveDay(date,patch){
  var d=day(date),n={in:d.in,out:d.out,note:d.note,lunch:d.lunchSet,smoke:d.smokeSet};
  Object.keys(patch).forEach(function(k){n[k]=patch[k]});
  var empty=!n.in&&!n.out&&!n.note&&(n.lunch===undefined||n.lunch===""||n.lunch===null)&&(n.smoke===undefined||n.smoke===""||n.smoke===null);
  if(empty){if(d.row)PL.rec.del(d.row.id);return null}
  var x={out:n.out||""};
  if(n.lunch!==undefined&&n.lunch!==""&&n.lunch!==null)x.lunch=+n.lunch;
  if(n.smoke!==undefined&&n.smoke!==""&&n.smoke!==null)x.smoke=+n.smoke;
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
function weekInfo(date){
  var c=cfg(),days=weekDays(date,c),t=today(),done=0,before=0,rows=[];
  days.forEach(function(dt){
    var d=day(dt),h=hours(d),w=worked(h,c.mode);
    done+=w;if(dt<t)before+=w;
    rows.push({date:dt,d:d,h:h,w:w,over:h?w-c.hoursPerDay*60:null,future:dt>t,today:dt===t});
  });
  return {cfg:c,days:days,rows:rows,done:done,before:before,target:c.workDays*c.hoursPerDay*60};
}
/* can you leave early today? remaining = what the week still needs before today's work */
function leaveToday(date){
  var c=cfg(),wi=weekInfo(date),d=day(date),i=toMin(d.in);
  if(i===null)return null;
  var before=0;wi.rows.forEach(function(r){if(r.date<date)before+=r.w});                /* what was done on the days before this one */
  var remaining=Math.max(0,wi.target-before),need=Math.min(c.hoursPerDay*60,remaining);
  return {normal:leaveAt(i,d,c),need:need,remaining:remaining,leave:i+need+d.lunch+(c.mode==="pure"?d.smoke*c.smokeMin:0),early:remaining<c.hoursPerDay*60};
}
/* the last workday's leave time: past days as recorded, today as assumed, the days in between as normal days */
function planWeek(date,opt){
  var c=cfg(),wi=weekInfo(date),t=today(),last=wi.days[wi.days.length-1];
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
  /* the two ways of counting */
  var pureW=0,totW=0,pureT=0,totT=0;
  wi.rows.forEach(function(r){if(r.h){pureW+=r.h.pure;totW+=r.h.total}});
  var th=hours(day(t));if(th){pureT=th.pure;totT=th.total}
  h+='<h3 style="margin:16px 0 4px;font-size:13px;color:var(--muted);font-weight:600">'+esc(tl("工时明细"))+'</h3><div class="stat" style="grid-template-columns:repeat(2,1fr)"><div><small>'+esc(tl("纯工作（扣抽烟）"))+'</small><strong>'+esc(tl("今天 {0}",hm(pureT)))+'</strong><small>'+esc(tl("本周 {0}",hm(pureW)))+'</small></div><div><small>'+esc(tl("总工时（抽烟也算）"))+'</small><strong>'+esc(tl("今天 {0}",hm(totT)))+'</strong><small>'+esc(tl("本周 {0}",hm(totW)))+'</small></div></div>';
  /* planning (this week only, on a workday) */
  if(wkOff===0&&wi.days.indexOf(t)>=0){
    var pl=plan(),lt=leaveToday(t),pw=planWeek(t,{lastIn:pl.lastIn||"09:00",todayLeave:pl.todayLeave?toMin(pl.todayLeave):undefined});
    h+='<h3 style="margin:16px 0 4px;font-size:13px;color:var(--muted);font-weight:600">'+esc(tl("本周下班规划"))+'</h3>';
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
    '<div class="full"><label>'+esc(tl("备注"))+'</label><input type="text" id="tcENote" maxlength="80" value="'+esc(sd.note)+'"></div></div>'+
    '<div class="row" style="margin-top:12px"><button class="btn grow" id="tcESave">'+esc(tl("保存"))+'</button><button class="btn ghost grow" id="tcEClear">'+esc(tl("清除这一天"))+'</button></div><div class="msg" id="tcEMsg"></div>'+
    '<p class="msg">'+esc(tl("抽烟的次数默认来自首页的「抽烟」计数器；午休和抽烟栏位留空就用默认值。"))+'</p>';
  body.innerHTML=h;
}
function openDetail(){
  PL.popup("tcDetail","打卡",'<div class="card" id="tcDetail"><div id="tcDetailBody"></div></div>');
  if(!$("tcDetailBody").getAttribute("data-wired")){$("tcDetailBody").setAttribute("data-wired","1");$("tcDetailBody").addEventListener("click",detailClick);$("tcDetailBody").addEventListener("change",detailChange)}
  PL.popTitle("tcDetail","打卡");
  wkOff=0;selDate=today();drawDetail();openPop("tcDetail");
}
function detailClick(e){
  var b=e.target.closest&&e.target.closest("button");if(!b)return;
  if(b.hasAttribute("data-tcprev")){wkOff--;drawDetail();return}
  if(b.hasAttribute("data-tcnext")){wkOff++;drawDetail();return}
  if(b.getAttribute("data-tcday")){selDate=b.getAttribute("data-tcday");drawDetail();var f=$("tcEIn");if(f&&f.scrollIntoView)f.scrollIntoView({block:"center",behavior:"smooth"});return}
  if(b.id==="tcESave"){
    var date=$("tcDate").value,i=$("tcEIn").value,o=$("tcEOut").value,msg=$("tcEMsg");
    if(!date){msg.textContent=tl("请选日期");return}
    if(!i&&o){msg.textContent=tl("要先有上班时间，才能记下班时间");return}
    var lunch=$("tcELunch").value.trim(),smoke=$("tcESmoke").value.trim();
    if((lunch!==""&&!(+lunch>=0))||(smoke!==""&&!(+smoke>=0))){msg.textContent=tl("午休和抽烟请填 0 或更大的数字");return}
    saveDay(date,{in:i,out:o,note:$("tcENote").value.trim(),lunch:lunch===""?undefined:+lunch,smoke:smoke===""?undefined:+smoke});
    selDate=date;
    toast(tl("已保存"),date+(i?" "+i:"")+(o?" – "+o:""));drawDetail();return;
  }
  if(b.id==="tcEClear"){
    var dt=$("tcDate").value;
    if(b.getAttribute("data-sure")!=="1"){b.setAttribute("data-sure","1");b.textContent=tl("再按确认");setTimeout(function(){if(b.isConnected){b.removeAttribute("data-sure");b.textContent=tl("清除这一天")}},3000);return}
    saveDay(dt,{in:"",out:"",note:"",lunch:undefined,smoke:undefined});toast(tl("已清除"),dt);drawDetail();
  }
}
function detailChange(e){
  var t=e.target;
  if(t.id==="tcDate"&&t.value){selDate=t.value;wkOff=0;drawDetail()}
  else if(t.id==="tcPlanIn"){setPlan({lastIn:t.value});drawDetail()}
  else if(t.id==="tcPlanOut"){setPlan({todayLeave:t.value});drawDetail()}
}

/* ---- settings ---- */
var SET_HTML='<div class="card" id="tcSet"><h2>打卡设置</h2><div class="grid">'+
  '<div><label for="tcsH">每天工时（小时）</label><input id="tcsH" type="number" inputmode="decimal" step="0.25" min="1" max="16"></div><div><label for="tcsL">午休（分钟）</label><input id="tcsL" type="number" inputmode="numeric" min="0" max="240"></div>'+
  '<div><label for="tcsD">每周工作几天</label><input id="tcsD" type="number" inputmode="numeric" min="1" max="7"></div><div><label for="tcsS">每根烟扣几分钟</label><input id="tcsS" type="number" inputmode="numeric" min="0" max="60"></div>'+
  '<div class="full"><label for="tcsM">工时怎么算</label><select id="tcsM"><option value="pure">抽烟的时间不算工作（扣掉）</option><option value="total">抽烟也算工作（不扣）</option></select></div>'+
  '<div class="full"><label class="chk"><input type="checkbox" id="tcsO">打卡时把抽烟次数算进去</label></div></div>'+
  '<div class="msg" id="tcsMsg"></div><p class="msg">下班时间 = 上班 + 每天工时 + 午休 + 抽烟次数 × 每根扣的分钟。每周目标 = 每天工时 × 每周工作天数。设置存在 Records 分页，所有设备同步。</p></div>';
function fillSet(){
  if(!$("tcsH"))return;
  var c=cfg(),a=document.activeElement;
  [["tcsH",c.hoursPerDay],["tcsL",c.lunchMin],["tcsD",c.workDays],["tcsS",c.smokeMin]].forEach(function(p){if(a!==$(p[0]))$(p[0]).value=p[1]});
  $("tcsM").value=c.mode;$("tcsO").checked=!!c.smokeOn;
}
function saveSet(){
  var h=parseFloat($("tcsH").value),l=parseInt($("tcsL").value,10),d=parseInt($("tcsD").value,10),s=parseInt($("tcsS").value,10),msg=$("tcsMsg");
  if(!(h>=1&&h<=16)){msg.textContent=tl("每天工时请填 1 到 16 小时");return}
  if(!(l>=0&&l<=240)){msg.textContent=tl("午休请填 0 到 240 分钟");return}
  if(!(d>=1&&d<=7)){msg.textContent=tl("每周工作天数请填 1 到 7");return}
  if(!(s>=0&&s<=60)){msg.textContent=tl("每根烟扣的分钟请填 0 到 60");return}
  msg.textContent="";
  saveCfg({hoursPerDay:h,lunchMin:l,workDays:d,smokeMin:s,mode:$("tcsM").value,smokeOn:$("tcsO").checked});
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
    ["tcsH","tcsL","tcsD","tcsS","tcsM","tcsO"].forEach(function(id){$(id).addEventListener("change",saveSet)});
    setInterval(function(){if(!document.hidden)tick()},1000);
    document.addEventListener("visibilitychange",function(){if(!document.hidden)drawHome($("tcHome"))});
  },
  en:{
    exact:{"打卡":"Clock","详情":"Details","还没上班打卡":"Not clocked in yet","上班打卡":"Clock in","下班打卡":"Clock out","今天工作":"Worked today","本周":"This week","距离下班":"Until you can leave","已经过了下班时间":"Past leaving time","本周合计":"Week total","工时明细":"Hours breakdown","纯工作（扣抽烟）":"Work only (smoke breaks removed)","总工时（抽烟也算）":"Total (smoke breaks count)","本周下班规划":"This week's leaving plan","最后一个工作日几点上班":"Last workday: clock-in time","今天几点下班（假设）":"Today's clock-out (assumed)","修改这一天":"Edit a day","日期":"Date","上班":"In","下班":"Out","午休（分）":"Lunch (min)","抽烟（根）":"Smoking (cigarettes)","备注":"Note","保存":"Save","清除这一天":"Clear this day","再按确认":"Tap again to confirm","上一周":"Previous week","下一周":"Next week","请选日期":"Please choose a date","要先有上班时间，才能记下班时间":"Add a clock-in time before a clock-out time","午休和抽烟请填 0 或更大的数字":"Lunch and smoking must be 0 or more","已保存":"Saved","已清除":"Cleared","上班打卡后，这里会算出本周几点可以下班。":"After you clock in, this shows when you can leave this week.","今天是本周最后一个工作日。":"Today is the last workday of the week.","照这样，本周的工时在最后一个工作日之前就够了，最后一天可以不上班或随时走。":"At this pace the week's hours are done before the last workday, so you can skip it or leave any time.","抽烟的次数默认来自首页的「抽烟」计数器；午休和抽烟栏位留空就用默认值。":"The smoking count comes from the Smoking counter on the home page by default; leave lunch and smoking empty to use the defaults.","打卡设置":"Timecard settings","每天工时（小时）":"Hours per day","午休（分钟）":"Lunch (minutes)","每周工作几天":"Workdays per week","每根烟扣几分钟":"Minutes deducted per cigarette","工时怎么算":"How hours are counted","抽烟的时间不算工作（扣掉）":"Smoke breaks are not work (deducted)","抽烟也算工作（不扣）":"Smoke breaks count as work (not deducted)","打卡时把抽烟次数算进去":"Include smoking in the hours","下班时间 = 上班 + 每天工时 + 午休 + 抽烟次数 × 每根扣的分钟。每周目标 = 每天工时 × 每周工作天数。设置存在 Records 分页，所有设备同步。":"Leave time = clock-in + hours per day + lunch + smoking count × minutes per cigarette. Weekly target = hours per day × workdays per week. Settings live in the Records sheet and sync to all devices.","每天工时请填 1 到 16 小时":"Hours per day must be 1 to 16","午休请填 0 到 240 分钟":"Lunch must be 0 to 240 minutes","每周工作天数请填 1 到 7":"Workdays per week must be 1 to 7","每根烟扣的分钟请填 0 到 60":"Minutes per cigarette must be 0 to 60"},
    tpl:{"上班 {0}":"In {0}","{0} – {1}":"{0} – {1}","预计下班 {0}":"Leave at {0}"," · 抽烟 {0} 根，下班延后 {1} 分钟":" · {0} {0|cigarette|cigarettes}, leaving {1} min later","本周快达标了，今天 <b>{0}</b> 就能下班（正常是 {1}）":"The week is almost done — you can leave at <b>{0}</b> today (normally {1})","超时 {0}":"Overtime {0}","还差 {0}":"{0} short","今天工作 {0}":"Worked {0} today","{0} 那一周":"Week of {0}","周{0}":"{0}","今天 {0}":"Today {0}","本周 {0}":"Week {0}","今天最早 <b>{0}</b> 可以下班（本周只差 {1}，正常是 {2}）":"You can leave as early as <b>{0}</b> today (only {1} left this week; normally {2})","今天 <b>{0}</b> 下班（正常，本周还差 {1}）":"Leave at <b>{0}</b> today (normal; {1} left this week)","最后一个工作日（周{0}）要工作 <b>{1}</b>，{2} 上班的话 <b>{3}</b> 就能下班。":"Last workday ({0}) needs <b>{1}</b> of work: clock in at {2} and you can leave at <b>{3}</b>.","{0} 小时 / 天":"{0} h / day"}
  }
});
PL.timecard={cfg:cfg,saveCfg:saveCfg,day:day,saveDay:saveDay,hours:hours,weekInfo:weekInfo,leaveToday:leaveToday,planWeek:planWeek,leaveAt:leaveAt,dayId:dayId,hm:hm,toMin:toMin,fromMin:fromMin,clockIn:clockIn,clockOut:clockOut};   /* for tests */
})();
