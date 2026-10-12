/* counters.js
   Counters: tap to log things that happen during the day - a cigarette, a coffee, a glass of water, anything you add.
   Data lives in Records:
     mod "counter"  one tap       {text: counter id, val: amount, date, time}
     mod "ctrdef"   one counter's settings (only what you changed, plus every custom counter)
                    {text: counter id, extra: JSON {name, icon, unit, step, kind: "none"|"limit"|"goal", limit, price, cat, hide}} */
(function(){
var BUILT=[
  {id:"smoke",name:"抽烟",icon:"🚬",unit:"根",step:1,kind:"none",limit:0,price:0,cat:"Smoking"},
  {id:"coffee",name:"咖啡",icon:"☕",unit:"杯",step:1,kind:"limit",limit:3,price:0,cat:""},
  {id:"water",name:"喝水",icon:"💧",unit:"ml",step:250,kind:"goal",limit:2000,price:0,cat:""}
];
var FIELDS=["name","icon","unit","step","kind","limit","price","cat","hide"];
var detailId=null,editId=null;

function num(n){return Number(n).toLocaleString("en-MY",{maximumFractionDigits:2})}
function qty(d,v){return d.unit?tl("{0} {1}",num(v),d.unit):num(v)}
function per(d){return d.unit?tl("{0} {1}",1,d.unit):"1"}
function mergeDef(base,row){
  var x=row?PL.rec.data(row):{},o={};
  FIELDS.forEach(function(k){o[k]=x[k]!==undefined?x[k]:base[k]});
  o.id=base.id;o.custom=!!base.custom;o.row=row||null;return o;
}
/* all counters: the three built-in ones (with your changes) followed by the ones you added */
function defs(){
  var over={};PL.rec.list("ctrdef").forEach(function(r){over[r.text]=r});
  var out=BUILT.map(function(b){return mergeDef(b,over[b.id])});
  Object.keys(over).forEach(function(id){
    if(BUILT.some(function(b){return b.id===id}))return;
    out.push(mergeDef({id:id,custom:true,name:id,icon:"🔢",unit:"",step:1,kind:"none",limit:0,price:0,cat:"",hide:false},over[id]));
  });
  return out;
}
function def(id){return defs().filter(function(d){return d.id===id})[0]||null}
/* taps grouped as {counterId: {date: [rows]}} */
function index(){
  var ix={};PL.rec.list("counter").forEach(function(r){var m=ix[r.text]=ix[r.text]||{};(m[r.date]=m[r.date]||[]).push(r)});return ix;
}
function sum(rows){var t=0;(rows||[]).forEach(function(r){t+=r.val});return Math.round(t*1000)/1000}
function addDays(date,n){var d=new Date(date+"T00:00:00");d.setDate(d.getDate()+n);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function state(d,v){
  if(d.kind==="limit"&&d.limit>0)return v>d.limit?"over":v>=d.limit*0.8?"near":"";
  if(d.kind==="goal"&&d.limit>0)return v>=d.limit?"done":"";
  return "";
}
function ago(date,time){
  if(date!==today()||!time)return "";
  var n=new Date(),m=n.getHours()*60+n.getMinutes()-(+time.slice(0,2)*60+ +time.slice(3,5));
  if(m<0)return "";
  if(m<60)return tl("{0} 分钟前",m);
  return tl("{0} 小时 {1} 分前",Math.floor(m/60),m%60);
}
function lastOf(rows){return rows&&rows.length?rows.slice().sort(function(a,b){return a.time<b.time?-1:a.time>b.time?1:a.id-b.id}).pop():null}

/* ---- tap to log ---- */
function log(id,amount,opts){
  var d=def(id);if(!d)return null;
  opts=opts||{};
  var r=PL.rec.add({mod:"counter",text:id,val:amount===undefined?d.step:amount,date:opts.date||today(),time:opts.time===undefined?"now":opts.time});
  if(!r)return null;
  if(opts.quiet)return r;
  var t=sum(index()[id]&&index()[id][today()]),st=state(d,t),warn="";
  if(st==="over")warn=tl("⚠️ 超过今日上限 {0}",qty(d,d.limit));
  else if(st==="near")warn=tl("快到今日上限 {0}",qty(d,d.limit));
  else if(st==="done")warn=tl("🎉 今天的目标达成：{0}",qty(d,d.limit));
  toast(tl("{0} +{1}",d.name,num(r.val)),tl("今天共 {0}",qty(d,t)),warn,st==="over");
  return r;
}
function undo(id){
  var last=lastOf((index()[id]||{})[today()]);
  if(!last)return false;
  PL.rec.del(last.id);
  var d=def(id);toast(tl("已撤销 {0}",d?d.name:id),tl("今天共 {0}",qty(d||{unit:""},sum((index()[id]||{})[today()]))));
  return true;
}

/* ---- home card ---- */
function drawHome(el){
  var ix=index(),D=defs().filter(function(d){return !d.hide});
  if(!D.length){el.hidden=true;return}
  el.hidden=false;
  var t=today();
  el.querySelector("#ctrRows").innerHTML=D.map(function(d){
    var rows=(ix[d.id]||{})[t]||[],v=sum(rows),st=state(d,v),last=lastOf(rows);
    var goal=d.limit>0&&d.kind!=="none"?'<small> / '+num(d.limit)+'</small>':'';
    var sub=d.price>0&&v>0?tl("约 {0}",rm(v*d.price)):(last?tl("上一次 {0}",ago(t,last.time)||last.time):tl("今天还没有"));
    return '<div class="ctr" data-cid="'+esc(d.id)+'"><button class="cinfo" data-copen="'+esc(d.id)+'"><span class="ci" aria-hidden="true">'+esc(d.icon)+'</span><span class="ct"><span class="cn">'+esc(d.name)+'</span><span class="cs">'+esc(sub)+'</span></span><span class="cv '+st+'">'+num(v)+goal+(d.unit?'<small> '+esc(d.unit)+'</small>':'')+'</span></button>'+
      '<button class="cbtn minus" data-cminus="'+esc(d.id)+'" aria-label="'+esc(tl("撤销上一次"))+'"'+(rows.length?'':' disabled')+'>−</button>'+
      '<button class="cbtn plus" data-cplus="'+esc(d.id)+'" aria-label="'+esc(tl("记一次 {0}",d.name))+'">+</button></div>';
  }).join("");
}

/* ---- detail window ---- */
function drawDetail(){
  var d=def(detailId),body=$("ctrDetailBody");
  if(!d){body.innerHTML="";return}
  var ix=index()[d.id]||{},t=today(),rows=(ix[t]||[]).slice().sort(function(a,b){return a.time<b.time?-1:a.time>b.time?1:a.id-b.id});
  var v=sum(rows),st=state(d,v),pct=d.limit>0&&d.kind!=="none"?Math.min(100,v/d.limit*100):0;
  var last=lastOf(rows);
  var h='<div class="row" style="justify-content:space-between;align-items:flex-end"><div><div class="hero" style="margin:0;color:var(--'+(st==="over"?"bad":st==="near"?"warn":"good")+')">'+num(v)+'<small style="font-size:16px;color:var(--muted)"> '+esc(d.unit)+'</small></div><div class="msg" style="margin:2px 0 0">'+
    tl("今天")+(d.kind!=="none"&&d.limit>0?" · "+tl(d.kind==="limit"?"上限 {0}":"目标 {0}",qty(d,d.limit)):"")+(last&&ago(t,last.time)?" · "+tl("上一次 {0}",ago(t,last.time)):"")+'</div></div>'+
    '<div class="row"><button class="btn ghost small" data-dminus aria-label="'+esc(tl("撤销上一次"))+'"'+(rows.length?'':' disabled')+'>−</button><button class="btn small" data-dplus>+ '+esc(qty(d,d.step))+'</button></div></div>';
  if(pct>0)h+='<div class="bar" style="margin-top:10px"><i class="'+(st==="over"?"over":st==="near"?"near":"")+'" style="'+(st==="done"?"background:var(--good);":"")+'width:'+pct+'%"></i></div>';
  /* today's timeline */
  h+='<h3 style="margin:16px 0 2px;font-size:13px;color:var(--muted);font-weight:600">'+tl("今天的记录")+'</h3>';
  h+=rows.length?rows.map(function(r){return '<div class="rrow t3"><b>'+esc(r.time||"—")+'</b><div class="amt">'+qty(d,r.val)+'</div><div class="acts"><button class="x" data-ddel="'+r.id+'" aria-label="'+esc(tl("删除这笔"))+'">×</button></div></div>'}).join(""):'<div class="empty" style="padding:8px 0">'+tl("今天还没有")+'</div>';
  /* last 7 days */
  var days=[],mx=1;
  for(var i=6;i>=0;i--){var dt=addDays(t,-i),s=sum(ix[dt]);days.push([dt,s]);if(s>mx)mx=s}
  h+='<h3 style="margin:16px 0 0;font-size:13px;color:var(--muted);font-weight:600">'+tl("最近 7 天")+'</h3><div class="wchart">'+days.map(function(x){
    var over=d.kind==="limit"&&d.limit>0&&x[1]>d.limit;
    return '<div class="wc"><small class="wv">'+(x[1]?num(x[1]):"")+'</small><div class="wb"><i class="'+(over?"hi":"")+'" style="height:'+(x[1]/mx*100)+'%"></i></div><small>'+tl("周{0}",["日","一","二","三","四","五","六"][new Date(x[0]+"T00:00:00").getDay()])+'</small></div>'}).join("")+'</div>';
  /* this month */
  var ym=t.slice(0,7),mt=0,md=0,best=null;
  Object.keys(ix).forEach(function(dt){if(dt.slice(0,7)===ym){var s=sum(ix[dt]);mt+=s;md++;if(!best||s>best[1])best=[dt,s]}});
  var elapsed=+t.slice(8,10);
  h+='<div class="stat" style="margin-top:12px"><div><small>'+tl("本月合计")+'</small><strong>'+num(mt)+'</strong></div><div><small>'+tl("每天平均")+'</small><strong>'+num(Math.round(mt/elapsed*10)/10)+'</strong></div><div><small>'+tl("最多的一天")+'</small><strong>'+(best?num(best[1]):"—")+'</strong></div></div>';
  if(d.price>0)h+='<p class="msg">'+tl("本月约花 {0}（每 {1} {2}）",rm(mt*d.price),per(d),rm(d.price))+'</p>';
  if(d.cat){var cs=0;spent().forEach(function(x){if(x.cat===d.cat&&x.date.slice(0,7)===ym)cs+=x.amt});h+='<p class="msg">'+tl("对照「{0}」分类本月已记 {1}",d.cat,rm(cs))+'</p>'}
  /* forgot to tap: add one for another time */
  h+='<details class="more" style="margin-top:10px"><summary>'+tl("补记一笔")+'</summary><div class="grid" style="margin-top:8px"><div><label>'+tl("日期")+'</label><input type="date" id="cdDate" value="'+t+'"></div><div><label>'+tl("时间")+'</label><input type="time" id="cdTime" value="'+(function(){var n=new Date();return String(n.getHours()).padStart(2,"0")+":"+String(n.getMinutes()).padStart(2,"0")})()+'"></div><div class="full"><label>'+esc(d.unit?tl("数量 ({0})",d.unit):tl("数量"))+'</label><input type="number" inputmode="decimal" step="any" min="0" id="cdAmt" value="'+d.step+'"></div></div><button class="btn small" data-dback style="margin-top:10px">'+tl("补记")+'</button><div class="msg" id="cdMsg"></div></details>';
  body.innerHTML=h;
}
function openDetail(id){
  var d=def(id);if(!d)return;
  detailId=id;
  PL.popup("ctrDetail","计数",'<div class="card" id="ctrDetail"><div id="ctrDetailBody"></div></div>');
  PL.popTitle("ctrDetail",d.name,d.icon);
  if(!$("ctrDetailBody").getAttribute("data-wired")){$("ctrDetailBody").setAttribute("data-wired","1");$("ctrDetailBody").addEventListener("click",detailClick)}
  drawDetail();openPop("ctrDetail");
}

function detailClick(e){
  var b=e.target.closest&&e.target.closest("button");if(!b||!detailId)return;
  if(b.hasAttribute("data-dplus"))log(detailId);
  else if(b.hasAttribute("data-dminus"))undo(detailId);
  else if(b.getAttribute("data-ddel")){PL.rec.del(+b.getAttribute("data-ddel"))}
  else if(b.hasAttribute("data-dback")){
    var date=$("cdDate").value,time=$("cdTime").value,amt=parseFloat($("cdAmt").value),d=def(detailId);
    if(!date||!time){$("cdMsg").textContent=tl("请填日期和时间");return}
    if(!(amt>0)){$("cdMsg").textContent=tl("数量要大于 0");return}
    if(!log(detailId,amt,{date:date,time:time,quiet:true})){$("cdMsg").textContent=tl("日期或时间不对");return}
    toast(tl("已补记 {0}",d.name),date+" "+time+" · "+qty(d,amt));
  }
}

/* ---- settings: manage the counters ---- */
function kindText(d){return d.kind==="limit"&&d.limit>0?tl("每天上限 {0}",qty(d,d.limit)):d.kind==="goal"&&d.limit>0?tl("每天目标 {0}",qty(d,d.limit)):tl("不设上限")}
function drawManage(){
  if(!$("ctrList"))return;
  $("ctrList").innerHTML=defs().map(function(d){
    return '<div class="rrow'+(d.hide?' off':'')+'"><b>'+esc(d.icon)+' <span>'+esc(d.name)+'</span></b><div class="amt">+'+esc(qty(d,d.step))+'</div><div class="info">'+esc(kindText(d))+(d.price>0?" · "+tl("每 {0} {1}",per(d),rm(d.price)):"")+(d.hide?" · "+tl("首页已隐藏"):"")+'</div><div class="acts">'+
      '<button class="x" data-cedit="'+esc(d.id)+'" aria-label="'+esc(tl("修改"))+'">'+ICON_EDIT+'</button>'+
      '<button class="x" data-chide="'+esc(d.id)+'" aria-label="'+esc(tl(d.hide?"显示在首页":"从首页隐藏"))+'" title="'+esc(tl(d.hide?"显示在首页":"从首页隐藏"))+'">'+(d.hide?"👁":"🙈")+'</button>'+
      '<button class="x" data-cdel="'+esc(d.id)+'" aria-label="'+esc(tl(d.custom?"删除":"恢复默认"))+'">'+(d.custom?"×":"↺")+'</button></div></div>';
  }).join("");
}
function formFill(d){
  $("cfn").value=d?d.name:"";$("cfi").value=d?d.icon:"";$("cfu").value=d?d.unit:"";$("cfs").value=d?d.step:1;
  $("cfk").value=d?d.kind:"none";$("cfl").value=d&&d.limit>0?d.limit:"";$("cfp").value=d&&d.price>0?d.price:"";
  $("cfc").value=d?d.cat:"";
  $("cfsave").textContent=d?tl("保存修改"):tl("添加计数器");$("cfcancel").hidden=!d;
  $("cfTitle").textContent=d?tl("修改计数器"):tl("新增计数器");
  $("cfmsg").textContent="";
}
function saveForm(){
  var name=$("cfn").value.trim(),step=parseFloat($("cfs").value),limit=parseFloat($("cfl").value)||0,price=parseFloat($("cfp").value)||0,kind=$("cfk").value;
  if(!name){$("cfmsg").textContent=tl("请填名称");return}
  if(!(step>0)){$("cfmsg").textContent=tl("每次的数量要大于 0");return}
  if(kind!=="none"&&!(limit>0)){$("cfmsg").textContent=tl("请填每天的上限 / 目标数量");return}
  var cur=editId?def(editId):null;
  var id=editId||("x"+Date.now().toString(36));
  var x={name:name,icon:$("cfi").value.trim()||"🔢",unit:$("cfu").value.trim(),step:step,kind:kind,limit:kind==="none"?0:limit,price:price,cat:$("cfc").value,hide:cur?!!cur.hide:false};
  var existing=cur&&cur.row;
  if(existing)PL.rec.update(existing.id,{extra:x});else PL.rec.add({mod:"ctrdef",text:id,extra:x});
  toast(tl(editId?"计数器已修改":"计数器已添加"),name);
  editId=null;formFill(null);drawManage();
}
function setHide(id){
  var d=def(id);if(!d)return;
  var x={};FIELDS.forEach(function(k){x[k]=d[k]});x.hide=!d.hide;
  if(d.row)PL.rec.update(d.row.id,{extra:x});else PL.rec.add({mod:"ctrdef",text:id,extra:x});
}
/* change some fields of a counter's settings (e.g. from another module's settings card) */
function patchDef(id,patch){
  var d=def(id);if(!d)return false;
  var x={};FIELDS.forEach(function(k){x[k]=d[k]});Object.keys(patch).forEach(function(k){x[k]=patch[k]});
  if(d.row)PL.rec.update(d.row.id,{extra:x});else PL.rec.add({mod:"ctrdef",text:id,extra:x});
  return true;
}
function removeDef(id,btn){
  var d=def(id);if(!d)return;
  if(btn.getAttribute("data-sure")!=="1"){btn.setAttribute("data-sure","1");btn.textContent=tl("再按确认");setTimeout(function(){if(btn.isConnected)drawManage()},3000);return}
  if(d.custom){
    PL.rec.list("counter").filter(function(r){return r.text===id}).forEach(function(r){PL.rec.del(r.id)});
    if(d.row)PL.rec.del(d.row.id);
    toast(tl("计数器已删除"),d.name);
  }else{
    if(d.row)PL.rec.del(d.row.id);
    toast(tl("已恢复默认"),d.name);
  }
  if(editId===id){editId=null;formFill(null)}
}

var MANAGE_HTML='<div class="card" id="ctrSet"><h2>计数器</h2><div id="ctrList"></div>'+
  '<h3 id="cfTitle" style="margin:16px 0 6px;font-size:13px;color:var(--muted);font-weight:600">新增计数器</h3>'+
  '<div class="grid"><div class="full"><label for="cfn">名称</label><input id="cfn" type="text" maxlength="30" placeholder="例如：吃药、运动、伏地挺身"></div>'+
  '<div><label for="cfi">图标（一个表情）</label><input id="cfi" type="text" maxlength="4" placeholder="🔢"></div><div><label for="cfu">单位</label><input id="cfu" type="text" maxlength="8" placeholder="例如：次、杯、ml"></div>'+
  '<div><label for="cfs">每点一下 +</label><input id="cfs" type="number" inputmode="decimal" step="any" min="0" value="1"></div>'+
  '<div><label for="cfk">每天的数量</label><select id="cfk"><option value="none">不设限制</option><option value="limit">设上限（不要超过）</option><option value="goal">设目标（要达到）</option></select></div>'+
  '<div><label for="cfl">上限 / 目标数量</label><input id="cfl" type="number" inputmode="decimal" step="any" min="0"></div><div><label for="cfp">每个的价钱 (RM，可不填)</label><input id="cfp" type="number" inputmode="decimal" step="0.01" min="0"></div>'+
  '<div class="full"><label for="cfc">对照哪个花费分类（可不填）</label><select id="cfc"></select></div></div>'+
  '<div class="row" style="margin-top:14px"><button class="btn grow" id="cfsave">添加计数器</button><button class="btn ghost grow" id="cfcancel" hidden>取消修改</button></div><div class="msg" id="cfmsg"></div>'+
  '<p class="msg">首页会显示每个计数器今天的数量，点「+」记一次，点名字看详情和补记。数据存在 Records 分页，所有设备同步。</p></div>';

PL.module({
  id:"counters",
  title:"计数器",
  home:{id:"ctrHome",html:'<h2 style="margin:0 0 4px;font-size:13px;font-weight:600;color:var(--muted)">今天</h2><div id="ctrRows"></div>',render:drawHome},
  settings:[{id:"ctrSet",label:"计数器",sub:function(){var n=defs().filter(function(d){return !d.hide}).length;return n?tl("{0} 个",n):"没有"},html:MANAGE_HTML}],
  init:function(){
    $("cfc").innerHTML='<option value="">不对照</option>'+CATS.map(function(c){return '<option>'+esc(c)+'</option>'}).join("");
    formFill(null);drawManage();
    PL.on("data",function(){drawManage();if($("sheetP_ctrDetail")&&sheetOpen("P_ctrDetail"))drawDetail()});
    $("ctrHome").addEventListener("click",function(e){
      var b=e.target.closest&&e.target.closest("button");if(!b)return;
      var p=b.getAttribute("data-cplus"),m=b.getAttribute("data-cminus"),o=b.getAttribute("data-copen");
      if(p)log(p);else if(m)undo(m);else if(o)openDetail(o);
    });
    $("ctrSet").addEventListener("click",function(e){
      var b=e.target.closest&&e.target.closest("button");if(!b)return;
      var ed=b.getAttribute("data-cedit"),hd=b.getAttribute("data-chide"),dl=b.getAttribute("data-cdel");
      if(ed){var d=def(ed);if(d){editId=ed;formFill(d);$("cfn").focus()}}
      else if(hd)setHide(hd);
      else if(dl)removeDef(dl,b);
      else if(b.id==="cfsave")saveForm();
      else if(b.id==="cfcancel"){editId=null;formFill(null)}
    });
    $("cfk").addEventListener("change",function(){if(this.value!=="none"&&!$("cfl").value){var d=editId?def(editId):null;if(d&&d.limit>0)$("cfl").value=d.limit}});
  },
  en:{
    exact:{"计数器":"Counters","今天":"Today","抽烟":"Smoking","咖啡":"Coffee","喝水":"Water","根":"cigarettes","杯":"cups","今天还没有":"None yet today","今天的记录":"Today's log","最近 7 天":"Last 7 days","本月合计":"This month","每天平均":"Daily avg","最多的一天":"Best day","补记一笔":"Add a missed one","日期":"Date","时间":"Time","补记":"Add","撤销上一次":"Undo the last one","删除这笔":"Delete this entry","修改":"Edit","删除":"Delete","恢复默认":"Reset to default","显示在首页":"Show on home","从首页隐藏":"Hide from home","再按确认":"Tap again to confirm","不设上限":"No limit","首页已隐藏":"hidden on home","保存修改":"Save changes","添加计数器":"Add counter","修改计数器":"Edit counter","新增计数器":"New counter","请填名称":"Please enter a name","每次的数量要大于 0":"The amount per tap must be above 0","请填每天的上限 / 目标数量":"Please enter the daily limit / target","计数器已修改":"Counter updated","计数器已添加":"Counter added","计数器已删除":"Counter deleted","已恢复默认":"Reset to default","名称":"Name","图标（一个表情）":"Icon (one emoji)","单位":"Unit","例如：次、杯、ml":"e.g. times, cups, ml","例如：吃药、运动、伏地挺身":"e.g. medicine, workout, push-ups","每点一下 +":"Each tap adds","每天的数量":"Daily amount","不设限制":"No limit","设上限（不要超过）":"Set a limit (stay under)","设目标（要达到）":"Set a target (reach it)","上限 / 目标数量":"Limit / target amount","每个的价钱 (RM，可不填)":"Price each (RM, optional)","对照哪个花费分类（可不填）":"Compare with which spending category (optional)","不对照":"Don't compare","首页会显示每个计数器今天的数量，点「+」记一次，点名字看详情和补记。数据存在 Records 分页，所有设备同步。":"The home page shows today's count for each counter. Tap “+” to log one, tap the name for details and to add a missed one. Data lives in the Records sheet and syncs across all your devices.","没有":"None","数量":"Amount","请填日期和时间":"Please enter a date and time","数量要大于 0":"The amount must be above 0","日期或时间不对":"The date or time isn't valid"},
    tpl:{"{0} {1}":"{0} {1}","{0} 分钟前":"{0} min ago","{0} 小时 {1} 分前":"{0} h {1} min ago","⚠️ 超过今日上限 {0}":"⚠️ Over today's limit of {0}","快到今日上限 {0}":"Close to today's limit of {0}","🎉 今天的目标达成：{0}":"🎉 Today's target reached: {0}","{0} +{1}":"{0} +{1}","今天共 {0}":"{0} today","已撤销 {0}":"Undid {0}","约 {0}":"≈ {0}","上一次 {0}":"Last {0}","记一次 {0}":"Log one {0}","上限 {0}":"Limit {0}","目标 {0}":"Target {0}","本月约花 {0}（每 {1} {2}）":"About {0} spent this month ({2} per {1})","对照「{0}」分类本月已记 {1}":"Compare: “{0}” category this month {1}","每天上限 {0}":"Daily limit {0}","每天目标 {0}":"Daily target {0}","每 {0} {1}":"{1} per {0}","{0} 个":"{0}","数量 ({0})":"Amount ({0})","已补记 {0}":"Added a missed {0}"}
  }
});
PL.counters={log:log,undo:undo,defs:defs,index:index,def:def,patch:patchDef,qty:qty};   /* for other modules and tests */
})();
