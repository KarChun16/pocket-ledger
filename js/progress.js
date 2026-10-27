/* progress.js
   Three things to keep an eye on, on one page (钱 → 进度) and a small card on the home page:
     还朋友     how much of a debt ("I owe") has been paid back - the debt itself lives in 钱 → 欠款
     戒烟       days since the quit date, money not spent on cigarettes, and what share of the debt that is
     备用金     an emergency-fund target and the deposits made towards it
   Data lives in Records:
     mod "progcfg"  {id: CFG_ID, extra: JSON {debtId, debtMonthly, quitStart, quitCost, best, fundTarget, fundMonthly}}
     mod "fund"     one row per deposit {date, val: amount, text: note}
   Nothing here has default amounts: the cost per day, the targets and the monthly amounts are all typed in. */
(function(){
var CFG_ID=391000000000000;
var openCfg=false;

function pad(n){return String(n).padStart(2,"0")}
function dayNum(d){var p=d.split("-");return Math.round(Date.UTC(+p[0],+p[1]-1,+p[2])/864e5)}
function daysBetween(a,b){return dayNum(b)-dayNum(a)}
function addMonths(date,n){var d=new Date(date+"T00:00:00");d.setMonth(d.getMonth()+n);return d.getFullYear()+"-"+pad(d.getMonth()+1)}
function r2(n){return Math.round(n*100)/100}
function pct(p){return p<10?(Math.round(p*10)/10).toString():String(Math.round(p))}

function cfg(){var r=PL.rec.get(CFG_ID),x=r?PL.rec.data(r):{};return x||{}}
function saveCfg(patch){var c=cfg();Object.keys(patch).forEach(function(k){if(patch[k]===undefined||patch[k]===null||patch[k]==="")delete c[k];else c[k]=patch[k]});PL.rec.add({id:CFG_ID,mod:"progcfg",date:"2000-01-01",extra:c})}

/* ---- the three numbers ---- */
function owed(){var l=(PL.money?PL.money.debts():[]).filter(function(d){return d.dir==="owe"});return l}
function lentList(){return (PL.money?PL.money.debts():[]).filter(function(d){return d.dir==="lent"&&!d.acct}).sort(function(a,b){return (a.settled-b.settled)||(a.start<b.start?-1:a.start>b.start?1:0)})}
function debtInfo(){
  var c=cfg(),l=owed(),d=null;
  if(c.debtId!==undefined)d=l.filter(function(x){return String(x.id)===String(c.debtId)})[0]||null;
  if(!d)d=l.filter(function(x){return !x.settled})[0]||l[0]||null;
  if(!d)return null;
  var p=d.principal>0?Math.min(100,d.paid/d.principal*100):100;
  return {d:d,pct:p,list:l,monthly:+c.debtMonthly>0?+c.debtMonthly:0};
}
function quitInfo(){
  var c=cfg();if(!c.quitStart)return null;
  var n=daysBetween(c.quitStart,today()),cost=+c.quitCost>0?+c.quitCost:0;
  return {start:c.quitStart,n:n,future:n<0,cost:cost,saved:cost>0&&n>0?r2(n*cost):0,best:+c.best||0};
}
function fundInfo(){
  var c=cfg(),t=+c.fundTarget>0?+c.fundTarget:0,rows=PL.rec.list("fund").slice().sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:b.id-a.id}),s=0;
  rows.forEach(function(r){s+=+r.val||0});
  s=r2(s);
  return {target:t,saved:s,rows:rows,pct:t>0?Math.min(100,s/t*100):0,monthly:+c.fundMonthly>0?+c.fundMonthly:0};
}
function etaText(left,monthly){
  if(!(left>0))return "";
  if(!(monthly>0))return "";
  var n=Math.ceil(left/monthly);
  return tl("每月 {0}，约 {1} 个月（{2}）",rm0(monthly),n,addMonths(today(),n));
}

/* ---- home card: one line each ---- */
function homeRow(label,bar,txt){return '<button class="pgrow" data-pgopen><span class="pgl">'+esc(label)+'</span>'+(bar===null?"":'<span class="bar"><i style="width:'+bar+'%"></i></span>')+'<span class="pgv">'+txt+'</span></button>'}
function drawHome(el){
  var di=debtInfo(),q=quitInfo(),f=fundInfo(),h="";
  if(di)h+=homeRow(tl("还朋友"),di.pct,esc(pct(di.pct))+"%");
  if(q)h+=homeRow(tl("戒烟"),null,q.future?esc(tl("{0} 天后开始",-q.n)):esc(tl("第 {0} 天",q.n+1))+(q.saved>0?" · "+esc(rm0(q.saved)):""));
  if(f.target>0)h+=homeRow(tl("备用金"),f.pct,esc(pct(f.pct))+"%");
  var lt=lentList().filter(function(d){return !d.settled});
  if(lt.length){var lr=0;lt.forEach(function(d){lr+=d.leftRM!==null?d.leftRM:0});h+=homeRow(tl("别人还我"),null,esc(tl("{0} 笔 · {1}",lt.length,rm0(lr))))}
  el.hidden=!h;                                                       /* nothing set up yet: no card on the home page (the page is under 钱 → 进度) */
  var html='<h2>'+esc(tl("进度"))+'</h2>'+h;
  if(el._h!==html){el.innerHTML=html;el._h=html}
}

/* ---- the page ---- */
function field(id,label,val,extra){return '<div><label for="'+id+'">'+esc(label)+'</label><input id="'+id+'" '+(extra||"")+' value="'+esc(val===undefined?"":val)+'"></div>'}
function debtCard(){
  var di=debtInfo(),h='<div class="card"><h2>'+esc(tl("还朋友"))+'</h2>';
  if(!di)return h+'<p class="msg" style="margin:0">'+esc(tl("还没有「我欠」的欠款。到 钱 → 欠款 添加后，这里会显示还了几成。"))+'</p></div>';
  var d=di.d,fx=d.cur!=="MYR";
  if(di.list.length>1)h+='<select id="pgDebt" aria-label="'+esc(tl("选哪一笔欠款"))+'" style="margin-bottom:10px">'+di.list.map(function(x){return '<option value="'+x.id+'"'+(x.id===d.id?" selected":"")+'>'+esc(x.name)+(x.settled?" ✓":"")+'</option>'}).join("")+'</select>';
  h+='<div class="pgbig">'+esc(pct(di.pct))+'<small>%</small></div><div class="bar" style="height:10px"><i style="width:'+di.pct+'%"></i></div>'+
    '<p class="msg" style="margin:8px 0 0">'+esc(tl("已还 {0} / {1}",PL.money.cm(d.cur,d.paid),PL.money.cm(d.cur,d.principal)))+'</p>'+
    (d.settled?'<p class="msg tcok">'+esc(tl("已经还清了 🎉"))+'</p>':'<p class="msg" style="margin:2px 0 0">'+esc(d.leftRM!==null&&fx?tl("还剩 {0}（约 {1}）",PL.money.cm(d.cur,d.left),rm0(d.leftRM)):tl("还剩 {0}",PL.money.cm(d.cur,d.left)))+'</p>');
  if(!d.settled){
    h+='<div class="grid" style="margin-top:12px">'+field("pgDebtM",tl("每月打算还 (RM)"),di.monthly||"",'type="number" inputmode="decimal" min="0" step="any"')+'</div>';
    var left=d.leftRM!==null?d.leftRM:(fx?0:d.left),e=etaText(left,di.monthly);
    if(e)h+='<p class="msg" style="margin:8px 0 0">'+esc(e)+'</p>';
  }
  return h+'</div>';
}
function quitCard(){
  var q=quitInfo(),di=debtInfo(),h='<div class="card"><h2>'+esc(tl("戒烟"))+'</h2>';
  if(!q){
    return h+'<p class="msg" style="margin:0 0 10px">'+esc(tl("定一个开始戒烟的日子，这里会数你撑了几天、省了多少钱。"))+'</p><div class="grid">'+
      field("pgQStart",tl("从哪天开始"),today(),'type="date"')+field("pgQCost",tl("每天抽烟花多少 (RM)"),"",'type="number" inputmode="decimal" min="0" step="any"')+'</div>'+
      '<button class="btn" id="pgQGo" style="width:100%;margin-top:12px">'+esc(tl("开始戒烟"))+'</button><div class="msg" id="pgQMsg"></div></div>';
  }
  if(q.future)h+='<div class="pgbig">'+esc(tl("{0} 天后开始",-q.n))+'</div>';
  else{
    h+='<div class="pgbig">'+esc(tl("第 {0} 天",q.n+1))+'</div>';
    if(q.cost>0){
      h+='<p class="msg" style="margin:0;font-size:17px;color:var(--ink)">'+esc(tl("已省 {0}",rm(q.saved)))+'</p>';
      var lr=di&&!di.d.settled?(di.d.leftRM!==null?di.d.leftRM:(di.d.cur==="MYR"?di.d.left:null)):null;
      if(lr>0&&q.saved>0)h+='<p class="msg" style="margin:4px 0 0">'+esc(tl("相当于欠款剩余的 {0}%",pct(Math.min(100,q.saved/lr*100))))+'</p>';
      h+='<p class="msg" style="margin:4px 0 0">'+esc(tl("今天撑过去，再省 {0}",rm(q.cost)))+'</p>';
    }else h+='<p class="msg" style="margin:4px 0 0">'+esc(tl("填上每天抽烟花多少，就会算出省了多少。"))+'</p>';
    if(q.best>0)h+='<p class="msg" style="margin:4px 0 0">'+esc(tl("最长一次 {0} 天",q.best))+'</p>';
    h+='<button class="btn ghost" id="pgQAgain" style="width:100%;margin-top:12px">'+esc(tl("我又抽了，重新开始"))+'</button>';
  }
  h+='<details class="more" id="pgQEdit"'+(openCfg?" open":"")+'><summary>'+esc(tl("修改"))+'</summary><div class="grid" style="margin-top:8px">'+field("pgQStart",tl("从哪天开始"),q.start,'type="date"')+field("pgQCost",tl("每天抽烟花多少 (RM)"),q.cost||"",'type="number" inputmode="decimal" min="0" step="any"')+'</div>'+
    '<button class="btn ghost small" id="pgQStop" style="margin-top:10px">'+esc(tl("不用这个了（清除）"))+'</button><div class="msg" id="pgQMsg"></div></details></div>';
  return h;
}
function fundCard(){
  var f=fundInfo(),h='<div class="card"><h2>'+esc(tl("备用金"))+'</h2>';
  if(f.target>0){
    h+='<div class="pgbig">'+esc(pct(f.pct))+'<small>%</small></div><div class="bar" style="height:10px"><i style="width:'+f.pct+'%"></i></div>'+
      '<p class="msg" style="margin:8px 0 0">'+esc(tl("已存 {0} / {1}",rm(f.saved),rm(f.target)))+'</p>';
    if(f.saved>=f.target)h+='<p class="msg tcok">'+esc(tl("备用金够了 🎉"))+'</p>';
    else{var e=etaText(f.target-f.saved,f.monthly);h+='<p class="msg" style="margin:2px 0 0">'+esc(tl("还差 {0}",rm(f.target-f.saved)))+(e?" · "+esc(e):"")+'</p>'}
  }else h+='<p class="msg" style="margin:0 0 10px">'+esc(tl("设一个备用金目标（例如 3 个月的生活费），每次存入后记一笔。"))+'</p>';
  h+='<div class="grid" style="margin-top:12px">'+field("pgFT",tl("目标 (RM)"),f.target||"",'type="number" inputmode="decimal" min="0" step="any"')+field("pgFM",tl("每月打算存 (RM)"),f.monthly||"",'type="number" inputmode="decimal" min="0" step="any"')+'</div>'+
    '<h3 class="tcph">'+esc(tl("存入一笔"))+'</h3><div class="grid">'+field("pgFA",tl("金额 (RM)"),"",'type="number" inputmode="decimal" min="0" step="any"')+field("pgFD",tl("日期"),today(),'type="date"')+'</div>'+
    '<button class="btn" id="pgFAdd" style="width:100%;margin-top:10px">'+esc(tl("存入"))+'</button><div class="msg" id="pgFMsg"></div>';
  if(f.rows.length)h+='<h3 class="tcph">'+esc(tl("存入记录"))+'</h3>'+f.rows.slice(0,8).map(function(r){return '<div class="tcprow"><span>'+esc(r.date.slice(5).replace("-","/"))+'</span><b>'+esc(rm(+r.val))+' <button class="x" data-pgfdel="'+r.id+'" aria-label="'+esc(tl("删除"))+'" style="display:inline-flex;vertical-align:middle">×</button></b></div>'}).join("");
  return h+'</div>';
}
function lentCard(){
  var l=lentList(),h='<div class="card"><h2>'+esc(tl("别人还我"))+'</h2>';
  if(!l.length)return h+'<p class="msg" style="margin:0">'+esc(tl("还没有「别人欠我」的记录。到 钱 → 欠款，点「＋ 别人欠我钱」添加。"))+'</p></div>';
  return h+l.map(function(d,i){
    var p=d.principal>0?Math.min(100,d.paid/d.principal*100):100,late=!d.settled&&d.due&&d.days!==null&&d.days<0;
    return '<div class="pglent"'+(i?' style="border-top:.5px solid var(--line);padding-top:12px;margin-top:12px"':'')+'><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b>'+esc(d.name)+'</b><span class="'+(d.settled?"tcok":"")+'">'+(d.settled?esc(tl("已收齐 ✓")):esc(pct(p))+"%")+'</span></div>'+
      '<div class="bar" style="margin:6px 0"><i style="width:'+p+'%"></i></div>'+
      '<p class="msg" style="margin:0">'+esc(tl("已收 {0} / {1}",PL.money.cm(d.cur,d.paid),PL.money.cm(d.cur,d.principal)))+(d.settled?"":" · "+esc(tl("还剩 {0}",PL.money.cm(d.cur,d.left))))+'</p>'+
      (!d.settled&&d.due?'<p class="msg'+(late?" tcshort":"")+'" style="margin:2px 0 0">'+esc(late?tl("逾期 {0} 天",-d.days):tl("到期 {0}",d.due))+'</p>':"")+'</div>';
  }).join("")+'</div>';
}
function drawPage(){
  var b=$("pgBody");if(!b)return;
  var a=document.activeElement;
  if(a&&b.contains(a)&&/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName))return;       /* never redraw under a field that is being typed in */
  var html=debtCard()+lentCard()+quitCard()+fundCard();
  if(b._h!==html){var y=window.scrollY;b.innerHTML=html;b._h=html;if(window.scrollY!==y)window.scrollTo(0,y)}
}

/* ---- actions ---- */
function onClick(e){
  var b=e.target.closest&&e.target.closest("button");if(!b)return;
  var id=b.id;
  if(id==="pgQGo"){
    var s=$("pgQStart").value,c=parseFloat($("pgQCost").value),m=$("pgQMsg");
    if(!s){m.textContent=tl("请选开始的日期");return}
    if(!(c>=0)||$("pgQCost").value.trim()===""){m.textContent=tl("请填每天抽烟花多少");return}
    saveCfg({quitStart:s,quitCost:r2(c),best:0});toast(tl("开始戒烟"),tl("一天一天来 💪"));
  }else if(id==="pgQAgain"){
    if(b.getAttribute("data-sure")!=="1"){b.setAttribute("data-sure","1");b.textContent=tl("再按确认");setTimeout(function(){if(b.isConnected){b.removeAttribute("data-sure");b.textContent=tl("我又抽了，重新开始")}},3000);return}
    var q=quitInfo();saveCfg({quitStart:today(),best:Math.max(q?q.best:0,q&&q.n>0?q.n:0)});toast(tl("没关系，重新开始"),tl("一天一天来 💪"));
  }else if(id==="pgQStop"){
    if(b.getAttribute("data-sure")!=="1"){b.setAttribute("data-sure","1");b.textContent=tl("再按确认");setTimeout(function(){if(b.isConnected){b.removeAttribute("data-sure");b.textContent=tl("不用这个了（清除）")}},3000);return}
    saveCfg({quitStart:"",quitCost:"",best:""});
  }else if(id==="pgFAdd"){
    var a=parseFloat($("pgFA").value),d=$("pgFD").value||today(),fm=$("pgFMsg");
    if(!(a>0)){fm.textContent=tl("金额要大于 0");return}
    PL.rec.add({mod:"fund",date:d,val:r2(a),text:""});toast(tl("已存入"),rm(a));
  }else if(b.getAttribute("data-pgfdel")){
    PL.rec.del(+b.getAttribute("data-pgfdel"));
  }else return;
  if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
  drawPage();
}
function onChange(e){
  var t=e.target,id=t.id,v=t.value;
  if(id==="pgDebt")saveCfg({debtId:v});
  else if(id==="pgDebtM")saveCfg({debtMonthly:+v>0?+v:""});
  else if(id==="pgFT")saveCfg({fundTarget:+v>0?+v:""});
  else if(id==="pgFM")saveCfg({fundMonthly:+v>0?+v:""});
  else if((id==="pgQStart"||id==="pgQCost")&&cfg().quitStart){
    var s=$("pgQStart").value,c=parseFloat($("pgQCost").value);
    if(!s)return;
    saveCfg({quitStart:s,quitCost:c>=0?r2(c):""});
  }else return;
  if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
  drawPage();
}

PL.module({
  id:"progress",
  title:"进度",
  page:{group:"money",label:"进度",html:'<div id="pgBody"></div>'},
  show:drawPage,
  home:{id:"progHome",html:"",render:drawHome},
  init:function(){
    $("pgBody").addEventListener("click",onClick);$("pgBody").addEventListener("change",onChange);
    $("pgBody").addEventListener("click",function(e){var s=e.target.closest&&e.target.closest("#pgQEdit>summary");if(s)openCfg=!$("pgQEdit").open});
    $("progHome").addEventListener("click",function(e){if(e.target.closest&&e.target.closest("[data-pgopen]"))tab("progress")});
    PL.on("data",function(){if(!$("p-progress").hidden)drawPage()});
    PL.on("synced",function(){if(!$("p-progress").hidden)drawPage()});
  },
  en:{
    exact:{"进度":"Progress","别人还我":"Paid back to me","还没有「别人欠我」的记录。到 钱 → 欠款，点「＋ 别人欠我钱」添加。":"Nobody owes you yet. Add one under Money → Debt with \"+ Someone owes me\".","已收齐 ✓":"Collected in full ✓","还朋友":"Pay back a friend","戒烟":"Quit smoking","备用金":"Emergency fund","设定你的目标":"Set your goals","选哪一笔欠款":"Which debt","每月打算还 (RM)":"Planned monthly payment (RM)","还没有「我欠」的欠款。到 钱 → 欠款 添加后，这里会显示还了几成。":"No \"I owe\" debt yet. Add one under Money → Debt and this shows how much is paid back.","已经还清了 🎉":"Paid off 🎉","定一个开始戒烟的日子，这里会数你撑了几天、省了多少钱。":"Pick a start day and this counts how many days you made it and how much you saved.","从哪天开始":"Start date","每天抽烟花多少 (RM)":"Spent on cigarettes per day (RM)","开始戒烟":"Start quitting","填上每天抽烟花多少，就会算出省了多少。":"Enter what you spend per day and it works out what you saved.","我又抽了，重新开始":"I smoked, start again","修改":"Edit","不用这个了（清除）":"Remove this tracker","再按确认":"Tap again to confirm","备用金够了 🎉":"Emergency fund is covered 🎉","设一个备用金目标（例如 3 个月的生活费），每次存入后记一笔。":"Set an emergency-fund target (for example 3 months of living costs) and log each deposit.","目标 (RM)":"Target (RM)","每月打算存 (RM)":"Planned monthly deposit (RM)","存入一笔":"Add a deposit","金额 (RM)":"Amount (RM)","日期":"Date","存入":"Deposit","存入记录":"Deposits","删除":"Delete","请选开始的日期":"Please pick a start date","请填每天抽烟花多少":"Please enter what you spend per day","一天一天来 💪":"One day at a time 💪","没关系，重新开始":"It's okay, starting again","金额要大于 0":"The amount must be above 0","已存入":"Deposited"},
    tpl:{"{0} 笔 · {1}":"{0} open · {1}","已收 {0} / {1}":"Received {0} / {1}","逾期 {0} 天":"{0} days overdue","到期 {0}":"Due {0}","{0} 天后开始":"Starts in {0} d","第 {0} 天":"Day {0}","已还 {0} / {1}":"Paid {0} / {1}","还剩 {0}（约 {1}）":"{0} left (about {1})","还剩 {0}":"{0} left","已省 {0}":"Saved {0}","相当于欠款剩余的 {0}%":"That is {0}% of what is left of the debt","今天撑过去，再省 {0}":"Get through today and save {0} more","最长一次 {0} 天":"Longest run: {0} days","已存 {0} / {1}":"Saved {0} / {1}","还差 {0}":"{0} to go","每月 {0}，约 {1} 个月（{2}）":"{0} a month, about {1} months ({2})"}
  }
});
PL.progress={cfg:cfg,saveCfg:saveCfg,debtInfo:debtInfo,quitInfo:quitInfo,fundInfo:fundInfo};   /* for tests */
})();
