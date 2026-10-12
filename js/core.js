/* core.js
   Pocket Ledger core: state + storage, helpers, toasts, pop-out windows, sync, tabs, settings page frame, language engine. Loaded before the feature files; no feature-specific code belongs here. */
/* PL: the small platform every feature plugs into.
   events  PL.on(name, fn) / PL.emit(name, arg): "init" "show:<page>" "settings" "synced" "online" "visible" "data" "sheet:close" "pop:open"
   rows    PL.sub(name, fn): the grey summary text on a settings/overview row
   modules PL.module({id, title, page, home, settings, init, en}) adds a page + bottom tab, a home card and settings rows (see below) */
var PL={_ev:{},_sub:{},_mods:{},ready:false};
PL.on=function(e,f){(PL._ev[e]=PL._ev[e]||[]).push(f)};
PL.emit=function(e,a){(PL._ev[e]||[]).slice().forEach(function(f){try{f(a)}catch(x){if(window.console)console.error("PL "+e,x)}})};
PL.sub=function(name,fn){PL._sub[name]=fn};
var KEY="pocketledger.v1";
var CKEY="pocketledger.cfg";
var S={expenses:[],records:[],set:{wage:0,ded:13.46,infl:3,rate:5,years:10},pending:[],setDirty:false};
var C={url:"",token:""};
var T={years:10};
var PAGES=["log","think","save","debt","sum","set"];   /* every page id, in order; modules add theirs before "set" */
var cur="log",lastMain="log",syncing=false,timer=null,lastErr="",lastOk="",recBackend=null;   /* recBackend: does the sheet backend know Records? (null = not asked yet) */

function load(){try{var r=localStorage.getItem(KEY);if(r){var o=JSON.parse(r);if(o&&o.expenses)S.expenses=o.expenses;if(o&&Array.isArray(o.records))S.records=o.records;if(o&&o.set)for(var k in o.set)S.set[k]=o.set[k];if(o&&o.pending)S.pending=o.pending;S.setDirty=!!(o&&o.setDirty);}}catch(e){}
  try{var c=localStorage.getItem(CKEY);if(c){var p=JSON.parse(c);C.url=p.url||"";C.token=p.token||"";}}catch(e){}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S));}catch(e){}}
function saveCfg(){try{localStorage.setItem(CKEY,JSON.stringify(C));}catch(e){}}


/* ---- feedback: toast after saving, celebration after a skipped purchase ---- */
var toastTimer=null,celeTimer=null;
function reduceMotion(){try{return window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){return false}}
function toast(title,sub,warn,bad){
  var el=$("toast");
  el.innerHTML='<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg><div><b>'+esc(title)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+(warn?'<small class="tw'+(bad?" bad":"")+'">'+esc(warn).replace(/\n/g,"<br>")+'</small>':'')+'</div>';
  el.classList.remove("show");void el.offsetWidth;el.classList.add("show");
  clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.classList.remove("show")},warn?5200:2100);
}
var CHEERS=["每一次忍住，都是在给未来的自己存钱。","意志力 +1！","今天的你，比昨天更自由。","小小的坚持，会变成大大的复利。","钱留住了，未来更轻松。","你做到了，继续保持！","忍住的不是钱，是主动权。"];
var MILESTONES=[100,200,500,1000,2000,5000,10000,20000];
function endCelebrate(){
  var el=document.getElementById("celebrate");clearTimeout(celeTimer);
  if(!el)return;el.removeAttribute("id");el.classList.add("out");setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el)},260);
}
function celebrate(amt,before,after,count,goalLine,goalHit){
  endCelebrate();
  var ms="";
  if(count===1)ms="第一次忍住，好的开始！";
  else MILESTONES.forEach(function(m){if(before<m&&after>=m)ms=tl("累计省下突破 {0}！",rm0(m))});
  var el=document.createElement("div");el.id="celebrate";el.className="celebrate";el.setAttribute("role","status");
  el.innerHTML='<div class="card2"><div class="big2">🎉</div><h3>太棒了，忍住了！</h3><div class="amt2">'+rm(amt)+'</div><p>'+CHEERS[Math.floor(Math.random()*CHEERS.length)]+'</p><p>'+tl('累计已省 <b>{0}</b>（{1} 次）',rm(after),count)+'</p>'+(ms?'<div class="ms">'+ms+'</div>':'')+(goalLine?'<div class="goal'+(goalHit?' hit':'')+'">'+goalLine+'</div>':'')+'<div class="tip">点任意位置继续</div></div>';
  if(!reduceMotion()){
    var c=document.createElement("div");c.className="confetti";var cols=["#ff3b30","#ff9500","#ffcc00","#34c759","#0a84ff","#af52de","#ff2d55"];
    for(var i=0;i<34;i++){var p=document.createElement("i");
      p.style.cssText="--x:"+Math.round(Math.random()*100)+"vw;--dx:"+Math.round(Math.random()*160-80)+"px;--r:"+Math.round(Math.random()*900-450)+"deg;--t:"+(1.9+Math.random()*1.3).toFixed(2)+"s;--d:"+(Math.random()*.5).toFixed(2)+"s;--c:"+cols[i%cols.length];
      c.appendChild(p)}
    el.insertBefore(c,el.firstChild);   /* behind the card so it never covers the text */
  }
  document.body.appendChild(el);
  celeTimer=setTimeout(endCelebrate,3600);
}
/* any tap or key press dismisses the celebration, and still reaches whatever is underneath */
document.addEventListener("pointerdown",function(){if(document.getElementById("celebrate"))endCelebrate()},true);
document.addEventListener("keydown",function(){if(document.getElementById("celebrate"))endCelebrate()},true);

/* ---- pop-out windows (bottom sheets): 记一笔 and 明细 ---- */
var sheetStack=[],sheetOpener=null;
function sheetOpen(name){return sheetStack.indexOf(name)>=0}
function openSheet(name,opener){
  var el=$("sheet"+name);if(!el)return;
  if(!sheetOpen(name)){sheetStack.push(name);el.classList.add("on");sheetOpener=opener||document.activeElement}
  document.body.classList.add("sheet-open");applyInert();
  el.style.zIndex=50+sheetStack.length;
  var first=name==="Entry"?$("fa"):name==="Hist"?$("fq"):el.querySelector(".lkbtn");
  setTimeout(function(){if(sheetOpen(name)&&first&&first.focus)first.focus()},60);
}
function closeSheet(name){
  var i=sheetStack.indexOf(name);if(i<0)return;
  sheetStack.splice(i,1);$("sheet"+name).classList.remove("on");
  PL.emit("sheet:close",name);
  if(!sheetStack.length)document.body.classList.remove("sheet-open");
  applyInert();
  refreshPops();
  var o=sheetOpener;if(!sheetStack.length&&o&&o.isConnected&&o.focus&&!locked)try{o.focus()}catch(e){}
}
/* info cards become pop-out windows: each [data-pop] button opens the element it names, which is moved into its own sheet (ids are kept) */
function openPop(id){if($("sheetP_"+id))openSheet("P_"+id,document.querySelector('[data-pop="'+id+'"]'))}
function closePop(id){closeSheet("P_"+id)}
function makePop(b){
  var id=b.getAttribute("data-pop");
  if($("sheetP_"+id))return;
  var tgt=$(id);if(!tgt)return;
  var sh=document.createElement("div");sh.className="sheet pop";sh.id="sheetP_"+id;sh.setAttribute("role","dialog");sh.setAttribute("aria-modal","true");sh.setAttribute("aria-labelledby","shT_"+id);
  var label=b.querySelector(".rbt").textContent.replace(/^＋\s*/,"");
  sh.innerHTML='<div class="shbg" data-close="P_'+id+'"></div><div class="shpanel"><div class="shbar"><h2 id="shT_'+id+'"></h2><button class="lkbtn" data-close="P_'+id+'" style="margin:0">完成</button></div><div class="shbody"></div></div>';
  sh.querySelector("h2").textContent=label;
  sh.querySelector(".shbody").appendChild(tgt);
  document.body.appendChild(sh);
  Array.prototype.forEach.call(sh.querySelectorAll("[data-close]"),function(x){x.addEventListener("click",function(){closeSheet("P_"+id)})});
}
function buildPops(){
  Array.prototype.forEach.call(document.querySelectorAll("[data-pop]"),makePop);
  document.addEventListener("click",function(e){
    var b=e.target.closest&&e.target.closest("[data-pop]");if(!b||b.hidden)return;
    var id=b.getAttribute("data-pop");
    PL.emit("pop:open",id);
    openPop(id);
  });
}
function refreshPops(){
  try{
    Array.prototype.forEach.call(document.querySelectorAll("[data-sub]"),function(el){var f=PL._sub[el.getAttribute("data-sub")];el.textContent=f?f():""});
    PL.emit("pops");
  }catch(e){}
}
PL.sub("lang",function(){return LANG==="en"?"English":"中文"});
PL.sub("sync",function(){return C.url&&C.token?(lastErr?"同步失败":"已连接"):"未连接"});
function closeAllSheets(){sheetStack.slice().reverse().forEach(closeSheet)}
Array.prototype.forEach.call(document.querySelectorAll("[data-close]"),function(b){b.addEventListener("click",function(){closeSheet(b.getAttribute("data-close"))})});
document.addEventListener("keydown",function(e){
  if(e.key==="Escape"&&sheetStack.length&&!padState){closeSheet(sheetStack[sheetStack.length-1]);e.preventDefault()}
});
/* keep Tab / Shift+Tab inside the top window, like a proper modal dialog */
function sheetFocusables(top){
  return Array.prototype.filter.call(top.querySelectorAll('button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])'),function(x){
    if(x.disabled||x.getClientRects().length===0)return false;
    for(var d=x.closest("details");d;d=d.parentElement&&d.parentElement.closest("details")){if(!d.open&&!(x.tagName==="SUMMARY"&&x.parentNode===d))return false}   /* inside a folded section */
    return true;
  });
}
var lastShift=false;
document.addEventListener("keydown",function(e){
  if(e.key!=="Tab")return;
  lastShift=e.shiftKey;
  if(!sheetStack.length||padState)return;
  var top=$("sheet"+sheetStack[sheetStack.length-1]),els=sheetFocusables(top);
  if(!els.length)return;
  var first=els[0],last=els[els.length-1],act=document.activeElement,inside=top.contains(act);
  if(e.shiftKey&&(act===first||!inside)){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&(act===last||!inside)){e.preventDefault();first.focus()}
},true);
/* safety net for browsers whose Tab order differs (Safari skips buttons by default): focus may never leave the window */
document.addEventListener("focusout",function(){
  if(!sheetStack.length||padState)return;
  setTimeout(function(){
    if(!sheetStack.length||padState)return;
    var top=$("sheet"+sheetStack[sheetStack.length-1]);
    if(top.contains(document.activeElement))return;
    var els=sheetFocusables(top);if(els.length)(lastShift?els[els.length-1]:els[0]).focus();
  },0);
},true);

/* ---- sync: local-first, pending ops are replayed idempotently (add = upsert by id, del by id) ---- */
function isRecOp(op){return op.op==="radd"||op.op==="rdel"}
function applyOp(op){
  if(op.op==="add"){S.expenses=S.expenses.filter(function(x){return String(x.id)!==String(op.row.id)});S.expenses.push(op.row)}
  else if(op.op==="del"){S.expenses=S.expenses.filter(function(x){return String(x.id)!==String(op.id)})}
  else if(op.op==="radd"){S.records=S.records.filter(function(x){return String(x.id)!==String(op.row.id)});S.records.push(op.row)}
  else if(op.op==="rdel"){S.records=S.records.filter(function(x){return String(x.id)!==String(op.id)})}
}
function queue(op){if(op)S.pending.push(op);save();clearTimeout(timer);timer=setTimeout(syncNow,600)}
function syncUI(){
  refreshPops();
  var el=$("syncBar"),n=S.pending.length+(S.setDirty?1:0);
  if(!C.url||!C.token){el.textContent="未连接 Google Sheet（只存在本机）";el.className="sync";return}
  if(lastErr){el.textContent=tl("同步失败，已存本机{0}：稍后会自动重试",n?tl("（{0} 项待同步）",n):"");el.className="sync err";return}
  el.className="sync";
  el.textContent=syncing?"同步中…":(n?tl("{0} 项待同步",n):(lastOk?tl("已同步 {0}",lastOk):"已连接"));
}
function syncNow(){
  if(!C.url||!C.token||syncing||!navigator.onLine)return Promise.resolve();
  syncing=true;syncUI();
  var sent=S.pending.slice(),sendSet=S.setDirty,snap=JSON.stringify(S.set);
  var body={token:C.token,action:"sync",ops:sent};
  if(sendSet)body.settings=S.set;
  var ok=false;
  return fetch(C.url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(body),redirect:"follow"})
    .then(function(r){return r.json()})
    .then(function(res){
      if(!res||!res.ok)throw new Error(res&&res.error||"error");
      recBackend=Array.isArray(res.records);
      S.pending=S.pending.filter(function(o){return sent.indexOf(o)<0||(!recBackend&&isRecOp(o))});   /* a backend without the Records sheet keeps them waiting */
      S.expenses=res.expenses||[];
      if(recBackend)S.records=res.records;
      S.pending.forEach(applyOp);
      if(sendSet){if(JSON.stringify(S.set)===snap)S.setDirty=false}
      else if(!S.setDirty&&res.settings){for(var k in res.settings)S.set[k]=res.settings[k]}
      var d=new Date();lastOk=String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
      lastErr="";ok=true;save();PL.emit("synced");PL.emit("data");tab(cur);
    })
    .catch(function(e){lastErr=String(e&&e.message||e)})
    .then(function(){
      syncing=false;syncUI();
      var live=S.pending.filter(function(o){return !(recBackend===false&&isRecOp(o))}).length;
      if(ok&&(live||S.setDirty))queue();
      else if(!ok&&(S.pending.length||S.setDirty)){clearTimeout(timer);timer=setTimeout(syncNow,30000)}
    });
}
function $(id){return document.getElementById(id)}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function rm(n){return "RM "+Number(n).toLocaleString("en-MY",{minimumFractionDigits:2,maximumFractionDigits:2})}
function rm0(n){return "RM "+Math.round(n).toLocaleString("en-MY")}
function today(){var d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}

/* ---- tabs ---- */
function tab(t){
  cur=t;
  PAGES.forEach(function(k){$("p-"+k).hidden=k!==t});
  if(t!=="set")lastMain=t;
  $("setBtn").textContent=t==="set"?"完成":"⚙ 设置";
  Array.prototype.forEach.call($("nav").querySelectorAll("button"),function(b){b.setAttribute("aria-selected",b.getAttribute("data-t")===t)});
  PL.emit("show:"+t);if(t==="set")settingsView();
  window.scrollTo(0,0);
}
$("nav").addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("button[data-t]");if(b)tab(b.getAttribute("data-t"))});

/* ---- settings page ---- */
function settingsView(){
  PL.emit("settings");syncUI();
}
function jumpTo(id){openPop(id)}
$("setBtn").addEventListener("click",function(){tab(cur==="set"?lastMain:"set")});
document.addEventListener("click",function(e){
  var g=e.target.closest&&e.target.closest("[data-go]");
  if(g){closeAllSheets();tab(g.getAttribute("data-go"));var j=g.getAttribute("data-jump");if(j)setTimeout(function(){jumpTo(j)},50);return}
});
function openSync(){closeAllSheets();tab("set");setTimeout(function(){jumpTo("syncCard")},50)}
$("syncBar").addEventListener("click",function(){if(!C.url||!C.token||lastErr)openSync()});
$("syncBar").addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();$("syncBar").click()}});

/* ---- sync settings ---- */
$("cs").addEventListener("click",function(){
  var u=$("cu").value.trim(),t=$("ct").value.trim();
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[^\s]+\/exec$/.test(u)||!t){$("syncMsg").textContent="请填 script.google.com 的 /exec 网址和密钥";return}
  C.url=u;C.token=t;saveCfg();lastErr="";$("syncMsg").textContent="正在同步…";
  syncNow().then(function(){$("syncMsg").textContent=lastErr?tl("失败：{0}",lastErr):"已连接并同步 ✓"});
});
$("cx").addEventListener("click",function(){C.url="";C.token="";saveCfg();$("cu").value="";$("ct").value="";lastErr="";lastOk="";$("syncMsg").textContent="已断开（本机数据保留）";syncUI()});

/* ---- language (中文 / English) ----
   The app is written in Chinese. English mode translates the page as it is drawn: exact phrases (EN), sentence patterns (EN_RX),
   for text nodes and for placeholder / title / aria-label. Switching language stores the choice and reloads, so zh is always the untouched source. */
var LANG=(function(){try{return localStorage.getItem("pocketledger.lang")==="en"?"en":"zh"}catch(e){return "zh"}})();
var CJK=/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;

/* tl(template, ...args): a sentence with {0} {1} slots (and {0|one|many} plurals) - the Chinese text is the key, English comes from EN_T */
function tl(zh){
  var a=arguments,s=zh;
  if(LANG==="en")s=EN_T[zh]!==undefined?EN_T[zh]:(EN[zh]!==undefined?EN[zh]:zh);
  return s.replace(/\{(\d+)\|([^|}]*)\|([^}]*)\}/g,function(_,i,one,many){return +a[+i+1]===1?one:many}).replace(/\{(\d+):mon\}/g,function(_,i){return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+a[+i+1]-1]||a[+i+1]}).replace(/\{(\d+)\}/g,function(_,i){var v=a[+i+1];return (LANG==="en"&&typeof v==="string"&&CJK.test(v))?trText(v):v});
}
function trText(s){
  if(!CJK.test(s))return s;
  var m=/^(\s*)([\s\S]*?)(\s*)$/.exec(s),core=m[2],hit=EN[core];
  if(hit===undefined){
    for(var i=0;i<EN_RX.length;i++){var r=EN_RX[i][0].exec(core);if(r){hit=core.replace(EN_RX[i][0],EN_RX[i][1]);break}}
  }
  if(hit===undefined){try{if(window.__untr)window.__untr(s)}catch(e){}return s}
  return m[1]+hit+m[3];
}
var TR_ATTRS=["placeholder","title","aria-label"];
function trNode(n){
  if(n.nodeType===3){var v=n.nodeValue,t=trText(v);if(t!==v)n.nodeValue=t;return}
  if(n.nodeType!==1)return;
  var tag=n.tagName;if(tag==="SCRIPT"||tag==="STYLE")return;
  trAttrs(n);
  if(tag==="TEXTAREA")return;
  for(var c=n.firstChild;c;c=c.nextSibling)trNode(c);
}
function trAttrs(n){TR_ATTRS.forEach(function(a){if(n.hasAttribute(a)){var v=n.getAttribute(a),t=trText(v);if(t!==v)n.setAttribute(a,t)}})}
function startLang(){
  document.documentElement.lang=LANG==="en"?"en":"zh-CN";
  Array.prototype.forEach.call(document.querySelectorAll("[data-lang]"),function(b){b.setAttribute("aria-pressed",b.getAttribute("data-lang")===LANG)});
  $("langChips").addEventListener("click",function(e){
    var b=e.target.closest&&e.target.closest("[data-lang]");if(!b)return;
    var l=b.getAttribute("data-lang");if(l===LANG)return;
    try{localStorage.setItem("pocketledger.lang",l)}catch(x){}
    location.reload();
  });
  if(LANG!=="en")return;
  document.title=trText(document.title);
  trNode(document.body);
  new MutationObserver(function(ms){
    ms.forEach(function(m){
      if(m.type==="characterData")trNode(m.target);
      else if(m.type==="attributes")trAttrs(m.target);
      else Array.prototype.forEach.call(m.addedNodes,trNode);
    });
  }).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:TR_ATTRS});
}


PL.on("init",function(){$("cu").value=C.url;$("ct").value=C.token});

/* a pop-out window that has no row of its own (opened from code): PL.popup(id, title, html) then openPop(id); PL.popTitle(id, text) renames it */
PL.popup=function(id,title,html){
  if($("sheetP_"+id))return id;
  var card=document.createElement("div");card.innerHTML=html;var el=card.firstElementChild;el.id=el.id||id;
  $("setHold").appendChild(el);
  var fake=document.createElement("button");fake.setAttribute("data-pop",id);fake.innerHTML='<span class="rbt"></span>';fake.querySelector(".rbt").textContent=title;
  makePop(fake);
  return id;
};
PL.popTitle=function(id,text,icon){
  var h=$("shT_"+id);if(!h)return;
  h.textContent="";
  if(icon)h.appendChild(document.createTextNode(icon+" "));
  var sp=document.createElement("span");sp.textContent=text;h.appendChild(sp);
};

/* ---- modules ----
   PL.module({
     id:"counter",                       // unique, lower-case letters/digits
     title:"计数",                        // name (Chinese source text; give an English one in en)
     page:{tab:{label:"计数",icon:"<svg…>"},html:"<div class='card'>…</div>"},   // optional: a page + bottom tab
     home:{id:"counterHome",html:"…",render:function(el){…}},                   // optional: a card on the home page, re-rendered on "show:log" and "data"
     settings:[{id:"counterSet",label:"计数",sub:function(){…},html:"<div class='card' id='counterSet'>…</div>"}],  // optional rows in 设置, each opens its card as a pop-out window
     init:function(){…}, show:function(){…},                                    // optional hooks
     en:{exact:{"计数":"Counter"},tpl:{"今天 {0} 次":"{0} today"}}              // English text tables, merged before the page is drawn
   }) */
PL.module=function(spec){
  if(!spec||!/^[a-z][a-z0-9]*$/.test(spec.id||"")||PL._mods[spec.id])return null;
  PL._mods[spec.id]=spec;
  var draws=[];
  if(spec.en){for(var k in (spec.en.exact||{}))EN[k]=spec.en.exact[k];for(var t in (spec.en.tpl||{}))EN_T[t]=spec.en.tpl[t]}
  if(spec.page){
    var sec=document.createElement("section");sec.id="p-"+spec.id;sec.hidden=true;sec.innerHTML=spec.page.html||"";
    $("p-set").parentNode.insertBefore(sec,$("p-set"));
    PAGES.splice(PAGES.indexOf("set"),0,spec.id);
    if(spec.page.tab){
      var b=document.createElement("button");b.setAttribute("role","tab");b.setAttribute("data-t",spec.id);b.setAttribute("aria-selected","false");
      b.innerHTML=(spec.page.tab.icon||"")+esc(spec.page.tab.label||spec.title||spec.id);
      $("nav").querySelector(".in").appendChild(b);
    }
    if(spec.show)PL.on("show:"+spec.id,spec.show);
  }
  if(spec.home){
    var hc=document.createElement("div");hc.className="card";hc.id=spec.home.id||("home_"+spec.id);hc.innerHTML=spec.home.html||"";
    $("modCards").appendChild(hc);
    var draw=function(){if(spec.home.render)spec.home.render(hc)};
    PL.on("show:log",draw);PL.on("data",draw);draws.push(draw);
  }
  (spec.settings||[]).forEach(function(r){
    var card=document.createElement("div");card.innerHTML=r.html||"";card.firstElementChild.id=card.firstElementChild.id||r.id;
    $("setHold").appendChild(card.firstElementChild);
    var btn=document.createElement("button");btn.className="rowbtn";btn.setAttribute("data-pop",r.id);
    btn.innerHTML='<span class="rbt"></span><span class="rbsub" data-sub="'+esc("mod_"+r.id)+'"></span><span class="rbc" aria-hidden="true">›</span>';
    btn.querySelector(".rbt").textContent=r.label;
    $("setRows").appendChild(btn);
    if(r.sub)PL.sub("mod_"+r.id,r.sub);
    makePop(btn);
  });
  /* the module's own set-up and first drawing wait until the saved data has been loaded ("init"); a module added later starts at once */
  var start=function(){draws.forEach(function(f){f()});if(spec.init)spec.init();refreshPops();if(LANG==="en")trNode(document.body)};
  if(PL.ready)start();else PL.on("init",start);
  return spec;
};
