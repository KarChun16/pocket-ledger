/* money.js
   The money features: expenses, budgets, debts, credit accounts, goals, recurring, salary, free-to-spend, insights, reports, backup. */
/* Display order of the categories. New ones can go anywhere here... */
var CATS=["Food","Drinks","Car","Living spend","Unnecessary","Smoking","Rent","Toll","Dating","Lifestyle","Saving","Investment","Groceries","Health Care","Insurance","Transport","Donation","Claim","Internet services","Friends","Shopping","Exercise","Snacks","Family"];
/* ...but this list only ever grows at the end: a category's position is part of its stored "must-pay" row id, so it must never move. */
var CAT_IDS=["Food","Drinks","Car","Living spend","Unnecessary","Smoking","Rent","Toll","Dating","Lifestyle","Saving","Investment","Groceries","Health Care","Transport","Donation","Claim","Internet services","Friends","Shopping","Exercise","Snacks","Family","Insurance"];
var AVOID={"Smoking":1,"Unnecessary":1,"Drinks":1};
var SKIP="Skipped";  /* "忍住没买" records live in Expenses with this category; never counted as spending */
/* spending = real expenses + repayments of "I owe" debts flagged as counting (derived, read-only rows) */
function spent(){
  var by=debts().by,out=[];
  S.expenses.forEach(function(x){
    if(x.cat===SKIP||x.cat.indexOf("Debt:")===0||x.cat.indexOf("Recur:")===0||x.cat.indexOf("Goal:")===0||x.cat.indexOf("Must:")===0||x.cat.indexOf("Pay:")===0||x.cat.indexOf("Acct:")===0)return;
    if(x.cat.indexOf("DebtPay:")===0){var pr=payRef(x.cat),d=pr&&by[pr.id];if(d&&d.dir==="owe"&&d.spend)out.push({id:x.id,date:x.date,item:tl("还款：{0}",d.name),cat:"还款",amt:x.amt,ro:true});return}
    out.push(x);
  });
  return out;
}
var ICON_EDIT='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>';

function setBud(k,v){S.set["bud_"+k]=v>0?v:0;S.setDirty=true;queue();syncUI();homeView();if(cur==="sum")sumView()}
function budSetView(force){
  if(document.activeElement!==$("bt"))$("bt").value=S.set.bud_TOTAL>0?S.set.bud_TOTAL:"";
  if(document.activeElement!==$("ba"))$("ba").value=S.set.bud_AVOID>0?S.set.bud_AVOID:"";
  if(!force&&$("bcl").contains(document.activeElement))return;
  $("bcl").innerHTML=budKeys().map(function(k){return k.slice(4)}).filter(function(c){return c!=="TOTAL"&&c!=="AVOID"}).map(function(c){
    return '<div class="brow"><span class="n">'+esc(c)+'</span><input type="number" inputmode="decimal" step="1" min="0" data-bc="'+esc(c)+'" value="'+S.set["bud_"+c]+'"><button class="x" data-bcdel="'+esc(c)+'" aria-label="移除">×</button></div>';
  }).join("");
}
$("bt").addEventListener("input",function(){setBud("TOTAL",parseFloat(this.value))});
$("ba").addEventListener("input",function(){setBud("AVOID",parseFloat(this.value))});
$("bcl").addEventListener("input",function(e){var c=e.target.getAttribute("data-bc");if(c)setBud(c,parseFloat(e.target.value))});
$("bcl").addEventListener("click",function(e){var c=e.target.getAttribute("data-bcdel");if(c){setBud(c,0);budSetView(true)}});
$("bca").addEventListener("click",function(){var v=parseFloat($("bcv").value);if(!(v>0))return;setBud($("bcs").value,v);$("bcv").value="";budSetView(true)});
function fillSettings(){
  if(document.activeElement!==$("si"))$("si").value=S.set.infl;
  payInputs();payListView();
  budSetView();
}
/* ---- maths: monthly compounding, deposits at month end ---- */
function perMonth(freq){return freq==="day"?365/12:freq==="week"?52/12:freq==="month"?1:0}
function fv(amount,freq,rate,years){
  var n=Math.round(years*12),i=rate/100/12,lump=0,m=0;
  if(freq==="once")lump=amount;else m=amount*perMonth(freq);
  var g=Math.pow(1+i,n);
  var a=lump*g+(i>0?m*(g-1)/i:m*n);
  return {fv:a,principal:lump+m*n};
}
function pv(x,years){return x/Math.pow(1+(+S.set.infl||0)/100,years)}

/* ---- log ---- */
function months(){
  var s={};spent().forEach(function(x){s[x.date.slice(0,7)]=1});s[today().slice(0,7)]=1;
  return Object.keys(s).sort().reverse();
}
function fillMonths(sel,keep){
  var cur=keep||sel.value,ms=months();
  sel.innerHTML=ms.map(function(m){return '<option value="'+m+'">'+m+'</option>'}).join("");
  sel.value=ms.indexOf(cur)>=0?cur:ms[0];
}
var LIMIT=200,shown=LIMIT;
function listView(){
  var cm0=today().slice(0,7),n0=spent().filter(function(x){return x.date.slice(0,7)===cm0}).length;
  $("openHist").textContent=n0?tl("明细 · {0} 笔",n0):"明细";$("openHist").title=n0?tl("本月 {0} 笔",n0):"";
  debtAlertView();weekBannerView();freeMiniView();homeView();
  var cur=$("lm").value;
  fillMonths($("lm"));
  $("lm").insertAdjacentHTML("afterbegin",'<option value="all">全部月份</option>');
  $("lm").value=cur==="all"||$("lm").querySelector('option[value="'+cur+'"]')?cur:$("lm").options[1].value;
  renderList();
}
function filterState(){return {m:$("lm").value,q:$("fq").value.trim().toLowerCase(),cat:$("fcat").value,min:parseFloat($("fmin").value),max:parseFloat($("fmax").value),sort:$("fsort").value}}
function filtered(f){
  var rows=spent();
  if(f.m!=="all")rows=rows.filter(function(x){return x.date.slice(0,7)===f.m});
  var toks=f.q?f.q.split(/\s+/):[];
  rows=rows.filter(function(x){
    if(f.cat&&x.cat!==f.cat)return false;
    if(f.min>=0&&x.amt<f.min)return false;
    if(f.max>=0&&x.amt>f.max)return false;
    if(toks.length){var hay=(x.item+" "+x.cat+" "+x.amt.toFixed(2)+" "+x.amt+" "+x.date).toLowerCase();for(var k=0;k<toks.length;k++)if(hay.indexOf(toks[k])<0)return false}
    return true;
  });
  var by={new:function(a,b){return a.date<b.date?1:a.date>b.date?-1:b.id-a.id},old:function(a,b){return a.date<b.date?-1:a.date>b.date?1:a.id-b.id},big:function(a,b){return b.amt-a.amt||(a.date<b.date?1:-1)},small:function(a,b){return a.amt-b.amt||(a.date<b.date?1:-1)}};
  return rows.sort(by[f.sort]||by.new);
}
function renderList(){
  var f=filterState(),scope=spent().filter(function(x){return f.m==="all"||x.date.slice(0,7)===f.m}),cats={};
  scope.forEach(function(x){cats[x.cat]=1});
  var keep=$("fcat").value;
  $("fcat").innerHTML='<option value="">全部分类</option>'+Object.keys(cats).sort().map(function(c){return '<option>'+esc(c)+'</option>'}).join("");
  if(cats[keep])$("fcat").value=keep;f=filterState();
  var rows=filtered(f),active=!!(f.q||f.cat||f.min>=0||f.max>=0),all=f.m==="all";
  $("fsum").hidden=!(active||all);
  var tot=0;rows.forEach(function(x){tot+=x.amt});
  $("fsumText").textContent=(active||all)?((all?"全部月份 · ":"")+tl(active?"找到 {0} 笔 · 合计 {1}":"共 {0} 笔 · 合计 {1}",rows.length,rm(tot))):"";
  $("fclear").hidden=!active;
  if(!rows.length){$("list").innerHTML='<div class="empty">'+(active?"没有符合的记录":"这个月还没有记录")+'</div>';$("fmoreBtn").hidden=true;return}
  var part=rows.slice(0,shown);
  $("fmoreBtn").hidden=rows.length<=shown;$("fmoreBtn").textContent=tl("显示更多（还有 {0} 笔）",rows.length-shown);
  $("list").innerHTML=part.map(function(x){
    var av=AVOID[x.cat];
    return '<div class="item'+(all?' all':'')+'"><div class="d">'+(all?x.date.slice(2):x.date.slice(5))+'</div><div class="m"><b>'+esc(x.item)+'</b><span class="tag'+(av?' av':'')+'">'+esc(x.cat)+'</span></div>'+
      '<div class="amt">'+rm(x.amt)+'</div>'+
      (x.ro?'':(av?'<button class="btn ghost small" data-think="'+x.id+'" title="如果没买">算</button>':'')+
      '<button class="x" data-edit="'+x.id+'" aria-label="修改" title="修改">'+ICON_EDIT+'</button>'+
      '<button class="x" data-del="'+x.id+'" aria-label="删除">×</button>')+'</div>';
  }).join("");
}
["fq","fmin","fmax"].forEach(function(id){$(id).addEventListener("input",function(){shown=LIMIT;renderList()})});
["fcat","fsort"].forEach(function(id){$(id).addEventListener("change",function(){shown=LIMIT;renderList()})});
$("fmoreBtn").addEventListener("click",function(){shown+=LIMIT;renderList()});
$("fclear").addEventListener("click",function(){$("fq").value="";$("fcat").value="";$("fmin").value="";$("fmax").value="";shown=LIMIT;renderList()});
$("list").addEventListener("click",function(e){
  var d=e.target.getAttribute("data-del"),t=e.target.getAttribute("data-think"),ed=e.target.getAttribute("data-edit");
  if(ed){var r=S.expenses.filter(function(y){return String(y.id)===ed})[0];if(r)startEdit(r)}
  if(d){if(editId===d)endEdit();S.expenses=S.expenses.filter(function(x){return String(x.id)!==d});queue({op:"del",id:+d});listView();syncUI();}
  if(t){var x=S.expenses.filter(function(y){return String(y.id)===t})[0];if(x){$("ta").value=x.amt;$("tf").value="once";closeAllSheets();tab("think");}}
});
$("lm").addEventListener("change",function(){shown=LIMIT;listView()});
/* ---- budgets: settings bud_TOTAL / bud_AVOID / bud_<Category> (monthly, RM) ---- */
function budKeys(){return Object.keys(S.set).filter(function(k){return k.indexOf("bud_")===0&&+S.set[k]>0})}
function budState(pct){return pct>100?"over":pct>=80?"near":"ok"}
function budgetRows(m,extra,skipId){  /* extra = {cat,amt}: what-if this amount is added to month m; skipId = record being edited */
  var d=monthData(m,skipId),tot=d.tot,av=d.av,bc=d.bc,rows=[];
  if(extra){tot+=extra.amt;if(AVOID[extra.cat])av+=extra.amt;bc=JSON.parse(JSON.stringify(bc));bc[extra.cat]=(bc[extra.cat]||0)+extra.amt}
  if(+S.set.bud_TOTAL>0)rows.push({key:"TOTAL",label:"总支出",used:tot,b:+S.set.bud_TOTAL});
  if(+S.set.bud_AVOID>0)rows.push({key:"AVOID",label:"不必要合计",used:av,b:+S.set.bud_AVOID});
  budKeys().forEach(function(k){var c=k.slice(4);if(c==="TOTAL"||c==="AVOID")return;rows.push({key:c,label:c,used:bc[c]||0,b:+S.set[k]})});
  rows.forEach(function(r){r.pct=r.used/r.b*100;r.state=budState(r.pct)});
  return rows;
}
function renderBudget(listEl,cardEl,rows){
  if(!rows.length){cardEl.hidden=true;return}
  cardEl.hidden=false;
  rows.sort(function(a,b){return b.pct-a.pct});
  listEl.innerHTML=rows.map(function(r){
    var left=r.b-r.used,st=r.state==="over"?tl("超支 {0}",rm0(-left)):r.state==="near"?tl("快用完，还剩 {0}",rm0(left)):tl("还剩 {0}",rm0(left));
    return '<div class="bud"><div class="t"><span>'+esc(r.label)+'</span><span class="amt">'+rm0(r.used)+' / '+rm0(r.b)+'</span></div><div class="bar"><i class="'+r.state+'" style="width:'+Math.min(100,r.pct)+'%"></i></div><div class="s"><span class="st '+r.state+'">'+st+'</span><span class="st '+r.state+'">'+Math.round(r.pct)+'%</span></div></div>';
  }).join("");
}

function budgetWarnText(rows){
  return rows.map(function(r){return tl(r.state==="over"?"⚠️ 超预算：{0} 本月会到 {1} / {2}（{3}%）":"⚠️ 快到预算：{0} 本月会到 {1} / {2}（{3}%）",r.label,rm0(r.used),rm0(r.b),Math.round(r.pct))}).join("\n");
}
function budgetWarnHtml(rows){
  return rows.map(function(r){return tl(r.state==="over"?"⚠️ 超预算：{0} 本月会到 <b>{1} / {2}（{3}%）</b>":"⚠️ 快到预算：{0} 本月会到 <b>{1} / {2}（{3}%）</b>",esc(r.label),rm0(r.used),rm0(r.b),Math.round(r.pct))}).join("<br>");
}
function hint(){
  var a=parseFloat($("fa").value),c=$("fc").value,h=$("liveHint"),parts=[],bad=false;
  if(!(a>0)){h.hidden=true;return}
  if(AVOID[c]){
    var r=fv(a,"once",S.set.rate,10);
    parts.push(tl('先停一下：这 <b>{0}</b> 如果存起来，按 {1}% 放 10 年 ≈ <b>{2}</b>（扣通膨后约 {3}）。若是每天都这样买，看「先别买」。',rm(a),S.set.rate,rm(r.fv),rm(pv(r.fv,10))));
  }
  var m=($("fd").value||today()).slice(0,7);
  var rows=budgetRows(m,{cat:c,amt:a},editId).filter(function(x){return x.state!=="ok"&&(x.key==="TOTAL"||x.key===c||(x.key==="AVOID"&&AVOID[c]))});
  if(rows.length){parts.push(budgetWarnHtml(rows));bad=rows.some(function(x){return x.state==="over"})}
  if(!parts.length){h.hidden=true;return}
  h.hidden=false;h.className="hint"+(bad?" bad":"");h.innerHTML=parts.join("<br>");
}
$("fa").addEventListener("input",hint);$("fc").addEventListener("change",hint);
var editId=null;
function startEdit(r){
  editId=String(r.id);$("shEntryTitle").textContent="修改这一笔";
  $("fd").value=r.date;$("fa").value=r.amt;$("fi").value=r.item;
  if(![].some.call($("fc").options,function(o){return o.value===r.cat}))$("fc").appendChild(new Option(r.cat,r.cat));
  $("fc").value=r.cat;
  $("add").textContent="保存修改";$("cancelEdit").hidden=false;$("skip").hidden=true;$("keepRow").hidden=true;$("addMsg").textContent="正在修改这一笔";
  hint();openSheet("Entry");
}
function endEdit(){
  editId=null;$("shEntryTitle").textContent="记一笔";$("add").textContent="记下来";$("cancelEdit").hidden=true;$("skip").hidden=false;$("keepRow").hidden=false;
  $("fa").value="";$("fi").value="";$("fd").value=today();$("liveHint").hidden=true;$("addMsg").textContent="";
}
try{$("keepOpen").checked=localStorage.getItem("pocketledger.keep")==="1"}catch(e){}
$("keepOpen").addEventListener("change",function(){try{localStorage.setItem("pocketledger.keep",this.checked?"1":"0")}catch(e){}});
$("cancelEdit").addEventListener("click",function(){endEdit();closeSheet("Entry")});
$("openEntry").addEventListener("click",function(){if(editId!==null)endEdit();openSheet("Entry",this)});
$("openHist").addEventListener("click",function(){openSheet("Hist",this);renderList()});
$("add").addEventListener("click",function(){
  var a=parseFloat($("fa").value),it=$("fi").value.trim(),d=$("fd").value||today();
  if(!(a>0)||!it){$("addMsg").textContent="请填金额和项目";return}
  var editing=editId!==null;
  var rec={id:editing?+editId:Date.now(),date:d,item:it,cat:$("fc").value,amt:Math.round(a*100)/100};
  if(editing)S.expenses=S.expenses.filter(function(x){return String(x.id)!==editId});
  S.expenses.push(rec);queue({op:"add",row:rec});syncUI();
  if(editing)endEdit();
  $("fa").value="";$("fi").value="";$("liveHint").hidden=true;$("addMsg").textContent="";
  $("lm").value=d.slice(0,7);listView();
  var w=budgetRows(d.slice(0,7)).filter(function(r){return r.state!=="ok"&&(r.key==="TOTAL"||r.key===rec.cat||(r.key==="AVOID"&&AVOID[rec.cat]))});
  if(!editing&&$("keepOpen").checked){$("fd").value=d;$("fa").focus()}else closeSheet("Entry");
  toast(editing?"修改成功":"记账成功",rec.cat+" · "+rm(rec.amt),w.length?budgetWarnText(w):"",w.some(function(r){return r.state==="over"}));
});

$("skip").addEventListener("click",function(){
  var a=parseFloat($("fa").value),it=$("fi").value.trim()||"没买",d=$("fd").value||today();
  if(!(a>0)){$("addMsg").textContent="请先填金额（你忍住没花的那笔）";return}
  var rec={id:Date.now(),date:d,item:it,cat:SKIP,amt:Math.round(a*100)/100};
  S.expenses.push(rec);queue({op:"add",row:rec});syncUI();
  $("fa").value="";$("fi").value="";$("liveHint").hidden=true;
  $("addMsg").textContent="";
  var tot=0,n=0;S.expenses.forEach(function(x){if(x.cat===SKIP){tot+=x.amt;n++}});
  var gb=goalProgress(tot-rec.amt),ga=goalProgress(tot),hit=ga.filter(function(g,i){return g.done&&!gb[i].done}),nxt=ga.filter(function(g){return !g.done})[0],line="";
  if(hit.length)line=tl("🎯 目标达成：{0}！",hit.map(function(g){return esc(g.name)}).join(tl("、")));
  else if(nxt)line=tl("距离「{0}」还差 {1}（已完成 {2}%）",esc(nxt.name),rm0(nxt.target-nxt.saved),Math.floor(nxt.saved/nxt.target*100));
  closeSheet("Entry");
  celebrate(rec.amt,tot-rec.amt,tot,n,line,hit.length>0);
});

/* ---- saved (忍住没买) ---- */
function monthsBetween(dateStr){
  var d=new Date(dateStr+"T00:00:00"),days=(Date.now()-d.getTime())/864e5;
  return days>0?days/(365/12):0;
}
/* ---- goals funded by skipped purchases: row cat "Goal:0", item = name, amt = target, date = created ---- */
function goals(){
  var out=[];S.expenses.forEach(function(x){if(x.cat.indexOf("Goal:")===0)out.push({id:x.id,name:x.item,target:x.amt,created:x.date})});
  return out.sort(function(a,b){return a.id-b.id});
}
function goalProgress(total){          /* fill goals in order with the running total of skipped money */
  var gs=goals(),used=0;
  gs.forEach(function(g){g.saved=Math.max(0,Math.min(g.target,total-used));g.done=g.saved>=g.target-0.005;used+=g.target;g.cum=used});
  return gs;
}
function skipTotal(){var t=0;S.expenses.forEach(function(x){if(x.cat===SKIP)t+=x.amt});return t}
function skipPerMonth(){               /* average over the last 90 days */
  var from=new Date(today()+"T00:00:00");from.setDate(from.getDate()-90);var t=0;
  S.expenses.forEach(function(x){if(x.cat===SKIP&&new Date(x.date+"T00:00:00")>=from)t+=x.amt});
  return t/3;
}
var goalEditId=null;
function goalView(){
  var T=skipTotal(),gs=goalProgress(T),rate=skipPerMonth();
  $("goalList").innerHTML=gs.length?gs.map(function(g){
    var pct=Math.min(100,g.saved/g.target*100),eta="";
    if(g.done)eta="已达成 🎉";
    else if(rate>0){var m=Math.ceil((g.cum-T)/rate);eta=tl("还差 {0}，按近 3 个月平均每月忍住 {1}，约 {2} 个月后达成",rm0(g.target-g.saved),rm0(rate),m)}
    else eta=tl("还差 {0}（最近 3 个月没有忍住的记录，无法估算时间）",rm0(g.target-g.saved));
    return '<div class="goalrow'+(g.done?' done':'')+'"><div class="t"><b>'+esc(g.name)+'</b><span class="amt">'+rm0(g.saved)+' / '+rm0(g.target)+'</span>'+
      '<button class="x" data-gedit="'+g.id+'" aria-label="修改">'+ICON_EDIT+'</button><button class="x" data-gdel="'+g.id+'" aria-label="删除">×</button></div>'+
      '<div class="bar"><i style="width:'+pct+'%"></i></div><div class="s">'+Math.floor(pct)+'% · '+eta+'</div></div>';
  }).join(""):'<div class="empty">设一个目标，让每次忍住都有意义</div>';
}
function goalForm(on,g){
  goalEditId=on?String(g.id):null;
  $("gtitle").textContent=on?"修改目标":"忍住的目标";$("gadd").textContent=on?"保存修改":"添加目标";$("gcancel").hidden=!on;
  $("gn").value=on?g.name:"";$("gt").value=on?g.target:"";$("gmsg").textContent="";
}
$("gcancel").addEventListener("click",function(){goalForm(false)});
$("gadd").addEventListener("click",function(){
  var name=$("gn").value.trim(),t=parseFloat($("gt").value);
  if(!name||!(t>0)){$("gmsg").textContent="请填目标名称和金额";return}
  var editing=goalEditId!==null,old=editing?goals().filter(function(g){return String(g.id)===goalEditId})[0]:null;
  if(editing&&!old){goalForm(false);$("gmsg").textContent="这个目标已经不存在了";return}
  var rec={id:editing?old.id:Date.now(),date:editing?old.created:today(),item:name,cat:"Goal:0",amt:r2(t)};
  S.expenses=S.expenses.filter(function(x){return x.id!==rec.id});S.expenses.push(rec);queue({op:"add",row:rec});syncUI();
  goalForm(false);goalView();toast(editing?"目标已修改":"目标已添加",name+" · "+rm0(rec.amt));
});
$("goalList").addEventListener("click",function(e){
  var b=e.target.closest&&e.target.closest("button");if(!b)return;
  var ed=b.getAttribute("data-gedit"),del=b.getAttribute("data-gdel");
  if(ed){var g=goals().filter(function(x){return String(x.id)===ed})[0];if(g){goalForm(true,g);}}
  else if(del){
    if(b.getAttribute("data-sure")!=="1"){b.setAttribute("data-sure","1");b.textContent="再按确认";setTimeout(function(){if(b.isConnected){b.removeAttribute("data-sure");b.innerHTML="×"}},3000);return}
    if(goalEditId===del)goalForm(false);
    S.expenses=S.expenses.filter(function(x){return String(x.id)!==del});queue({op:"del",id:+del});syncUI();goalView();
  }
});

function saveView(){
  goalView();
  var rows=S.expenses.filter(function(x){return x.cat===SKIP}).sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:b.id-a.id});
  var tot=0,now=0,thisM=0,i=(+S.set.rate||0)/100/12,cm=today().slice(0,7);
  rows.forEach(function(x){tot+=x.amt;now+=x.amt*Math.pow(1+i,monthsBetween(x.date));if(x.date.slice(0,7)===cm)thisM+=x.amt});
  $("sTotal").textContent=rm(tot);
  $("sCount").textContent=rows.length?tl("忍住了 {0} 次",rows.length):"还没有记录";
  $("sstat").innerHTML='<div><small>本月</small><strong>'+rm0(thisM)+'</strong></div><div><small>存起来现在值</small><strong>'+rm0(now)+'</strong></div><div><small>平均每次</small><strong>'+(rows.length?rm0(tot/rows.length):"—")+'</strong></div>';
  var b=$("sNote");
  if(tot>0){var f=now*Math.pow(1+i,120);b.hidden=false;
    b.innerHTML=tl('如果这些钱真的存起来（{0}%），现在约 <b>{1}</b>；再放 10 年 ≈ <b>{2}</b>，今天的购买力约 {3}。',S.set.rate,rm0(now),rm0(f),rm0(pv(f,10)))}
  else b.hidden=true;
  $("slist").innerHTML=rows.length?rows.map(function(x){
    return '<div class="item"><div class="d">'+x.date.slice(5)+'</div><div class="m"><b>'+esc(x.item)+'</b><span class="tag sk">忍住了</span></div><div class="amt">'+rm(x.amt)+'</div><button class="x" data-sdel="'+x.id+'" aria-label="删除">×</button></div>';
  }).join(""):'<div class="empty">想买但忍住了？到「记账」填金额，点「我忍住了」</div>';
}
$("slist").addEventListener("click",function(e){
  var d=e.target.getAttribute("data-sdel");
  if(d){S.expenses=S.expenses.filter(function(x){return String(x.id)!==d});queue({op:"del",id:+d});saveView();syncUI();}
});

/* ---- debts (欠款) ----
   Stored as Expenses rows, so sync / offline queue / backup all work unchanged:
   debt    cat "Debt:<owe|lent>:<1|0 counts as spending>:<due YYYY-MM-DD or ->[:<CUR>[:<reference rate>]]"
           item = name, amt = principal in CUR (RM when CUR is omitted), date = start
   payment cat "DebtPay:<debtId>[:<rate>]", item = note, date = payment date,
           amt = what you paid in RM; for a foreign debt rate = CUR per 1 RM and the debt shrinks by amt * rate */
var DEBT_RE=/^Debt:(owe|lent):([01]):(\d{4}-\d{2}-\d{2}|-)(?::([A-Z]{3})(?::(\d+(?:\.\d+)?))?)?(?:@(\d+))?$/;
var PAY_RE=/^DebtPay:(\d+)(?::(\d+(?:\.\d+)?))?$/;
var CURS=["MYR","NTD","SGD","USD"];
var openDebts={};
function payRef(cat){var m=PAY_RE.exec(cat);return m?{id:m[1],rate:m[2]?+m[2]:0}:null}
function r2(n){return Math.round(n*100)/100}
function cm(cur,n){return cur==="MYR"?rm(n):cur+" "+Number(n).toLocaleString("en-MY",{minimumFractionDigits:0,maximumFractionDigits:2})}
function daysUntil(due){return Math.round((new Date(due+"T00:00:00")-new Date(today()+"T00:00:00"))/864e5)}
function debts(){
  var list=[],by={};
  S.expenses.forEach(function(x){var m=DEBT_RE.exec(x.cat);if(m){var d={id:x.id,name:x.item,dir:m[1],spend:m[2]==="1",due:m[3]==="-"?"":m[3],cur:m[4]||"MYR",refRate:m[5]?+m[5]:0,acct:m[6]||"",start:x.date,principal:x.amt,pays:[],paid:0};list.push(d);by[String(x.id)]=d}});
  S.expenses.forEach(function(x){if(x.cat.indexOf("DebtPay:")===0){var pr=payRef(x.cat),d=pr&&by[pr.id];if(d){
    var native=d.cur==="MYR"?x.amt:r2(x.amt*pr.rate);
    d.pays.push({id:x.id,date:x.date,item:x.item,rm:x.amt,rate:pr.rate,native:native});d.paid+=native}}});
  list.forEach(function(d){
    d.pays.sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:a.id-b.id});
    d.left=Math.max(0,r2(d.principal-d.paid));d.settled=d.left<0.005;d.days=d.due?daysUntil(d.due):null;
    var last=d.pays.filter(function(q){return q.rate>0}).pop();
    d.rate=d.cur==="MYR"?0:(last?last.rate:d.refRate);              /* CUR per 1 RM, for RM estimates only */
    d.leftRM=d.cur==="MYR"?d.left:(d.rate>0?r2(d.left/d.rate):null);
  });
  list.by=by;return list;
}
function debtStatus(d){
  if(d.settled)return {t:"已结清",c:"ok"};
  if(d.days===null)return {t:"没有到期日",c:"ok"};
  if(d.days<0)return {t:tl("逾期 {0} 天",-d.days),c:"over"};
  if(d.days===0)return {t:"今天到期",c:"near"};
  if(d.days<=7)return {t:tl("{0} 天后到期",d.days),c:"near"};
  return {t:tl("到期 {0}",d.due),c:"ok"};
}
function debtAlertView(){
  var due=debts().filter(function(d){return !d.settled&&d.days!==null&&d.days<=7}).sort(function(a,b){return a.days-b.days});
  $("debtAlert").hidden=!due.length;
  $("debtAlertList").innerHTML=due.slice(0,3).map(function(d){
    var st=debtStatus(d);
    return '<div class="cmp"><span class="n">'+tl(d.dir==="owe"?"我欠 {0}":"欠我 {0}",esc(d.name))+'</span><span class="v">'+(d.cur==="MYR"?rm0(d.left):cm(d.cur,d.left))+'<small class="st '+st.c+'">'+st.t+'</small></span></div>';
  }).join("")+(due.length>3?'<div class="msg" style="margin:4px 0 0">'+tl("还有 {0} 笔也快到期，点下面看全部",due.length-3)+'</div>':"");
}
$("debtGo").addEventListener("click",function(){tab("debt")});
function debtItem(d){
  var st=debtStatus(d),owe=d.dir==="owe",fx=d.cur!=="MYR",pct=d.principal>0?Math.min(100,d.paid/d.principal*100):100;
  var pays=d.pays.map(function(q){
    return '<div class="prow"><span class="d">'+q.date+'</span><span class="n">'+esc(q.item)+(fx?'<small class="msg"> '+rm(q.rm)+' × '+q.rate+' = '+cm(d.cur,q.native)+'</small>':'')+'</span><span class="amt">'+(fx?cm(d.cur,q.native):rm(q.rm))+'</span><button class="x" data-pdel="'+q.id+'" aria-label="删除这笔">×</button></div>';
  }).join("");
  var inputs='<div><label>'+(fx?'付了多少 RM':'金额 (RM)')+'</label><input type="number" inputmode="decimal" step="0.01" min="0" data-pamt placeholder="0.00"></div>'+
    (fx?'<div><label>'+tl("汇率（1 RM = ? {0}）",d.cur)+'</label><input type="number" inputmode="decimal" step="0.0001" min="0" data-prate value="'+(d.rate||"")+'" placeholder="例如 7.89"></div>':'')+
    '<div'+(fx?' class="full"':'')+'><label>日期</label><input type="date" data-pdate value="'+today()+'"></div>';
  return '<details class="debt" data-did="'+d.id+'"'+(openDebts[d.id]?" open":"")+'><summary><div class="m"><b>'+esc(d.name)+'</b><span class="st '+st.c+'">'+st.t+'</span></div><div class="amt">'+(d.settled?cm(d.cur,d.principal):cm(d.cur,d.left))+(fx&&!d.settled&&d.leftRM!==null?'<small class="msg" style="display:block;text-align:right;margin:0">≈ '+rm0(d.leftRM)+'</small>':'')+'</div></summary>'+
    '<div class="bar"><i style="width:'+pct+'%"></i></div>'+
    '<p class="msg">'+tl("本金 {0} · {1} {2} · 开始 {3}",cm(d.cur,d.principal),owe?"已还":"已收",cm(d.cur,d.paid),d.start)+(d.due?tl(" · 到期 {0}",d.due):'')+(owe&&d.spend?tl(" · 还款计入支出"):'')+(fx?tl(" · 估算 RM 用最近一次汇率"):'')+'</p>'+
    pays+
    (d.settled?'':'<div class="grid" style="margin-top:10px">'+inputs+'</div><div class="msg" data-ppreview></div>'+
      '<button class="btn small" data-pay="'+d.id+'" style="margin-top:10px">'+(owe?"记一笔还款":"记一笔收款")+'</button><div class="msg" data-pmsg></div>')+
    '<div class="row" style="margin-top:10px"><button class="btn ghost small" data-dedit="'+d.id+'">修改</button><button class="btn ghost small" data-ddel="'+d.id+'">删除这笔欠款</button></div></details>';
}
function debtSection(title,list){
  if(!list.length)return '<div class="card"><h2>'+title+'</h2><div class="empty">没有记录</div></div>';
  var act=list.filter(function(d){return !d.settled}).sort(function(a,b){return (a.days===null?1e9:a.days)-(b.days===null?1e9:b.days)});
  var done=list.filter(function(d){return d.settled});
  return '<div class="card"><h2>'+title+'</h2>'+act.map(debtItem).join("")+(done.length?'<h2 style="margin-top:18px">已结清</h2>'+done.map(debtItem).join(""):"")+'</div>';
}
function debtView(){
  var ae=document.activeElement;
  if(ae&&(ae.tagName==="INPUT"||ae.tagName==="SELECT")&&($("dlist").contains(ae)||$("acctList").contains(ae)))return;   /* never wipe what is being typed */
  var all=debts(),owe=all.filter(function(d){return d.dir==="owe"&&!d.acct}),lent=all.filter(function(d){return d.dir==="lent"});
  var tile=function(l){
    var rmSum=0,fx={};
    l.forEach(function(d){if(d.settled)return;if(d.cur==="MYR")rmSum+=d.left;else fx[d.cur]=(fx[d.cur]||0)+d.left});
    return rm0(rmSum)+Object.keys(fx).map(function(c){return '<small style="display:block;color:var(--muted)">+ '+cm(c,fx[c])+'</small>'}).join("");
  };
  var over=all.filter(function(d){return !d.settled&&d.days!==null&&d.days<0}).length;
  owe=all.filter(function(d){return d.dir==="owe"});                  /* the totals also include statements that live in a credit account */
  $("dstat").innerHTML='<div><small>我欠（剩余）</small><strong class="warnv">'+tile(owe)+'</strong></div><div><small>欠我（剩余）</small><strong>'+tile(lent)+'</strong></div><div><small>逾期</small><strong class="'+(over?"warnv":"")+'">'+tl("{0} 笔",over)+'</strong></div>';
  $("dlist").innerHTML=debtSection("我欠别人的",all.filter(function(d){return d.dir==="owe"&&!d.acct}))+debtSection("别人欠我的",lent);
  acctView();
}
function recordPay(d,a,dt,rate){
  var fx=d.cur!=="MYR",native=fx?r2(a*rate):a,note="";
  if(native>d.left+0.004){native=d.left;a=fx?r2(native/rate):d.left;note=tl("（超过剩余，已按剩余记录：RM {0}）",a.toFixed(2))}
  var rec={id:Date.now(),date:dt,item:d.dir==="owe"?"还款":"收款",cat:"DebtPay:"+d.id+(fx?":"+rate:""),amt:r2(a)};
  S.expenses.push(rec);queue({op:"add",row:rec});
  return {rec:rec,note:note};
}
function debtDel(ids){S.expenses=S.expenses.filter(function(x){return ids.indexOf(String(x.id))<0});ids.forEach(function(id){S.pending.push({op:"del",id:+id})});queue()}
$("dlist").addEventListener("toggle",function(e){var id=e.target.getAttribute&&e.target.getAttribute("data-did");if(id)openDebts[id]=e.target.open},true);
$("dlist").addEventListener("input",function(e){   /* live conversion preview for foreign debts */
  var det=e.target.closest&&e.target.closest("details.debt");if(!det)return;
  var a=parseFloat((det.querySelector("[data-pamt]")||{}).value),r=parseFloat((det.querySelector("[data-prate]")||{}).value),pv=det.querySelector("[data-ppreview]"),d=debts().by[det.getAttribute("data-did")];
  if(pv&&d&&d.cur!=="MYR")pv.textContent=(a>0&&r>0)?tl("折合 {0}，还完后剩 {1}",cm(d.cur,r2(a*r)),cm(d.cur,Math.max(0,r2(d.left-a*r)))):"";
});
$("dlist").addEventListener("click",function(e){
  var b=e.target.closest&&e.target.closest("button");if(!b)return;
  var pay=b.getAttribute("data-pay"),pdel=b.getAttribute("data-pdel"),ddel=b.getAttribute("data-ddel"),dedit=b.getAttribute("data-dedit");
  if(dedit){var dd0=debts().by[dedit];if(dd0)startDebtEdit(dd0);return}
  if(pay){
    var det=b.closest("details"),d=debts().by[pay],msg=det.querySelector("[data-pmsg]");
    if(!d)return;
    var fx=d.cur!=="MYR",a=parseFloat(det.querySelector("[data-pamt]").value),dt=det.querySelector("[data-pdate]").value||today();
    var rate=fx?parseFloat(det.querySelector("[data-prate]").value):0;
    if(!(a>0)){msg.textContent="请填金额";return}
    if(fx&&!(rate>0)){msg.textContent=tl("请填汇率（1 RM = 多少 {0}）",d.cur);return}
    var pr=recordPay(d,a,dt,rate),rec=pr.rec,note=pr.note;
    syncUI();debtView();
    var m2=document.querySelector('[data-did="'+pay+'"] [data-pmsg]');if(m2)m2.textContent=tl("已记录 ✓")+note;
    toast(d.dir==="owe"?"还款已记录":"收款已记录",rm(rec.amt)+(debts().by[pay]&&debts().by[pay].settled?" · 已结清 🎉":""));
  }else if(pdel){S.expenses=S.expenses.filter(function(x){return String(x.id)!==pdel});queue({op:"del",id:+pdel});syncUI();debtView()}
  else if(ddel){
    if(b.getAttribute("data-sure")!=="1"){b.setAttribute("data-sure","1");b.textContent="再按一次确认删除（连同还款记录）";setTimeout(function(){if(b.isConnected){b.removeAttribute("data-sure");b.textContent="删除这笔欠款"}},3000);return}
    var ids=[ddel].concat(S.expenses.filter(function(x){var pr=payRef(x.cat);return pr&&pr.id===ddel}).map(function(x){return String(x.id)}));
    delete openDebts[ddel];if(debtEditId===ddel)endDebtEdit();debtDel(ids);syncUI();debtView();
  }
});
function debtFormMode(){
  var dir=$("dd").value,cur=$("dc").value,fx=cur!=="MYR";
  $("dspRow").hidden=dir!=="owe";$("drRow").hidden=!fx;
  $("daLbl").textContent=tl("金额 ({0})",cur);
}
$("dd").addEventListener("change",debtFormMode);$("dc").addEventListener("change",debtFormMode);
var debtEditId=null;   /* editing keeps the id, so payments stay attached; direction and currency are fixed */
function startDebtEdit(d){
  debtEditId=String(d.id);
  $("dd").value=d.dir;$("dc").value=d.cur;$("dd").disabled=true;$("dc").disabled=true;
  $("dn").value=d.name;$("da").value=d.principal;$("ds").value=d.start;$("du").value=d.due;$("dr").value=d.refRate||"";$("dsp").checked=d.spend;
  debtFormMode();
  $("dtitle").textContent="修改欠款";$("dadd").textContent="保存修改";$("dcancel").hidden=false;
  $("dmsg").textContent="类型和币种不能改（要改请删除后重新添加）；已有的还款记录会保留";
  openPop("dformCard");
}
function endDebtEdit(){
  debtEditId=null;$("dd").disabled=false;$("dc").disabled=false;
  $("dn").value="";$("da").value="";$("du").value="";$("dr").value="";$("ds").value=today();$("dsp").checked=true;
  $("dtitle").textContent="新增欠款";$("dadd").textContent="添加";$("dcancel").hidden=true;$("dmsg").textContent="";
  debtFormMode();
}
$("dcancel").addEventListener("click",function(){endDebtEdit();closePop("dformCard")});
$("dadd").addEventListener("click",function(){
  var dir=$("dd").value,cur=$("dc").value,name=$("dn").value.trim(),a=parseFloat($("da").value),st=$("ds").value||today(),du=$("du").value,rt=parseFloat($("dr").value);
  if(!name||!(a>0)){$("dmsg").textContent="请填名称和金额";return}
  var editing=debtEditId!==null;
  if(editing&&!debts().by[debtEditId]){endDebtEdit();$("dmsg").textContent="这笔欠款已经不存在了";return}
  var cat="Debt:"+dir+":"+(dir==="owe"&&$("dsp").checked?"1":"0")+":"+(du||"-")+(cur!=="MYR"?":"+cur+(rt>0?":"+rt:""):"");
  var rec={id:editing?+debtEditId:Date.now(),date:st,item:name,cat:cat,amt:r2(a)};
  if(editing)S.expenses=S.expenses.filter(function(x){return String(x.id)!==debtEditId});
  S.expenses.push(rec);queue({op:"add",row:rec});syncUI();
  if(editing)endDebtEdit();else{$("dn").value="";$("da").value="";$("du").value="";$("dr").value=""}
  $("dmsg").textContent=editing?"已修改 ✓":"已添加 ✓";
  setTimeout(function(){$("dmsg").textContent=""},1800);
  closePop("dformCard");
  toast(editing?"欠款已修改":"欠款已添加",name+" · "+(cur==="MYR"?rm(r2(a)):cur+" "+r2(a)));
  debtView();
});

/* ---- recurring monthly expenses (每月固定支出) ----
   template row (hidden from spending): cat "Recur:<day>:<category>:<last generated YYYY-MM or ->:<1 active|0 paused>",
                item = name, amt = amount, date = first day of the start month
   generated expense: an ordinary expense with a deterministic id (template id + month), so two devices that
   both generate the same month produce the same record. Ids stay below 1e15 (Google Sheets keeps 15 digits). */
var RECUR_RE=/^Recur:(\d{1,2}):([^:]+):(\d{4}-\d{2}|-):([01])$/;
function p2(n){return (n<10?"0":"")+n}
function monthIdx(ym){return (+ym.slice(0,4)-2020)*12+(+ym.slice(5,7))-1}
function idxToYm(i){return (2020+Math.floor(i/12))+"-"+p2(i%12+1)}
function daysInMonth(ym){return new Date(+ym.slice(0,4),+ym.slice(5,7),0).getDate()}
function recurId(tid,idx){return 2e14+Math.max(0,tid-1.7e12)*1000+idx}
function recurCat(t,last,active){return "Recur:"+t.day+":"+t.cat+":"+(last||"-")+":"+(active?1:0)}
function recurs(){
  var out=[];
  S.expenses.forEach(function(x){var m=RECUR_RE.exec(x.cat);if(m)out.push({id:x.id,name:x.item,amt:x.amt,day:+m[1],cat:m[2],last:m[3]==="-"?"":m[3],active:m[4]==="1",start:x.date.slice(0,7)})});
  return out;
}
function recurNext(t){
  var i=t.last?monthIdx(t.last)+1:monthIdx(t.start),ym=idxToYm(i);
  return ym+"-"+p2(Math.min(t.day,daysInMonth(ym)));
}
function recurTick(){
  var now=today(),nowIdx=monthIdx(now.slice(0,7)),dNow=+now.slice(8,10),made=0,have={};
  S.expenses.forEach(function(x){have[x.id]=1});
  recurs().forEach(function(t){
    if(!t.active)return;
    var startIdx=monthIdx(t.start),from=t.last?monthIdx(t.last)+1:startIdx;
    if(from<startIdx)from=startIdx;
    if(from<nowIdx-11)from=nowIdx-11;                      /* catch up at most 12 months */
    var done=-1;
    for(var i=from;i<=nowIdx;i++){
      var ym=idxToYm(i),day=Math.min(t.day,daysInMonth(ym));
      if(i===nowIdx&&dNow<day)break;                       /* not due yet this month */
      var id=recurId(t.id,i);
      if(!have[id]){var rec={id:id,date:ym+"-"+p2(day),item:t.name,cat:t.cat,amt:t.amt};S.expenses.push(rec);S.pending.push({op:"add",row:rec});have[id]=1;made++}
      done=i;
    }
    if(done>=0&&(!t.last||monthIdx(t.last)<done)){
      var tr={id:t.id,date:t.start+"-01",item:t.name,cat:recurCat(t,idxToYm(done),true),amt:t.amt};
      S.expenses=S.expenses.filter(function(x){return x.id!==t.id});S.expenses.push(tr);S.pending.push({op:"add",row:tr});
    }
  });
  if(made){queue();syncUI();toast(tl("已自动记账 {0} 笔固定支出",made),"每月固定支出");recurView();listView()}
  return made;
}
function recurView(){
  var ts=recurs().sort(function(a,b){return a.day-b.day||a.id-b.id}),tot=0;
  ts.forEach(function(t){if(t.active)tot+=t.amt});
  $("recList").innerHTML=ts.length?ts.map(function(t){
    return '<div class="rrow'+(t.active?'':' off')+'"><b>'+esc(t.name)+'</b><div class="amt">'+rm(t.amt)+'</div><div class="info"><span class="tag">'+esc(t.cat)+'</span> '+tl("每月 {0} 号 · {1}",t.day,t.active?tl("下次 {0}",recurNext(t)):"已暂停")+'</div><div class="acts">'+
      '<button class="x" data-rpause="'+t.id+'" aria-label="'+(t.active?"暂停":"恢复")+'" title="'+(t.active?"暂停":"恢复")+'">'+(t.active?"⏸":"▶")+'</button>'+
      '<button class="x" data-redit="'+t.id+'" aria-label="修改">'+ICON_EDIT+'</button>'+
      '<button class="x" data-rdel="'+t.id+'" aria-label="删除">×</button></div></div>';
  }).join(""):'<div class="empty">还没有固定支出</div>';
  $("recTotal").textContent=ts.length?tl("启用中的固定支出合计：每月 {0}",rm(tot)):"";
}
var recEditId=null;
function recForm(on,t){
  recEditId=on?String(t.id):null;
  $("rtitle").textContent=on?"修改固定支出":"每月固定支出";$("radd").textContent=on?"保存修改":"添加";$("rcancel").hidden=!on;$("rs").disabled=on;
  if(on){$("rn").value=t.name;$("ra").value=t.amt;$("rd").value=t.day;$("rc").value=t.cat;$("rs").value=t.start}
  else{$("rn").value="";$("ra").value="";$("rd").value=1;$("rs").value=idxToYm(monthIdx(today().slice(0,7))+1)}
  $("rmsg").textContent="";
}
$("rcancel").addEventListener("click",function(){recForm(false)});
$("radd").addEventListener("click",function(){
  var name=$("rn").value.trim(),a=parseFloat($("ra").value),d=parseInt($("rd").value,10),cat=$("rc").value,st=$("rs").value||idxToYm(monthIdx(today().slice(0,7))+1);
  if(!name||!(a>0)){$("rmsg").textContent="请填名称和金额";return}
  if(!(d>=1&&d<=31)){$("rmsg").textContent="每月几号请填 1 到 31";return}
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(st)){$("rmsg").textContent="开始月份格式请填 年-月，例如 2026-11";return}
  var editing=recEditId!==null,old=editing?recurs().filter(function(t){return String(t.id)===recEditId})[0]:null;
  if(editing&&!old){recForm(false);$("rmsg").textContent="这条固定支出已经不存在了";return}
  var t={id:editing?old.id:Date.now(),day:d,cat:cat};
  var rec={id:t.id,date:(editing?old.start:st)+"-01",item:name,cat:recurCat(t,editing?old.last:"",editing?old.active:true),amt:r2(a)};
  S.expenses=S.expenses.filter(function(x){return x.id!==t.id});S.expenses.push(rec);queue({op:"add",row:rec});syncUI();
  recForm(false);toast(editing?"固定支出已修改":"固定支出已添加",name+tl(" · 每月 {0} 号 · {1}",d,rm(r2(a))));
  recurTick();recurView();
});
$("recList").addEventListener("click",function(e){
  var b=e.target.closest&&e.target.closest("button");if(!b)return;
  var pa=b.getAttribute("data-rpause"),ed=b.getAttribute("data-redit"),del=b.getAttribute("data-rdel");
  var find=function(id){return recurs().filter(function(t){return String(t.id)===id})[0]};
  if(ed){var t=find(ed);if(t)recForm(true,t)}
  else if(pa){
    var t2=find(pa);if(!t2)return;
    var last=t2.last;
    if(!t2.active){                                                  /* resuming: do not back-fill the paused months */
      var nowIdx=monthIdx(today().slice(0,7));last=idxToYm(+today().slice(8,10)>=Math.min(t2.day,daysInMonth(today().slice(0,7)))?nowIdx:nowIdx-1);
    }
    var rec={id:t2.id,date:t2.start+"-01",item:t2.name,cat:recurCat(t2,last,!t2.active),amt:t2.amt};
    S.expenses=S.expenses.filter(function(x){return x.id!==t2.id});S.expenses.push(rec);queue({op:"add",row:rec});syncUI();recurView();
  }else if(del){
    if(b.getAttribute("data-sure")!=="1"){b.setAttribute("data-sure","1");b.textContent="再按确认";setTimeout(function(){if(b.isConnected){b.removeAttribute("data-sure");b.innerHTML="×"}},3000);return}
    if(recEditId===del)recForm(false);
    S.expenses=S.expenses.filter(function(x){return String(x.id)!==del});queue({op:"del",id:+del});syncUI();recurView();
  }
});

/* ---- weekly summary (Mon-Sun) ---- */
var WKN=["一","二","三","四","五","六","日"],wkStart=null;
function d2s(d){return d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate())}
function s2d(s){return new Date(s+"T12:00:00")}
function addDays(s,n){var d=s2d(s);d.setDate(d.getDate()+n);return d2s(d)}
function mondayOf(s){var d=s2d(s);d.setDate(d.getDate()-(d.getDay()+6)%7);return d2s(d)}
function latestWeek(){var t=today(),m=mondayOf(t);return s2d(t).getDay()===0?m:addDays(m,-7)}   /* Sunday already reports the current week */
function wkLabel(a){return a.slice(5).replace("-","/")+"–"+addDays(a,6).slice(5).replace("-","/")}
function weekData(start,n){
  var days=[0,0,0,0,0,0,0],cat={},o={start:start,days:days,cat:cat,tot:0,av:0,big:null,sk:0,skn:0,n:n},end=addDays(start,n-1);
  spent().forEach(function(x){
    if(x.date<start||x.date>end)return;
    days[Math.round((s2d(x.date)-s2d(start))/864e5)]+=x.amt;o.tot+=x.amt;cat[x.cat]=(cat[x.cat]||0)+x.amt;
    if(AVOID[x.cat])o.av+=x.amt;if(!o.big||x.amt>o.big.amt)o.big=x;
  });
  S.expenses.forEach(function(x){if(x.cat===SKIP&&x.date>=start&&x.date<=end){o.sk+=x.amt;o.skn++}});
  return o;
}
function weekHasActivity(w){return w.tot>0||w.skn>0}
function earliestWeek(){var e=null;S.expenses.forEach(function(x){if(/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&(!e||x.date<e))e=x.date});return e?mondayOf(e):null}
function wkDelta(cur,prev){var d=cur-prev;return {d:d,pct:prev>0?Math.round(d/prev*100):null}}
function weekView(){
  var t=today(),curMon=mondayOf(t),latest=latestWeek();
  if(!wkStart||wkStart>curMon)wkStart=latest;
  var partial=wkStart===curMon&&s2d(t).getDay()!==0,upto=partial?((s2d(t).getDay()+6)%7)+1:7;
  var cur=weekData(wkStart,upto),prev=weekData(addDays(wkStart,-7),upto),ear=earliestWeek();
  $("wkTitle").textContent=tl(partial?"本周至今 {0}":wkStart===latest?"最近一周 {0}":"{0}",wkLabel(wkStart));
  $("wkPrev").disabled=!ear||wkStart<=ear;$("wkNext").disabled=wkStart>=curMon;
  if(!weekHasActivity(cur)&&!weekHasActivity(prev)&&!S.expenses.length){$("wkBody").innerHTML='<div class="empty">这一周还没有记录</div>';return}
  var del=wkDelta(cur.tot,prev.tot),cmpWord=partial?"上周同期":"上周";
  var deltaHtml=prev.tot>0||cur.tot>0?(Math.abs(del.d)<0.005?'<span class="flat">'+tl("和{0}持平",cmpWord)+'</span>':'<span class="'+(del.d>0?"up":"down")+'">'+tl(del.d>0?"▲ 比{0}多 {1}":"▼ 比{0}少 {1}",cmpWord,rm0(Math.abs(del.d)))+(del.pct!==null?tl("（{0}{1}%）",del.d>0?"+":"−",Math.abs(del.pct)):"")+'</span>'):'';
  var max=Math.max.apply(null,cur.days.concat([1])),peak=cur.days.indexOf(Math.max.apply(null,cur.days));
  var bars=cur.days.map(function(v,i){return '<div class="wc"><small class="wv">'+(v?rm0(v).slice(3):"")+'</small><div class="wb"><i class="'+(v>0&&i===peak?"hi":"")+(i>=upto?" fut":"")+'" style="height:'+(v/max*100)+'%"></i></div><small>'+tl("周{0}",WKN[i])+'</small></div>'}).join("");
  var cats=Object.keys(cur.cat).sort(function(a,b){return cur.cat[b]-cur.cat[a]}).slice(0,3),cm=cats.length?cur.cat[cats[0]]:1;
  var top=cats.length?cats.map(function(c){return '<div class="cat"><div class="t"><span>'+esc(c)+'</span><span class="amt">'+rm0(cur.cat[c])+'</span></div><div class="bar"><i class="'+(AVOID[c]?"av":"")+'" style="width:'+Math.max(2,cur.cat[c]/cm*100)+'%"></i></div></div>'}).join(""):'<div class="empty" style="padding:8px 0">这一周没有支出</div>';
  var avg=cur.tot/upto;
  var tiles='<div class="stat" style="margin-top:12px"><div><small>日均</small><strong>'+rm0(avg)+'</strong></div><div><small>不必要</small><strong class="'+(cur.av>0?"warnv":"")+'">'+rm0(cur.av)+'</strong></div><div><small>忍住了</small><strong>'+tl("{0} 次",cur.skn)+'</strong></div></div>';
  var ins=[];
  if(cur.tot===0&&prev.tot>0)ins.push(tl("这一周没有支出，{0}花了 {1}。",cmpWord,rm0(prev.tot)));
  else if(cur.tot>0&&prev.tot===0)ins.push(tl("{0}没有支出记录，没办法比较。",cmpWord));
  else if(cur.tot>0){
    if(del.d<-0.005)ins.push(tl("比{0}少花了 {1}，做得好！",cmpWord,rm0(-del.d)));
    else if(del.d>0.005){
      var gain=Object.keys(cur.cat).map(function(c){return [c,cur.cat[c]-(prev.cat[c]||0)]}).sort(function(a,b){return b[1]-a[1]})[0];
      ins.push(tl("比{0}多花了 {1}",cmpWord,rm0(del.d))+(gain&&gain[1]>0?tl("，增加最多的是 {0}（+{1}）",esc(gain[0]),rm0(gain[1])):"")+tl("。"));
    }
  }
  if(cur.tot>0)ins.push(tl("花得最多的一天是周{0}（{1}）。",WKN[peak],rm0(cur.days[peak])));
  if(cur.big)ins.push(tl("最大的一笔：<b>{0}</b> {1}。",esc(cur.big.item),rm0(cur.big.amt)));
  if(cur.av>0)ins.push(tl("「不必要」花了 {0}",rm0(cur.av))+(prev.av>0?tl("（{0} {1}）",cmpWord,rm0(prev.av)):"")+tl("。"));
  if(cur.skn>0)ins.push(tl("忍住了 {0} 次，省下 <b>{1}</b> 🎉",cur.skn,rm0(cur.sk)));
  var up="";
  if(wkStart>=latest){                           /* what is coming in the next 7 days */
    var from=t,to=addDays(t,6),items=[];
    debts().forEach(function(d){if(!d.settled&&d.due&&d.due<=to)items.push([d.due<from?from:d.due,tl(d.dir==="owe"?"还 {0}":"收 {0}",d.name)+(d.due<from?tl("（已逾期）"):""),d.cur==="MYR"?rm0(d.left):cm(d.cur,d.left)])});
    recurs().forEach(function(r){if(r.active){var n=recurNext(r);if(n>=from&&n<=to)items.push([n,tl("{0}（固定支出）",r.name),rm0(r.amt)])}});
    items.sort(function(a,b){return a[0]<b[0]?-1:a[0]>b[0]?1:0});
    if(items.length)up='<div class="wup"><h3>接下来 7 天</h3>'+items.map(function(i){return '<div class="cmp"><span class="n">'+i[0].slice(5)+' · '+esc(i[1])+'</span><span class="v">'+i[2]+'</span></div>'}).join("")+'</div>';
  }
  $("wkBody").innerHTML='<div class="wbig">'+rm0(cur.tot)+'</div><div style="margin-top:2px">'+deltaHtml+'</div><div class="wchart">'+bars+'</div>'+top+tiles+
    (ins.length?'<ul class="wins">'+ins.map(function(x){return '<li>'+x+'</li>'}).join("")+'</ul>':'')+up;
}
$("wkPrev").addEventListener("click",function(){wkStart=addDays(wkStart,-7);weekView()});
$("wkNext").addEventListener("click",function(){wkStart=addDays(wkStart,7);weekView()});
var WKSEEN="pocketledger.weekSeen";
function weekSeen(){try{return localStorage.getItem(WKSEEN)||""}catch(e){return ""}}
function weekBannerView(){
  var ls=latestWeek(),cur=weekData(ls,7);
  if(!weekHasActivity(cur)||weekSeen()===ls){$("weekBanner").hidden=true;return}
  var prev=weekData(addDays(ls,-7),7),del=wkDelta(cur.tot,prev.tot);
  var s=tl(s2d(today()).getDay()===0?"本周（{0}）花了 <b>{1}</b>":"上周（{0}）花了 <b>{1}</b>",wkLabel(ls),rm0(cur.tot));
  if(prev.tot>0&&Math.abs(del.d)>=0.005)s+=tl(del.d>0?"，比前一周多 {0}":"，比前一周少 {0}",rm0(Math.abs(del.d)));
  if(cur.skn>0)s+=tl("，忍住了 {0} 次省下 {1}",cur.skn,rm0(cur.sk));
  $("wkBannerText").innerHTML=s+tl("。");$("weekBanner").hidden=false;
}
$("wkBannerOk").addEventListener("click",function(){try{localStorage.setItem(WKSEEN,latestWeek())}catch(e){}$("weekBanner").hidden=true});
$("wkBannerGo").addEventListener("click",function(){wkStart=latestWeek();tab("sum");weekView();openPop("weekCard")});

/* ---- salary history: row cat "Pay:<effective YYYY-MM>:<deduction %>", amt = net salary, id 8000000 + month index.
   A month uses the latest record that starts on or before it; before the first record the old single setting applies. ---- */
var PAY_ROW_RE=/^Pay:(\d{4}-\d{2}):(\d+(?:\.\d+)?)$/;
function payId(ym){return 8000000+monthIdx(ym)}
function payRecords(){
  var out=[];S.expenses.forEach(function(x){var m=PAY_ROW_RE.exec(x.cat);if(m)out.push({id:x.id,from:m[1],wage:x.amt,ded:+m[2]})});
  return out.sort(function(a,b){return a.from<b.from?-1:a.from>b.from?1:0});
}
function salaryFor(m){
  var best=null;payRecords().forEach(function(r){if(r.from<=m)best=r});
  return best?{wage:best.wage,ded:best.ded,from:best.from}:{wage:+S.set.wage||0,ded:+S.set.ded||0,from:""};
}
function payMonth(){var v=$("swm").value;return /^\d{4}-(0[1-9]|1[0-2])$/.test(v)?v:null}
function payInputs(){var m=payMonth()||today().slice(0,7),sal=salaryFor(m);
  if(document.activeElement!==$("sw"))$("sw").value=sal.wage||"";
  if(document.activeElement!==$("sd"))$("sd").value=sal.ded;}
function payListView(){
  var rs=payRecords();
  $("payList").innerHTML=rs.length?'<h3 style="margin:12px 0 2px;font-size:13px;color:var(--muted);font-weight:600">薪水调整记录</h3>'+rs.map(function(r){
    return '<div class="rrow"><b>'+tl("{0} 起",r.from)+'</b><div class="amt">'+rm(r.wage)+'</div><div class="info">'+tl("固定扣除 {0}%",r.ded)+'</div><div class="acts"><button class="x" data-paydel="'+r.id+'" aria-label="删除这条调整记录">×</button></div></div>';
  }).join(""):'';
}
function savePay(){
  var m=payMonth();
  if(!m){$("swMsg").textContent="生效月份格式请填 年-月，例如 2026-10";return}
  $("swMsg").textContent="";
  var w=parseFloat($("sw").value),d=parseFloat($("sd").value);
  var rec={id:payId(m),date:m+"-01",item:"薪水",cat:"Pay:"+m+":"+(isNaN(d)?0:d),amt:isNaN(w)?0:w};
  S.expenses=S.expenses.filter(function(x){return x.id!==rec.id});S.expenses.push(rec);queue({op:"add",row:rec});
  syncUI();payListView();sumView();freeMiniView();homeView();
}
$("sw").addEventListener("input",savePay);$("sd").addEventListener("input",savePay);
$("swm").addEventListener("input",function(){if(payMonth()){$("swMsg").textContent="";payInputs()}});
$("payList").addEventListener("click",function(e){
  var b=e.target.closest&&e.target.closest("button[data-paydel]");if(!b)return;
  if(b.getAttribute("data-sure")!=="1"){b.setAttribute("data-sure","1");b.textContent="再按确认";setTimeout(function(){if(b.isConnected){b.removeAttribute("data-sure");b.innerHTML="×"}},3000);return}
  var id=b.getAttribute("data-paydel");
  S.expenses=S.expenses.filter(function(x){return String(x.id)!==id});queue({op:"del",id:+id});syncUI();
  payInputs();payListView();sumView();freeMiniView();homeView();
});

/* ---- free money: net pay minus everything that has to be paid every month ----
   must-pay categories are stored as hidden rows: cat "Must:<Category>", id 9000000 + category index (stable across devices) */
function mustId(c){return 9000000+CAT_IDS.indexOf(c)}
function mustSet(){var o={};S.expenses.forEach(function(x){if(x.cat.indexOf("Must:")===0)o[x.cat.slice(5)]=1});return o}
function isRecurId(id){return id>=2e14&&id<1e15}
function freeMoney(m){
  var sal=salaryFor(m),wage=sal.wage,inc=wage-wage*sal.ded/100,curM=today().slice(0,7),ms=mustSet();
  var o={m:m,wage:wage,inc:inc,payFrom:sal.from,tot:0,rec:0,cat:0,rep:0,pendRec:0,pendDebt:0,unknownFx:false,pendList:[]};
  spent().forEach(function(x){
    if(x.date.slice(0,7)!==m)return;
    o.tot+=x.amt;
    if(x.ro)o.rep+=x.amt;else if(isRecurId(x.id))o.rec+=x.amt;else if(ms[x.cat])o.cat+=x.amt;
  });
  if(m>=curM){                                                       /* still to be paid this month */
    recurs().forEach(function(t){if(t.active&&recurNext(t).slice(0,7)===m){o.pendRec+=t.amt;o.pendList.push(t.name)}});
    debts().forEach(function(d){
      if(d.settled||d.dir!=="owe"||!d.due)return;
      var dm=d.due.slice(0,7);if(!(m===curM?dm<=m:dm===m))return;
      if(d.cur==="MYR"){o.pendDebt+=d.left;o.pendList.push(d.name)}
      else if(d.leftRM!==null){o.pendDebt+=d.leftRM;o.pendList.push(d.name)}
      else o.unknownFx=true;
    });
  }
  o.must=o.rec+o.cat+o.rep+o.pendRec+o.pendDebt;
  o.free=inc-o.must;o.freeSpent=o.tot-o.rec-o.cat-o.rep;o.left=o.free-o.freeSpent;
  o.pct=o.free>0?o.freeSpent/o.free*100:(o.freeSpent>0?999:0);o.state=budState(o.pct);
  if(m===curM){var dim=daysInMonth(m),dom=+today().slice(8,10);o.daysLeft=dim-dom+1;o.perDay=o.left>0?o.left/o.daysLeft:0}
  return o;
}
function freeRow(k,v,cls){return '<div class="fr'+(cls?" "+cls:"")+'"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>'}
function freeView(){
  var m=$("sm").value||today().slice(0,7),f=freeMoney(m);
  $("freeTitle").textContent=tl("{0} 能自由使用的钱",m);
  if(!(f.wage>0)){$("freeBody").innerHTML='<div class="empty" style="padding:8px 0">先到「设置」填每月净薪水，才能算出能自由使用的钱 <button class="btn ghost small" data-go="set" data-jump="payCard" style="margin-top:8px">去设置</button></div>';return}
  var h=freeRow(tl("每月净薪水（扣固定扣除后）{0}",f.payFrom?tl("（{0} 起）",f.payFrom):""),rm0(f.inc));
  if(f.rec>0)h+=freeRow("− 固定支出（自动记账）",rm0(f.rec));
  if(f.pendRec>0)h+=freeRow("− 固定支出（还没到日子）",rm0(f.pendRec));
  if(f.cat>0)h+=freeRow("− 必花分类的支出",rm0(f.cat));
  if(f.rep>0)h+=freeRow("− 已还的欠款",rm0(f.rep));
  if(f.pendDebt>0)h+=freeRow("− 到期还没付的欠款",rm0(f.pendDebt));
  h+=freeRow("= 能自由使用",rm0(f.free),"sum");
  h+=freeRow("− 已经花掉的（非必花）",rm0(f.freeSpent));
  h+='<div style="margin-top:12px"><div class="fbig '+f.state+'">'+(f.left<0?tl("超支 {0}",rm0(-f.left)):tl("还能用 {0}",rm0(f.left)))+'</div><div class="bar"><i class="'+f.state+'" style="width:'+Math.min(100,f.pct)+'%"></i></div></div>';
  if(f.daysLeft!==undefined)h+='<p class="msg">'+(f.left>0?tl("本月还剩 {0} 天，平均每天还能花 <b>{1}</b>。",f.daysLeft,rm0(f.perDay)):"本月已经用完了能自由使用的钱，剩下的日子要省着点。")+'</p>';
  if(f.unknownFx)h+='<p class="msg">有外币欠款没填汇率，没有算进「到期还没付」。</p>';
  $("freeBody").innerHTML=h;
}
function freeMiniView(){
  var f=freeMoney(today().slice(0,7));
  if(!(f.wage>0)){$("freeMini").hidden=true;return}
  $("freeMini").hidden=false;
  $("freeMiniNum").className="fbig "+f.state;
  $("freeMiniNum").textContent=f.left<0?tl("超支 {0}",rm0(-f.left)):rm0(f.left);
  $("freeMiniSub").innerHTML=f.left>0?tl("本月还剩 {0} 天，平均每天约 <b>{1}</b>",f.daysLeft,rm0(f.perDay))+(f.must>0?tl("（必花 {0} 已扣除）",rm0(f.must)):""):tl("已超出能自由使用的钱")+(f.must>0?tl("，必花 {0} 已扣除",rm0(f.must)):"");
}
function mustChipsView(){
  var ms=mustSet();
  $("mustChips").innerHTML=CATS.map(function(c){return '<button class="chip" data-must="'+esc(c)+'" aria-pressed="'+(!!ms[c])+'">'+esc(c)+'</button>'}).join("");
}
$("mustChips").addEventListener("click",function(e){
  var c=e.target.getAttribute&&e.target.getAttribute("data-must");if(!c)return;
  var id=mustId(c);
  if(mustSet()[c]){S.expenses=S.expenses.filter(function(x){return x.cat!=="Must:"+c});S.pending.push({op:"del",id:id});queue()}
  else{var rec={id:id,date:today(),item:"必花分类",cat:"Must:"+c,amt:0};S.expenses.push(rec);queue({op:"add",row:rec})}
  syncUI();mustChipsView();freeView();freeMiniView();
});

/* ---- home insights ---- */
function homeInsights(){
  var t=today(),m=t.slice(0,7),dom=+t.slice(8,10),dim=daysInMonth(m),out=[],f=freeMoney(m),hasWage=f.wage>0;
  var todayAll=0,todayFree=0;
  spent().forEach(function(x){if(x.date!==t)return;todayAll+=x.amt;if(!(x.ro||isRecurId(x.id)||mustSet()[x.cat]))todayFree+=x.amt});
  budgetRows(m).filter(function(r){return r.state!=="ok"}).sort(function(a,b){return b.pct-a.pct}).slice(0,2).forEach(function(r){
    out.push({lv:r.state==="over"?4:3,t:r.state==="over"?tl("「{0}」预算已超支 {1}（{2} / {3}）",esc(r.label),rm0(r.used-r.b),rm0(r.used),rm0(r.b)):tl("「{0}」预算已用 {1}%（{2} / {3}）",esc(r.label),Math.round(r.pct),rm0(r.used),rm0(r.b))});
  });
  if(hasWage&&f.daysLeft!==undefined){
    if(dom>=3&&f.free>0){
      var pace=f.freeSpent/dom,proj=pace*dim,diff=f.free-proj;
      if(diff<0&&f.left>0)out.push({lv:3,t:tl("按现在每天约 {0} 的速度，月底会超支约 <b>{1}</b>；之后每天控制在 <b>{2}</b> 以内就能守住",rm0(pace),rm0(-diff),rm0(f.left/f.daysLeft))});
      else if(diff>=0)out.push({lv:1,t:tl("按现在每天约 {0} 的速度，月底大约还会剩 <b>{1}</b>",rm0(pace),rm0(diff))});
    }
    var allowance=(f.left+todayFree)/f.daysLeft;
    if(allowance>0&&todayFree>0){
      if(todayFree>allowance)out.push({lv:3,t:tl("今天已花 {0}，超过今日额度 {1}",rm0(todayFree),rm0(allowance))});
      else out.push({lv:1,t:tl("今天已花 {0}，今日额度约 {1}，还可以花 <b>{2}</b>",rm0(todayFree),rm0(allowance),rm0(allowance-todayFree))});
    }
  }else if(!hasWage)out.push({lv:2,t:"到「设置」填每月净薪水，就能看到本月可用余额和花钱速度"});
  var ws=mondayOf(t),upto=((s2d(t).getDay()+6)%7)+1,wk=weekData(ws,upto),pw=weekData(addDays(ws,-7),upto),dd=wk.tot-pw.tot;
  if(wk.tot>0&&pw.tot>0&&Math.abs(dd)>=0.005)out.push({lv:1,t:tl(dd>0?"本周至今花了 {0}，比上周同期多 <b>{1}</b>":"本周至今花了 {0}，比上周同期少 <b>{1}</b>",rm0(wk.tot),rm0(Math.abs(dd)))});
  var avd=monthData(m).av;if(avd>0)out.push({lv:2,t:tl("本月「不必要」已花 {0}",rm0(avd))});
  var sk=0,skn=0;S.expenses.forEach(function(x){if(x.cat===SKIP&&x.date.slice(0,7)===m){sk+=x.amt;skn++}});
  if(skn>0)out.push({lv:1,t:tl("本月忍住了 {0} 次，省下 <b>{1}</b> 🎉",skn,rm0(sk))});
  var gl=goalProgress(skipTotal()).filter(function(g){return !g.done})[0];
  if(gl)out.push({lv:1,t:tl("距离「{0}」还差 {1}（已完成 {2}%）",esc(gl.name),rm0(gl.target-gl.saved),Math.floor(gl.saved/gl.target*100))});
  var soon=addDays(t,2),rc=recurs().filter(function(r){return r.active&&recurNext(r)>=t&&recurNext(r)<=soon});
  if(rc.length)out.push({lv:1,t:tl("接下来 3 天会自动记账：{0}",rc.map(function(r){return esc(r.name)+" "+rm0(r.amt)}).join(tl("、")))});
  return out.map(function(o,i){o.i=i;return o}).sort(function(a,b){return b.lv-a.lv||a.i-b.i}).slice(0,3);
}
function homeView(){
  var t=today(),m=t.slice(0,7),has=spent().length>0||salaryFor(m).wage>0;
  $("openIns").hidden=!has;if(!has)return;
  var todayAll=0;spent().forEach(function(x){if(x.date===t)todayAll+=x.amt});
  var ws=mondayOf(t),upto=((s2d(t).getDay()+6)%7)+1,wk=weekData(ws,upto),pw=weekData(addDays(ws,-7),upto),dd=wk.tot-pw.tot;
  var cur=monthData(m);
  var wkSub=pw.tot>0&&Math.abs(dd)>=0.005?'<small class="'+(dd>0?"up":"down")+'" style="display:block">'+(dd>0?"▲ ":"▼ ")+rm0(Math.abs(dd))+'</small>':'';
  $("homeStats").innerHTML='<div><small>今天已花</small><strong>'+rm0(todayAll)+'</strong></div><div><small>本周至今</small><strong>'+rm0(wk.tot)+'</strong>'+wkSub+'</div><div><small>本月已花</small><strong>'+rm0(cur.tot)+'</strong></div>';
  var ins=homeInsights();
  $("homeIns").innerHTML=ins.map(function(o){return '<li>'+(o.lv>=4?"🔴 ":o.lv===3?"🟠 ":o.lv===2?"💡 ":"✨ ")+o.t+'</li>'}).join("");
}

/* ---- credit accounts (信用账户): the monthly statements of e.g. ShopeePay PayLater ----
   account row  cat "Acct:<due day>:<1|0 repayments count as spending>", item = name, amt = credit limit (0 = none)
   statement    an ordinary debt whose category ends in "@<accountId>"; its month is the month before its due date */
var ACCT_RE=/^Acct:(\d{1,2}):([01])$/;
function accounts(){
  var out=[];S.expenses.forEach(function(x){var m=ACCT_RE.exec(x.cat);if(m)out.push({id:x.id,name:x.item,dueDay:+m[1],spend:m[2]==="1",limit:x.amt,created:x.date})});
  return out.sort(function(a,b){return a.id-b.id});
}
function acctCat(dueDay,spend){return "Acct:"+dueDay+":"+(spend?1:0)}
function stmtDue(m,dueDay){var nm=idxToYm(monthIdx(m)+1);return nm+"-"+p2(Math.min(dueDay,daysInMonth(nm)))}
function stmtMonth(d){return d.due?idxToYm(monthIdx(d.due.slice(0,7))-1):d.start.slice(0,7)}
function debtCatOf(d,over){
  var o=Object.assign({spend:d.spend,due:d.due,acct:d.acct},over||{});
  return "Debt:"+d.dir+":"+(o.spend?1:0)+":"+(o.due||"-")+(d.cur!=="MYR"?":"+d.cur+(d.refRate>0?":"+d.refRate:""):"")+(o.acct?"@"+o.acct:"");
}
function putRow(rec){S.expenses=S.expenses.filter(function(x){return x.id!==rec.id});S.expenses.push(rec);queue({op:"add",row:rec})}
function acctStats(a){
  var all=debts().filter(function(d){return d.acct===String(a.id)}),open=all.filter(function(d){return !d.settled}),m=today().slice(0,7);
  open.sort(function(x,y){return (x.due||"9999")<(y.due||"9999")?-1:1});
  var out=open.reduce(function(t,d){return t+d.left},0),months={};
  for(var i=0;i<6;i++)months[idxToYm(monthIdx(m)+i)]=0;
  open.forEach(function(d){var dm=d.due?d.due.slice(0,7):m;if(dm<m)dm=m;if(months[dm]!==undefined)months[dm]+=d.left});
  return {all:all,open:open,done:all.filter(function(d){return d.settled}),out:out,next:open[0]||null,overdue:open.filter(function(d){return d.days!==null&&d.days<0}),months:months};
}
function stmtRow(a,d){
  var st=debtStatus(d);
  return '<div class="rrow"><b>'+tl("{0} 账单",stmtMonth(d))+'</b><div class="amt">'+(d.settled?rm0(d.principal):rm(d.left))+'</div>'+
    '<div class="info"><span class="st '+st.c+'">'+st.t+'</span>'+(d.paid>0?tl(" · 已还 {0}",rm0(d.paid)):"")+'</div>'+
    '<div class="acts"><button class="x" data-aedit="'+d.id+'" aria-label="修改账单">'+ICON_EDIT+'</button><button class="x" data-adel="'+d.id+'" aria-label="删除账单">×</button></div></div>'+
    (d.settled?'':'<details class="more" style="margin:-4px 0 8px"><summary>记还款</summary><div class="grid" style="margin-top:8px"><div><label>金额 (RM)</label><input type="number" inputmode="decimal" step="0.01" min="0" data-apamt value="'+d.left+'"></div><div><label>日期</label><input type="date" data-apdate value="'+today()+'"></div></div><button class="btn small" data-apay="'+d.id+'" style="margin-top:8px">记一笔还款</button><div class="msg" data-apmsg></div></details>');
}
function acctCard(a){
  var st=acctStats(a),m=today().slice(0,7),prevM=idxToYm(monthIdx(m)-1);
  var nextTxt=st.next?(st.next.days!==null&&st.next.days<0?'<span class="st over">'+tl("已逾期 {0} 天",-st.next.days)+'</span>':"")+tl(" 下一笔：{0} 到期 · {1}",st.next.due?st.next.due.slice(5):"—",rm(st.next.left))+(st.next.days!==null&&st.next.days>=0?tl("（{0} 天后）",st.next.days):""):"没有未付的账单 ✓";
  var lim=a.limit>0?'<div class="msg" style="margin:6px 0 0">'+tl("额度 {0} · 已用 {1} · 可用 <b>{2}</b>",rm0(a.limit),rm0(st.out),rm0(Math.max(0,a.limit-st.out)))+'</div><div class="bar"><i class="'+budState(st.out/a.limit*100)+'" style="width:'+Math.min(100,st.out/a.limit*100)+'%"></i></div>':"";
  var mx=Math.max.apply(null,Object.keys(st.months).map(function(k){return st.months[k]}).concat([1]));
  var plan=st.open.length?'<h3 style="margin:14px 0 4px;font-size:13px;color:var(--muted);font-weight:600">未来 6 个月要还</h3>'+Object.keys(st.months).map(function(k){return '<div class="tr"><span class="mo">'+k.slice(2)+'</span><div class="bar"><i style="width:'+(st.months[k]>0?Math.max(2,st.months[k]/mx*100):0)+'%"></i></div><span class="amt">'+rm0(st.months[k])+'</span></div>'}).join(""):"";
  var missing=!st.all.some(function(d){return stmtMonth(d)===prevM})?'<div class="hint" style="margin-top:10px">'+tl("上个月（{0}）的账单还没记。出账后到下面「新增账单」记一笔。",prevM)+'</div>':"";
  var cand=debts().filter(function(d){return d.dir==="owe"&&d.cur==="MYR"&&!d.acct&&!d.settled});
  var attach=cand.length?'<details class="more" style="margin-top:8px"><summary>'+tl("归入已有欠款（{0}）",cand.length)+'</summary><div style="margin-top:8px">'+cand.map(function(d){
      var pre=d.name.toLowerCase().indexOf(a.name.toLowerCase().split(" ")[0])>=0;
      return '<label class="chk" style="margin:6px 0"><input type="checkbox" data-attach="'+d.id+'"'+(pre?" checked":"")+'>'+esc(d.name)+' · '+rm0(d.left)+(d.due?tl("（{0} 到期）",d.due.slice(5)):'')+'</label>'}).join("")+
    '<label class="chk" style="margin:8px 0"><input type="checkbox" data-attachspend checked>'+tl(a.spend?"统一按这个账户的设置：还款算进支出":"统一按这个账户的设置：还款不算进支出")+'</label><button class="btn small" data-aattach="'+a.id+'">归入这个账户</button><div class="msg" data-aamsg></div></div></details>':"";
  var open=st.open.map(function(d){return stmtRow(a,d)}).join(""),done=st.done.map(function(d){return stmtRow(a,d)}).join("");
  return '<div class="card acct" data-acct="'+a.id+'"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2 style="margin:0 0 4px">'+esc(a.name)+'</h2><div class="msg" style="margin:0">'+tl(a.spend?"每月 {0} 号到期 · 还款算支出":"每月 {0} 号到期 · 还款不算支出",a.dueDay)+'</div></div><div style="text-align:right"><div class="fbig '+(st.overdue.length?"over":st.out>0?"near":"ok")+'" style="font-size:26px">'+rm0(st.out)+'</div><div class="msg" style="margin:0">总共欠</div></div></div>'+
    '<div class="msg" style="margin-top:8px">'+nextTxt+'</div>'+lim+plan+missing+
    '<h3 style="margin:14px 0 2px;font-size:13px;color:var(--muted);font-weight:600">账单</h3>'+(open||'<div class="empty" style="padding:8px 0">还没有账单</div>')+
    (done?'<details class="more"><summary>'+tl("已结清（{0}）",st.done.length)+'</summary>'+done+'</details>':'')+
    '<details class="more stmtForm" style="margin-top:8px"><summary data-stmtsum>＋ 新增账单</summary><div class="grid" style="margin-top:8px"><div><label>账单月份（格式 2026-11）</label><input type="month" placeholder="2026-11" data-sm value="'+(function(){var mx=st.all.map(stmtMonth).sort().pop();return mx?idxToYm(monthIdx(mx)+1):prevM})()+'"></div><div><label>账单金额 (RM)</label><input type="number" inputmode="decimal" step="0.01" min="0" data-sa placeholder="0.00"></div><div class="full"><label>'+tl("到期日（默认下个月 {0} 号，可改）",a.dueDay)+'</label><input type="date" data-sd></div></div><div class="row" style="margin-top:10px"><button class="btn small" data-asave="'+a.id+'">添加账单</button><button class="btn ghost small" data-acancelst hidden>取消修改</button></div><div class="msg" data-asmsg></div></details>'+
    attach+
    '<div class="row" style="margin-top:12px"><button class="btn ghost small" data-aaedit="'+a.id+'">修改账户</button><button class="btn ghost small" data-aadel="'+a.id+'">删除账户</button></div></div>';
}
function acctView(){
  var as=accounts();
  $("acctList").innerHTML=as.map(acctCard).join("");
}
var acctEditId=null;
function acctFormReset(){
  acctEditId=null;$("an").value="";$("ad").value=5;$("al").value="";$("asp").checked=false;
  $("aadd").textContent="添加账户";$("acancel").hidden=true;$("acctNewSum").textContent="＋ 新增信用账户（ShopeePay PayLater、信用卡…）";
}
$("acancel").addEventListener("click",function(){acctFormReset();$("amsg").textContent=""});
$("aadd").addEventListener("click",function(){
  var name=$("an").value.trim(),d=parseInt($("ad").value,10),lim=parseFloat($("al").value)||0,sp=$("asp").checked;
  if(!name){$("amsg").textContent="请填账户名称";return}
  if(!(d>=1&&d<=31)){$("amsg").textContent="每月几号请填 1 到 31";return}
  var editing=acctEditId!==null,old=editing?accounts().filter(function(x){return String(x.id)===acctEditId})[0]:null;
  if(editing&&!old){acctFormReset();$("amsg").textContent="这个账户已经不存在了";return}
  var rec={id:editing?old.id:Date.now(),date:editing?old.created:today(),item:name,cat:acctCat(d,sp),amt:r2(Math.max(0,lim))};
  putRow(rec);
  if(editing&&old.spend!==sp)debts().filter(function(x){return x.acct===String(old.id)}).forEach(function(x){putRow({id:x.id,date:x.start,item:x.name,cat:debtCatOf(x,{spend:sp}),amt:x.principal})});
  syncUI();acctFormReset();$("amsg").textContent="";$("acctNew").open=false;debtView();
  toast(editing?"账户已修改":"账户已添加",name);
});
function acctFromEl(el){var c=el.closest(".acct");return c?accounts().filter(function(a){return String(a.id)===c.getAttribute("data-acct")})[0]:null}
$("acctList").addEventListener("click",function(e){
  var b=e.target.closest&&e.target.closest("button");if(!b)return;
  var a=acctFromEl(b);if(!a)return;
  var card=b.closest(".acct"),g=function(k){return b.getAttribute(k)};
  if(g("data-aaedit")!==null){
    acctEditId=String(a.id);$("an").value=a.name;$("ad").value=a.dueDay;$("al").value=a.limit||"";$("asp").checked=a.spend;
    $("aadd").textContent="保存修改";$("acancel").hidden=false;$("acctNewSum").textContent="修改信用账户";$("acctNew").open=true;
    $("acctFormCard").scrollIntoView&&$("acctFormCard").scrollIntoView({block:"center",behavior:"smooth"});return;
  }
  if(g("data-aadel")!==null){
    if(b.getAttribute("data-sure")!=="1"){b.setAttribute("data-sure","1");b.textContent="再按一次确认（账单会保留成普通欠款）";setTimeout(function(){if(b.isConnected){b.removeAttribute("data-sure");b.textContent="删除账户"}},3500);return}
    debts().filter(function(x){return x.acct===String(a.id)}).forEach(function(x){putRow({id:x.id,date:x.start,item:x.name,cat:debtCatOf(x,{acct:""}),amt:x.principal})});
    S.expenses=S.expenses.filter(function(x){return x.id!==a.id});queue({op:"del",id:a.id});
    if(acctEditId===String(a.id))acctFormReset();
    syncUI();debtView();toast("账户已删除","账单保留在「我欠别人的」里");return;
  }
  if(g("data-asave")!==null){
    var f=card.querySelector(".stmtForm"),msg=f.querySelector("[data-asmsg]"),mon=f.querySelector("[data-sm]").value,amt=parseFloat(f.querySelector("[data-sa]").value),due=f.querySelector("[data-sd]").value||"";
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(mon)){msg.textContent="账单月份格式请填 年-月，例如 2026-11";return}
    if(!(amt>0)){msg.textContent="请填账单金额";return}
    var editing=f.getAttribute("data-editing"),st=acctStats(a);
    if(st.all.some(function(d){return stmtMonth(d)===mon&&String(d.id)!==editing})){msg.textContent=tl("{0} 的账单已经有了，请在下面修改它",mon);return}
    due=due||stmtDue(mon,a.dueDay);
    var old=editing?debts().by[editing]:null,rec;
    if(editing&&!old){msg.textContent="这笔账单已经不存在了";f.removeAttribute("data-editing");return}
    rec={id:editing?old.id:Date.now(),date:editing?old.start:today(),item:editing?old.name:a.name+" "+mon+" 账单",cat:"Debt:owe:"+(editing?(old.spend?1:0):(a.spend?1:0))+":"+due+"@"+a.id,amt:r2(amt)};
    putRow(rec);syncUI();debtView();toast(editing?"账单已修改":"账单已添加",mon+" · "+rm(rec.amt));return;
  }
  if(g("data-acancelst")!==null){debtView();return}
  if(g("data-aedit")!==null){
    var d=debts().by[g("data-aedit")];if(!d)return;
    var f2=card.querySelector(".stmtForm");f2.open=true;f2.setAttribute("data-editing",d.id);
    f2.querySelector("[data-sm]").value=stmtMonth(d);f2.querySelector("[data-sa]").value=d.principal;f2.querySelector("[data-sd]").value=d.due||"";
    f2.querySelector("[data-stmtsum]").textContent="修改账单";f2.querySelector("[data-asave]").textContent="保存修改";f2.querySelector("[data-acancelst]").hidden=false;
    f2.scrollIntoView&&f2.scrollIntoView({block:"center",behavior:"smooth"});return;
  }
  if(g("data-adel")!==null){
    if(b.getAttribute("data-sure")!=="1"){b.setAttribute("data-sure","1");b.textContent="确认";setTimeout(function(){if(b.isConnected){b.removeAttribute("data-sure");b.innerHTML="×"}},3000);return}
    var id=g("data-adel"),ids=[id].concat(S.expenses.filter(function(x){var pr=payRef(x.cat);return pr&&pr.id===id}).map(function(x){return String(x.id)}));
    debtDel(ids);syncUI();debtView();return;
  }
  if(g("data-apay")!==null){
    var det=b.closest("details"),d3=debts().by[g("data-apay")],m3=det.querySelector("[data-apmsg]");if(!d3)return;
    var v=parseFloat(det.querySelector("[data-apamt]").value),dt=det.querySelector("[data-apdate]").value||today();
    if(!(v>0)){m3.textContent="请填金额";return}
    var pr=recordPay(d3,v,dt,0);syncUI();debtView();
    toast("还款已记录",rm(pr.rec.amt)+(debts().by[d3.id]&&debts().by[d3.id].settled?" · 这期已结清 🎉":""));return;
  }
  if(g("data-aattach")!==null){
    var box=b.parentNode,picked=Array.prototype.slice.call(box.querySelectorAll("[data-attach]:checked")).map(function(c){return c.getAttribute("data-attach")}),uni=box.querySelector("[data-attachspend]").checked,mm=box.querySelector("[data-aamsg]");
    if(!picked.length){mm.textContent="请先勾选要归入的欠款";return}
    picked.forEach(function(did){var d=debts().by[did];if(d)putRow({id:d.id,date:d.start,item:d.name,cat:debtCatOf(d,{acct:String(a.id),spend:uni?a.spend:d.spend}),amt:d.principal})});
    syncUI();debtView();toast(tl("已归入 {0} 笔",picked.length),a.name);
  }
});

/* ---- think ---- */
var RATES=[3,5,7];
function calc(){
  var a=parseFloat($("ta").value),f=$("tf").value,y=T.years;
  if(!(a>0)){$("res").innerHTML='<div class="empty">输入你想买的金额，看看存起来会变多少</div>';$("chart").innerHTML="";return}
  var custom=parseFloat($("tr").value);
  var list=RATES.slice();if(custom>=0&&RATES.indexOf(custom)<0)list.push(custom);
  var base=fv(a,f,5,y);
  var html='<h2>'+tl("存 {0} 年，实际会拿到",y)+'</h2><p class="big" style="margin-top:0">'+tl("投入本金 <b>{0}</b>",rm0(base.principal))+(f!=="once"?tl(f==="day"?"（{0} × 每天）":f==="week"?"（{0} × 每周）":"（{0} × 每月）",rm(a)):'')+'</p><div class="rates">';
  list.forEach(function(r){
    var o=fv(a,f,r,y);
    html+='<div class="rate'+(r===5?' on':'')+'"><div class="p">'+tl("{0}% / 年",r)+'</div><div class="fv">'+rm0(o.fv)+'</div><div class="pv">'+tl("赚了 {0}",rm0(o.fv-o.principal))+'</div><div class="pv">'+tl("现值 ≈ {0}",rm0(pv(o.fv,y)))+'</div></div>';
  });
  html+='</div><p class="msg">'+tl("「现值」= 扣掉 {0}% 通膨后，相当于今天的购买力。",S.set.infl)+'</p>';
  var o5=fv(a,f,5,y);
  html+='<div class="hint">'+tl("不买的话，这笔钱 {0} 年后（5%）≈ <b>{1}</b>，今天的购买力约 <b>{2}</b>。",y,rm0(o5.fv),rm0(pv(o5.fv,y)))+'</div>';
  $("res").innerHTML=html;
  chart(a,f,y,list);
}
function chart(a,f,y,list){
  var W=640,H=240,L=46,R=10,Tp=12,B=26,pw=W-L-R,ph=H-Tp-B,series=[],max=0;
  list.forEach(function(r){var pts=[];for(var k=0;k<=y;k++){pts.push(fv(a,f,r,k).fv)}series.push({r:r,p:pts});max=Math.max(max,pts[y])});
  var prin=[];for(var k=0;k<=y;k++)prin.push(fv(a,f,0,k).fv);
  if(max<=0)max=1;
  function X(k){return L+pw*k/y}function Y(v){return Tp+ph*(1-v/max)}
  var cols={3:"var(--c3)",5:"var(--c5)",7:"var(--c7)"};
  var s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="增长曲线">';
  for(var g=0;g<=4;g++){var v=max*g/4,yy=Y(v);s+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--line)"/><text x="'+(L-6)+'" y="'+(yy+4)+'" font-size="11" fill="var(--muted)" text-anchor="end">'+(v>=1000?Math.round(v/1000)+"k":Math.round(v))+'</text>'}
  var step=y<=10?1:y<=20?2:5;
  for(var k=0;k<=y;k+=step){s+='<text x="'+X(k)+'" y="'+(H-8)+'" font-size="11" fill="var(--muted)" text-anchor="middle">'+k+'y</text>'}
  s+='<polyline fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="5 4" points="'+prin.map(function(v,k){return X(k)+","+Y(v)}).join(" ")+'"/>';
  series.forEach(function(o){
    s+='<polyline fill="none" stroke="'+(cols[o.r]||"var(--warn)")+'" stroke-width="2.5" stroke-linejoin="round" points="'+o.p.map(function(v,k){return X(k)+","+Y(v)}).join(" ")+'"/>';
  });
  s+='</svg>';
  $("chart").innerHTML=s;
}
function yearChips(){
  var ys=[1,5,10,20,30];
  $("yrs").innerHTML=ys.map(function(y){return '<button class="chip" data-y="'+y+'" aria-pressed="'+(y===T.years)+'">'+tl("{0} 年",y)+'</button>'}).join("");
  $("ty").value=ys.indexOf(T.years)>=0?"":T.years;
}
$("yrs").addEventListener("click",function(e){var y=e.target.getAttribute("data-y");if(y){T.years=+y;yearChips();calc()}});
$("ty").addEventListener("input",function(){var y=parseInt(this.value,10);if(y>=1&&y<=60){T.years=y;Array.prototype.forEach.call($("yrs").children,function(b){b.setAttribute("aria-pressed",+b.getAttribute("data-y")===y)});calc()}});
["ta","tf","tr"].forEach(function(id){$(id).addEventListener("input",calc);$(id).addEventListener("change",calc)});

/* ---- summary ---- */
function sumView(){
  fillMonths($("sm"));
  var m=$("sm").value,rows=spent().filter(function(x){return x.date.slice(0,7)===m});
  var tot=0,av=0,bc={};
  rows.forEach(function(x){tot+=x.amt;if(AVOID[x.cat])av+=x.amt;bc[x.cat]=(bc[x.cat]||0)+x.amt});
  var sal=salaryFor(m),w=sal.wage,left=w-w*sal.ded/100-tot;
  $("stat").innerHTML='<div><small>总支出</small><strong>'+rm0(tot)+'</strong></div><div><small>不必要</small><strong class="warnv">'+rm0(av)+'</strong></div><div><small>Money Left</small><strong>'+(w?rm0(left):"—")+'</strong></div>';
  var keys=Object.keys(bc).sort(function(a,b){return bc[b]-bc[a]});
  $("cats").innerHTML=keys.length?keys.map(function(k){
    return '<div class="cat"><div class="t"><span>'+esc(k)+'</span><span class="amt">'+rm(bc[k])+'</span></div><div class="bar"><i class="'+(AVOID[k]?'av':'')+'" style="width:'+(tot?Math.max(2,bc[k]/tot*100):0)+'%"></i></div></div>';
  }).join(""):'<div class="empty">这个月还没有记录</div>';
  var b=$("avBox");
  if(av>0){var o=fv(av,"month",S.set.rate,10);b.hidden=false;
    b.innerHTML=tl('这个月「不必要」花了 <b>{0}</b>。如果每个月都省下这个数，存 10 年（{1}%）≈ <b>{2}</b>，现值约 {3}。',rm0(av),S.set.rate,rm0(o.fv),rm0(pv(o.fv,10)))}
  else b.hidden=true;
  cmpView(m);weekView();freeView();yearView();
  $("budTitle2").textContent=tl("{0} 预算",m);renderBudget($("budList2"),$("budCard2"),budgetRows(m));refreshPops();
}
function prevMonth(m,k){var y=+m.slice(0,4),n=+m.slice(5,7)-(k===undefined?1:k);while(n<1){n+=12;y--}return y+"-"+String(n).padStart(2,"0")}
function monthData(m,skipId){
  var o={tot:0,av:0,bc:{},n:0};
  spent().forEach(function(x){if(x.date.slice(0,7)!==m||(skipId!=null&&String(x.id)===String(skipId)))return;o.n++;o.tot+=x.amt;if(AVOID[x.cat])o.av+=x.amt;o.bc[x.cat]=(o.bc[x.cat]||0)+x.amt});
  return o;
}
function delta(cur,prev){
  var d=cur-prev;
  if(Math.abs(d)<0.005)return '<span class="flat">持平</span>';
  var pct=prev>0?" ("+(d>0?"+":"")+Math.round(d/prev*100)+"%)":"";
  return '<span class="'+(d>0?"up":"down")+'">'+(d>0?"▲ +":"▼ −")+rm0(Math.abs(d)).slice(3)+pct+'</span>';
}
function cmpView(m){
  var pm=prevMonth(m),c=monthData(m),p=monthData(pm);
  $("cmpTitle").textContent=m+" vs "+pm;
  if(!c.n&&!p.n){$("cmp").innerHTML='<div class="empty">这两个月都没有记录</div>';$("cmpNote").textContent="";}
  else{
    var rows=[["总支出",c.tot,p.tot],["不必要",c.av,p.av]];
    var keys=Object.keys(c.bc).concat(Object.keys(p.bc).filter(function(k){return !(k in c.bc)}));
    keys.sort(function(a,b){return Math.abs((c.bc[b]||0)-(p.bc[b]||0))-Math.abs((c.bc[a]||0)-(p.bc[a]||0))});
    keys.forEach(function(k){rows.push([k,c.bc[k]||0,p.bc[k]||0])});
    $("cmp").innerHTML=rows.map(function(r,i){
      return '<div class="cmp"><span class="n">'+(i<2?'<b>'+r[0]+'</b>':esc(r[0]))+'</span><span class="v">'+rm0(r[1])+'<small>'+tl("上月 {0}",rm0(r[2]))+'</small></span><span class="v" style="min-width:96px">'+delta(r[1],r[2])+'</span></div>';
    }).join("");
    $("cmpNote").textContent=(m===today().slice(0,7)?tl("这个月还没过完，数字会随着记账继续增加。"):"")+tl("▲ = 比上月多花（橙色），▼ = 比上月少花（绿色）。分类按变化最大的排前面。");
  }
  var ms=[],max=0;for(var k=5;k>=0;k--){var mm=prevMonth(m,k),d=monthData(mm);ms.push([mm,d]);max=Math.max(max,d.tot)}
  $("trend").innerHTML=ms.map(function(x){
    var d=x[1];return '<div class="tr"><span class="mo">'+x[0].slice(2)+'</span><div class="bar"><i style="width:'+(max?Math.max(d.tot?2:0,d.tot/max*100):0)+'%"></i></div><span class="amt">'+rm0(d.tot)+'</span></div>';
  }).join("");
}
$("sm").addEventListener("change",sumView);
[["si","infl"]].forEach(function(p){
  $(p[0]).addEventListener("input",function(){var v=parseFloat(this.value);S.set[p[1]]=isNaN(v)?0:v;S.setDirty=true;queue();syncUI();sumView();freeMiniView()});
});

/* ---- yearly report ---- */
var yrSel=null;
function yearsAvail(){
  var ys={};ys[today().slice(0,4)]=1;
  spent().forEach(function(x){ys[x.date.slice(0,4)]=1});
  S.expenses.forEach(function(x){if(x.cat===SKIP)ys[x.date.slice(0,4)]=1});
  return Object.keys(ys).sort().reverse();
}
function yearReport(y){
  var curM=today().slice(0,7),rows=[],cats={},tot=0,big=null,av=0,skipTot=0,skipN=0,fixed=0,inc=0,spentWithInc=0;
  var skipBy={};S.expenses.forEach(function(x){if(x.cat===SKIP&&x.date.slice(0,4)===y){skipBy[x.date.slice(0,7)]=(skipBy[x.date.slice(0,7)]||0)+x.amt;skipTot+=x.amt;skipN++}});
  var first=null;
  for(var i=1;i<=12;i++){var m=y+"-"+p2(i);if(m>curM)break;if(monthData(m).n>0||skipBy[m]){first=i;break}}
  if(first){
    for(var k=first;k<=12;k++){
      var mm=y+"-"+p2(k);if(mm>curM)break;
      var f=freeMoney(mm),sk=skipBy[mm]||0;
      var r={m:mm,inc:f.inc>0?f.inc:null,tot:f.tot,must:f.rec+f.cat+f.rep,free:f.freeSpent,skip:sk,bal:f.inc>0?f.inc-f.tot:null};
      rows.push(r);inc+=r.inc||0;fixed+=r.must;if(r.bal!==null)spentWithInc+=r.tot;
    }
  }
  spent().forEach(function(x){
    if(x.date.slice(0,4)!==y)return;
    tot+=x.amt;cats[x.cat]=(cats[x.cat]||0)+x.amt;if(AVOID[x.cat])av+=x.amt;
    if(!x.ro&&(!big||x.amt>big.amt))big=x;
  });
  var active=rows.filter(function(r){return r.tot>0}),peak=null;
  active.forEach(function(r){if(!peak||r.tot>peak.tot)peak=r});
  var catList=Object.keys(cats).sort(function(a,b){return cats[b]-cats[a]}).map(function(c){return {cat:c,amt:cats[c],pct:tot>0?cats[c]/tot*100:0}});
  var bal=inc>0?inc-spentWithInc:null;
  return {year:y,rows:rows,tot:tot,inc:inc,bal:bal,rate:inc>0&&bal!==null?bal/inc*100:null,months:active.length,avg:active.length?tot/active.length:0,peak:peak,big:big,av:av,skip:skipTot,skipN:skipN,fixed:fixed,cats:catList};
}
function yearView(){
  var ys=yearsAvail(),cur=yrSel&&ys.indexOf(yrSel)>=0?yrSel:ys[0];yrSel=cur;
  $("yrSel").innerHTML=ys.map(function(y){return '<option>'+y+'</option>'}).join("");$("yrSel").value=cur;
  var r=yearReport(cur),partial=cur===today().slice(0,4);
  $("yrTitle").textContent=tl("{0} 年度报表",cur)+(partial?tl("（至今）"):"");
  if(!r.rows.length){$("yrBody").innerHTML='<div class="empty">'+tl("{0} 年还没有记录",cur)+'</div>';return}
  var max=Math.max.apply(null,r.rows.map(function(x){return x.tot}).concat([1]));
  var tiles='<div class="stat"><div><small>全年支出</small><strong>'+rm0(r.tot)+'</strong></div><div><small>月均</small><strong>'+rm0(r.avg)+'</strong></div><div><small>'+(r.rate!==null?"储蓄率":"结余")+'</small><strong class="'+(r.rate!==null&&r.rate<0?"warnv":"")+'">'+(r.rate!==null?Math.round(r.rate)+"%":"—")+'</strong></div></div>';
  var head='<div class="yr head"><span>月</span><span></span><span style="text-align:right">支出</span><span class="bal">结余</span></div>';
  var list=r.rows.map(function(x){
    var b=x.bal===null?"—":(x.bal>=0?"+":"−")+rm0(Math.abs(x.bal)).slice(3);
    return '<div class="yr"><span class="mo">'+tl("{0}月",x.m.slice(5))+'</span><div class="bar"><i style="width:'+Math.max(x.tot>0?2:0,x.tot/max*100)+'%"></i></div><span class="amt">'+rm0(x.tot)+'</span><span class="bal '+(x.bal===null?"flat":x.bal<0?"up":"down")+'">'+b+'</span></div>';
  }).join("");
  var tr='<div class="yr tot"><span></span><span></span><span class="amt">'+rm0(r.tot)+'</span><span class="bal">'+(r.bal===null?"—":(r.bal>=0?"+":"−")+rm0(Math.abs(r.bal)).slice(3))+'</span></div>';
  var cmax=r.cats.length?r.cats[0].amt:1;
  var cats=r.cats.slice(0,8).map(function(c){return '<div class="cat"><div class="t"><span>'+esc(c.cat)+'</span><span class="amt">'+rm0(c.amt)+' · '+Math.round(c.pct)+'%</span></div><div class="bar"><i class="'+(AVOID[c.cat]?"av":"")+'" style="width:'+Math.max(2,c.amt/cmax*100)+'%"></i></div></div>'}).join("");
  var rest=r.cats.slice(8).reduce(function(t,c){return t+c.amt},0);
  if(rest>0)cats+='<div class="cat"><div class="t"><span>'+tl("其他（{0} 类）",r.cats.length-8)+'</span><span class="amt">'+rm0(rest)+' · '+Math.round(rest/r.tot*100)+'%</span></div></div>';
  var hi=[];
  if(r.peak)hi.push(tl("最花钱的月份：<b>{0} 月</b>（{1}）",r.peak.m.slice(5),rm0(r.peak.tot)));
  if(r.big)hi.push(tl("最大的一笔：<b>{0}</b> {1}（{2}）",esc(r.big.item),rm0(r.big.amt),r.big.date.slice(5)));
  if(r.fixed>0)hi.push(tl("每月必花合计：<b>{0}</b>（固定支出、必花分类、欠款还款），占全年支出 {1}%",rm0(r.fixed),Math.round(r.fixed/r.tot*100)));
  if(r.av>0)hi.push(tl("「不必要」共花了 <b>{0}</b>，占 {1}%",rm0(r.av),Math.round(r.av/r.tot*100)));
  if(r.skipN>0)hi.push(tl("忍住了 <b>{0}</b> 次，省下 <b>{1}</b> 🎉",r.skipN,rm0(r.skip)));
  if(r.inc>0)hi.push(tl(r.bal>=0?"收入 {0}，结余 {1}":"收入 {0}，超支 {1}",rm0(r.inc),rm0(Math.abs(r.bal))));
  $("yrBody").innerHTML=tiles+'<div style="margin-top:14px">'+head+list+tr+'</div><h3 style="margin:16px 0 4px;font-size:13px;color:var(--muted);font-weight:600">分类占比</h3>'+cats+
    (hi.length?'<ul class="wins">'+hi.map(function(x){return '<li>'+x+'</li>'}).join("")+'</ul>':'');
}
function yearSummaryCSV(y){
  var r=yearReport(y),n=function(v){return v===null?"":(Math.round(v*100)/100).toFixed(2)};
  var out=[tl("年度报表,{0}",y),tl("月份,收入,支出,必花,自由支出,忍住省下,结余")];
  r.rows.forEach(function(x){out.push([x.m,n(x.inc),n(x.tot),n(x.must),n(x.free),n(x.skip),n(x.bal)].join(","))});
  out.push(["合计",n(r.inc),n(r.tot),n(r.fixed),n(r.rows.reduce(function(t,x){return t+x.free},0)),n(r.skip),n(r.bal)].join(","));
  out.push("","分类,金额,占比");
  r.cats.forEach(function(c){out.push([csvCell(c.cat),n(c.amt),(Math.round(c.pct*10)/10).toFixed(1)+"%"].join(","))});
  return out.join("\n");
}
function yearTxCSV(y){
  var rows=spent().filter(function(x){return x.date.slice(0,4)===y}).sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:a.id-b.id});
  return "date,item,category,amount\n"+rows.map(function(x){return [x.date,csvCell(x.item),csvCell(x.cat),(Math.round(x.amt*100)/100).toFixed(2)].join(",")}).join("\n");
}
function downloadText(name,text){
  var b=new Blob(["\ufeff"+text],{type:"text/csv;charset=utf-8"}),u=URL.createObjectURL(b),a=document.createElement("a");
  a.href=u;a.download=name;document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(u);if(a.parentNode)a.parentNode.removeChild(a)},1500);
}
$("yrSel").addEventListener("change",function(){yrSel=this.value;yearView()});
$("yrCopy").addEventListener("click",function(){
  var t=yearSummaryCSV(yrSel);$("yrText").hidden=false;$("yrText").value=t;
  var done=function(){$("yrMsg").textContent=tl("已复制 {0} 年汇总，可以贴到 Excel 或 Google Sheet。",yrSel)},fail=function(){$("yrText").select();$("yrMsg").textContent="请手动复制上面的文字。"};
  try{navigator.clipboard.writeText(t).then(done,fail)}catch(e){fail()}
});
$("yrDlSum").addEventListener("click",function(){downloadText("pocket-ledger-"+yrSel+"-summary.csv",yearSummaryCSV(yrSel));$("yrMsg").textContent="已生成汇总文件。"});
$("yrDlTx").addEventListener("click",function(){downloadText("pocket-ledger-"+yrSel+"-transactions.csv",yearTxCSV(yrSel));$("yrMsg").textContent="已生成明细文件。"});
$("yrPrint").addEventListener("click",function(){
  document.body.classList.add("print-year");
  var off=function(){document.body.classList.remove("print-year");window.removeEventListener("afterprint",off)};
  window.addEventListener("afterprint",off);
  try{window.print()}finally{setTimeout(off,1000)}
});

/* ---- backup ---- */
function csvCell(s){s=String(s);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function parseCSV(t){
  var rows=[],r=[],c="",q=false;
  for(var i=0;i<t.length;i++){var ch=t[i];
    if(q){if(ch==='"'){if(t[i+1]==='"'){c+='"';i++}else q=false}else c+=ch}
    else if(ch==='"')q=true;
    else if(ch===','){r.push(c);c=""}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&t[i+1]==='\n')i++;r.push(c);c="";if(r.length>1||r[0])rows.push(r);r=[]}
    else c+=ch;
  }
  r.push(c);if(r.length>1||r[0])rows.push(r);return rows;
}
$("exp").addEventListener("click",function(){
  var t="date,item,category,amount\n"+S.expenses.slice().sort(function(a,b){return a.date<b.date?-1:1}).map(function(x){return [x.date,csvCell(x.item),csvCell(x.cat),x.amt].join(",")}).join("\n");
  $("ta2").value=t;
  var done=function(){$("bkMsg").textContent="已复制。把它贴到备忘录或笔记里保存。"};
  try{navigator.clipboard.writeText(t).then(done,function(){$("ta2").select();$("bkMsg").textContent="请手动复制上面的文字。"})}catch(e){$("ta2").select();$("bkMsg").textContent="请手动复制上面的文字。"}
});
$("imp").addEventListener("click",function(){
  var rows=parseCSV($("ta2").value.trim()),n=0;
  rows.forEach(function(r,i){
    if(r.length<4||r[0].toLowerCase()==="date")return;
    var a=parseFloat(r[3]);if(!/^\d{4}-\d{2}-\d{2}$/.test(r[0])||!(a>=0))return;
    var rec={id:Date.now()+i,date:r[0],item:r[1],cat:(r[2]||"").trim()||"Unnecessary",amt:a};
    S.expenses.push(rec);S.pending.push({op:"add",row:rec});n++;
  });
  queue();syncUI();$("bkMsg").textContent=n?tl("导入了 {0} 笔",n):"没有读到有效的行（格式：date,item,category,amount）";sumView();
});
$("clr").addEventListener("click",function(){
  if(this.getAttribute("data-sure")!=="1"){this.setAttribute("data-sure","1");this.textContent="再按一次确认清空";var b=this;setTimeout(function(){b.removeAttribute("data-sure");b.textContent="清空全部"},3000);return}
  S.expenses.forEach(function(x){S.pending.push({op:"del",id:x.id})});S.expenses=[];S.records.forEach(function(x){S.pending.push({op:"rdel",id:x.id})});S.records=[];queue();syncUI();this.removeAttribute("data-sure");this.textContent="清空全部";$("bkMsg").textContent="已清空";sumView();
});



/* ---- plug the money features into the platform ---- */
PL.on("init",function(){
  $("fc").innerHTML=CATS.map(function(c){return '<option>'+c+(AVOID[c]?'':'')+'</option>'}).join("");
  $("fd").value=today();$("ds").value=today();
  $("swm").value=today().slice(0,7);$("si").value=S.set.infl;payInputs();payListView();
  $("tr").value="";T.years=S.set.years||10;
  $("bcs").innerHTML=CATS.map(function(c){return '<option>'+c+'</option>'}).join("");
  yearChips();listView();budSetView();
  $("rc").innerHTML=CATS.map(function(c){return '<option>'+c+'</option>'}).join("");
  recForm(false);
  recurTick();
});
PL.on("show:think",calc);PL.on("show:sum",sumView);PL.on("show:log",listView);PL.on("show:save",saveView);PL.on("show:debt",debtView);
PL.on("settings",function(){fillSettings();recurView();mustChipsView()});
PL.on("synced",function(){fillSettings();recurTick()});
PL.on("online",recurTick);PL.on("visible",recurTick);
PL.on("sheet:close",function(name){
  if(name==="Entry"&&editId!==null)endEdit();
  if(name==="P_dformCard"&&debtEditId!==null)endDebtEdit();
});
PL.on("pop:open",function(id){if(id==="dformCard"&&debtEditId!==null)endDebtEdit()});
PL.on("pops",function(){var bb=document.querySelector('[data-pop="budCard2"]');if(bb)bb.hidden=$("budCard2").hidden});
(function(){
  PL.sub("ins",function(){try{var n=homeInsights().length;return n?tl("{0} 条",n):""}catch(e){return ""}});
  var cm=function(){return today().slice(0,7)};
  PL.sub("goal",function(){var n=goals().length;return n?tl("{0} 个",n):"还没设"});
  PL.sub("slist",function(){var n=S.expenses.filter(function(x){return x.cat===SKIP}).length;return n?tl("{0} 次",n):""});
  PL.sub("acct",function(){var n=accounts().length;return n?tl("{0} 个",n):""});
  PL.sub("dlist",function(){var n=debts().filter(function(d){return !d.settled&&!d.acct}).length;return n?tl("{0} 笔未还清",n):""});
  PL.sub("week",function(){var w=weekData(latestWeek(),7);return weekHasActivity(w)?tl("上周 {0}",rm0(w.tot)):""});
  PL.sub("free",function(){var f=freeMoney(cm());return f.wage>0?(f.left<0?tl("超支 {0}",rm0(-f.left)):tl("还剩 {0}",rm0(f.left))):"先设薪水"});
  PL.sub("bud",function(){var r=budgetRows(cm()),o=r.filter(function(x){return x.state==="over"}).length;return r.length?tl("{0} 项",r.length)+(o?tl("，{0} 项超支",o):""):""});
  PL.sub("pay",function(){var w=salaryFor(cm()).wage;return w>0?tl("{0} / 月",rm0(w)):"未设"});
  PL.sub("budset",function(){var r=budgetRows(cm());return r.length?tl("{0} 项",r.length):"未设"});
  PL.sub("must",function(){var n=Object.keys(mustSet()).length;return n?tl("{0} 类",n):"未设"});
  PL.sub("rec",function(){var n=recurs().length;return n?tl("{0} 项",n):"没有"});
})();
