/* lock.js
   App lock: PIN + optional Face ID / Touch ID. */
/* ---- app lock: privacy screen with a PIN and optional Face ID / Touch ID (WebAuthn) ----
   Stored only on this device (never synced): {hash,salt,iter,len,bio:{id}|null,timeout:minutes,fails,until} */
var LKEY="pocketledger.lock",L=null,locked=false,hiddenAt=0,lastActive=Date.now(),padState=null,bioOK=false;
var PIN_MIN=4,PIN_MAX=8;
function loadLock(){try{var r=localStorage.getItem(LKEY);L=r?JSON.parse(r):null;if(!L||!L.hash)L=null}catch(e){L=null}}
function saveLock(){try{if(L)localStorage.setItem(LKEY,JSON.stringify(L));else localStorage.removeItem(LKEY)}catch(e){}}
function lockSupported(){return !!(window.crypto&&crypto.subtle&&window.isSecureContext)}
function b64(buf){var a=new Uint8Array(buf),t="";for(var i=0;i<a.length;i++)t+=String.fromCharCode(a[i]);return btoa(t)}
function unb64(s){var t=atob(s),a=new Uint8Array(t.length);for(var i=0;i<t.length;i++)a[i]=t.charCodeAt(i);return a}
function pbkdf2(pin,salt,iter){
  return crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]).then(function(k){
    return crypto.subtle.deriveBits({name:"PBKDF2",salt:salt,iterations:iter,hash:"SHA-256"},k,256)}).then(b64);
}
function hashPin(pin){var salt=crypto.getRandomValues(new Uint8Array(16)),iter=150000;return pbkdf2(pin,salt,iter).then(function(h){return {hash:h,salt:b64(salt),iter:iter,len:pin.length}})}
function checkPin(pin){return pbkdf2(pin,unb64(L.salt),L.iter).then(function(h){return h===L.hash})}
function waitLeft(){return L&&L.until>Date.now()?Math.ceil((L.until-Date.now())/1000):0}
var lockInert=false;
function setInert(on){lockInert=on;applyInert()}
function applyInert(){
  var bg=lockInert||sheetStack.length>0;
  [document.querySelector(".wrap"),$("nav")].forEach(function(el){if(!el)return;if(bg){el.setAttribute("inert","");el.setAttribute("aria-hidden","true")}else{el.removeAttribute("inert");el.removeAttribute("aria-hidden")}});
  var t=$("toast");if(t){if(lockInert){t.setAttribute("inert","");t.setAttribute("aria-hidden","true")}else{t.removeAttribute("inert");t.removeAttribute("aria-hidden")}}
  Array.prototype.forEach.call(document.querySelectorAll(".sheet"),function(h){var i=sheetStack.indexOf(h.id.slice(5));if(i>=0&&i<sheetStack.length-1)h.setAttribute("inert","");else h.removeAttribute("inert")})
}
function padRender(){
  var st=padState;if(!st)return;
  var n=st.free?Math.max(st.buf.length,PIN_MIN):st.len;
  $("lkDots").innerHTML=Array.apply(null,Array(n)).map(function(_,i){return '<i class="'+(i<st.buf.length?"on":"")+'"></i>'}).join("");
  var w=waitLeft();
  $("lkErr").textContent=w?tl("错太多次了，请 {0} 秒后再试",w):(st.err||"");
  Array.prototype.forEach.call($("lkPad").querySelectorAll("button"),function(b){b.disabled=!!w&&b.getAttribute("data-k")!=="bio"});
  var left=$("lkPad").querySelector('[data-k="left"]');
  if(st.free){left.textContent="确定";left.disabled=!!w||st.buf.length<PIN_MIN;left.setAttribute("data-act","ok")}
  else if(st.bio&&L&&L.bio){left.textContent="面容";left.disabled=false;left.setAttribute("data-act","bio")}
  else{left.textContent="";left.disabled=true;left.removeAttribute("data-act")}
  $("lkSub").textContent=st.sub;$("lkTitle").textContent=st.title;
  $("lkBio").hidden=!(st.bio&&L&&L.bio);$("lkCancel").hidden=!st.cancel;$("lkForgot").hidden=!st.forgot;
  if(!st.forgot)$("lkReset").hidden=true;
}
function buildPad(){
  var keys=["1","2","3","4","5","6","7","8","9","left","0","del"];
  $("lkPad").innerHTML=keys.map(function(k){
    return k==="left"?'<button class="sm" data-k="left" type="button"></button>':k==="del"?'<button class="sm" data-k="del" type="button" aria-label="删除">⌫</button>':'<button data-k="'+k+'" type="button">'+k+'</button>';
  }).join("");
}
function padShow(st){
  padState=st;st.buf="";st.err=st.err||"";
  $("lock").classList.add("on");setInert(true);
  padRender();tickWait();
}
function padHide(){
  padState=null;$("lock").classList.remove("on");
  if(!locked){setInert(false);document.documentElement.classList.remove("locked")}
}
var waitTimer=null;
function tickWait(){clearInterval(waitTimer);if(!waitLeft())return;waitTimer=setInterval(function(){padRender();if(!waitLeft())clearInterval(waitTimer)},1000)}
function padFail(msg){
  if(!L)return;
  L.fails=(L.fails||0)+1;
  if(L.fails>=5)L.until=Date.now()+Math.min(900,30*Math.pow(2,L.fails-5))*1000;
  saveLock();
  padState.buf="";padState.err=waitLeft()?"":tl("{0}（还能试 {1} 次）",msg||"PIN 不对",5-L.fails);
  var d=$("lkDots");d.classList.remove("shake");void d.offsetWidth;d.classList.add("shake");
  padRender();tickWait();
}
function padSubmit(){
  var st=padState;if(!st||st.busy)return;
  var pin=st.buf;
  if(st.mode==="new"||st.mode==="confirm"){if(pin.length<PIN_MIN)return;var r=st.resolve;padHide();r(pin);return}
  st.busy=true;
  checkPin(pin).then(function(ok){
    st.busy=false;if(padState!==st)return;
    if(ok){L.fails=0;L.until=0;saveLock();
      if(st.mode==="unlock")unlock();else{var r=st.resolve;padHide();r(true)}}
    else padFail();
  });
}
function padPress(k){
  var st=padState;if(!st||st.busy||waitLeft())return;
  if(k==="del")st.buf=st.buf.slice(0,-1);
  else if(k==="ok"){padSubmit();return}
  else if(k==="bio"){bioUnlock();return}
  else if(/^\d$/.test(k)&&st.buf.length<(st.free?PIN_MAX:st.len))st.buf+=k;
  st.err="";padRender();
  if(!st.free&&st.buf.length===st.len)padSubmit();
}
function prompt2(o){return new Promise(function(resolve){o.resolve=resolve;o.cancel=o.mode!=="unlock";padShow(o)})}
function lockNow(){
  if(!L)return;
  closeAllSheets();
  locked=true;document.documentElement.classList.add("locked");
  endCelebrate();if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
  document.body.classList.remove("shield");
  padShow({mode:"unlock",title:"Pocket Ledger",sub:"输入 PIN 解锁",len:L.len,bio:true,forgot:true});
  if(L.bio&&!waitLeft())setTimeout(function(){if(locked&&padState&&padState.mode==="unlock")bioUnlock()},250);
  lockView();
}
function unlock(){
  locked=false;lastActive=Date.now();padHide();
  document.documentElement.classList.remove("locked");setInert(false);document.body.classList.remove("shield");
  $("lkReset").hidden=true;lockView();
}
$("lkPad").addEventListener("click",function(e){
  var b=e.target.closest&&e.target.closest("button");if(!b||b.disabled)return;
  var k=b.getAttribute("data-k");
  padPress(k==="left"?(b.getAttribute("data-act")||""):k);
});
document.addEventListener("keydown",function(e){
  if(!padState)return;
  if(/^\d$/.test(e.key)){padPress(e.key);e.preventDefault()}
  else if(e.key==="Backspace"){padPress("del");e.preventDefault()}
  else if(e.key==="Enter"&&padState.free){padPress("ok");e.preventDefault()}
  else if(e.key==="Escape"&&padState.cancel){$("lkCancel").click()}
},true);
$("lkCancel").addEventListener("click",function(){var st=padState;if(!st||!st.cancel)return;var r=st.resolve;padHide();r(null)});
$("lkBio").addEventListener("click",function(){bioUnlock()});
$("lkForgot").addEventListener("click",function(){$("lkReset").hidden=!$("lkReset").hidden});
$("lkResetGo").addEventListener("click",function(){
  var b=this;
  if(b.getAttribute("data-sure")!=="1"){b.setAttribute("data-sure","1");b.textContent="再按一次确认清除";setTimeout(function(){b.removeAttribute("data-sure");b.textContent="清除本机数据并重置"},4000);return}
  try{[KEY,CKEY,LKEY,WKSEEN].forEach(function(k){localStorage.removeItem(k)})}catch(e){}
  location.reload();
});
/* Face ID / Touch ID through WebAuthn: the device verifies the person, we check the "user verified" flag */
function bioAvailable(){
  try{return window.PublicKeyCredential&&PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable&&navigator.credentials?PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(function(v){return !!v},function(){return false}):Promise.resolve(false)}catch(e){return Promise.resolve(false)}
}
function bioEnable(){
  var rnd=function(n){return crypto.getRandomValues(new Uint8Array(n))};
  return navigator.credentials.create({publicKey:{challenge:rnd(32),rp:{name:"Pocket Ledger"},user:{id:rnd(16),name:"owner",displayName:"Pocket Ledger"},
    pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],authenticatorSelection:{authenticatorAttachment:"platform",userVerification:"required"},timeout:60000,attestation:"none"}})
  .then(function(c){L.bio={id:b64(c.rawId)};saveLock()});
}
function bioUnlock(){
  if(!L||!L.bio||!padState||padState.mode!=="unlock"||waitLeft())return;
  var id=unb64(L.bio.id);
  navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),allowCredentials:[{type:"public-key",id:id}],userVerification:"required",timeout:60000}}).then(function(c){
    var ad=new Uint8Array(c.response.authenticatorData),same=b64(c.rawId)===L.bio.id,verified=ad.length>32&&(ad[32]&4)===4;
    if(same&&verified){L.fails=0;L.until=0;saveLock();unlock()}
    else if(padState){padState.err="面容 / 指纹没有通过，请输入 PIN";padRender()}
  },function(){/* cancelled: stay on the PIN pad */});
}
/* locking rules: leaving the app, idling, or the lock button */
document.addEventListener("visibilitychange",function(){
  if(!L)return;
  if(document.hidden){hiddenAt=Date.now();if(!locked)document.body.classList.add("shield");if(L.timeout===0&&!locked)lockNow()}
  else{
    if(!locked){document.body.classList.remove("shield");if(L.timeout>0&&Date.now()-hiddenAt>=L.timeout*60000)lockNow()}
    else if(L.bio&&padState&&padState.mode==="unlock"&&!waitLeft())setTimeout(function(){if(locked)bioUnlock()},250);
  }
});
window.addEventListener("pagehide",function(){if(L&&!locked)document.body.classList.add("shield")});
window.addEventListener("pageshow",function(){if(!locked)document.body.classList.remove("shield")});
["pointerdown","keydown","scroll","touchstart"].forEach(function(ev){document.addEventListener(ev,function(){lastActive=Date.now()},true)});
setInterval(function(){if(L&&!locked&&!document.hidden&&Date.now()-lastActive>=Math.max(L.timeout,1)*60000)lockNow()},5000);
$("lockBtn").addEventListener("click",function(){lockNow()});
/* settings card */
var TIMEOUTS=[[0,"每次离开 app 就锁"],[1,"1 分钟"],[5,"5 分钟"],[15,"15 分钟"],[60,"1 小时"]];
function lockView(){
  $("lockBtn").hidden=!L;
  var h="";
  if(!lockSupported())h='<div class="empty" style="padding:8px 0">这个浏览器环境不支持应用锁（需要 https 网址）。</div>';
  else if(!L)h='<button class="btn" id="lkOn">设置 PIN 并开启应用锁</button><div class="msg" id="lkMsg"></div>';
  else h='<div class="fr"><span class="k">状态</span><span class="v">'+tl("已开启 · {0} 位 PIN",L.len)+'</span></div>'+
    '<div class="fr"><span class="k">自动锁定</span><span class="v"><select id="lkTimeout" style="width:auto;min-height:36px;padding:6px 12px">'+TIMEOUTS.map(function(t){return '<option value="'+t[0]+'"'+(t[0]===L.timeout?" selected":"")+'>'+t[1]+'</option>'}).join("")+'</select></span></div>'+
    (bioOK?'<div class="fr"><span class="k">面容 / 指纹解锁</span><span class="v">'+(L.bio?'已开启':'未开启')+'</span></div>':'')+
    '<div class="row" style="margin-top:12px">'+(bioOK?'<button class="btn ghost small" id="lkBioTog">'+(L.bio?"关闭面容 / 指纹":"开启面容 / 指纹")+'</button>':'')+
    '<button class="btn ghost small" id="lkNow">立即锁定</button><button class="btn ghost small" id="lkChange">更改 PIN</button><button class="btn ghost small" id="lkOff">关闭应用锁</button></div><div class="msg" id="lkMsg"></div>';
  $("lockBody").innerHTML=h;
}
var lkMsgN=0;
function lkMsg(t){var m=$("lkMsg");if(m){var n=++lkMsgN;m.textContent=t;setTimeout(function(){if(m.isConnected&&n===lkMsgN)m.textContent=""},3500)}}
function newPinFlow(){
  return prompt2({mode:"new",title:"设置 PIN",sub:tl("输入 {0} 到 {1} 位数字，再点「确定」",PIN_MIN,PIN_MAX),free:true}).then(function(p1){
    if(!p1)return null;
    return prompt2({mode:"confirm",title:"再输入一次",sub:"确认你的 PIN",free:true}).then(function(p2){
      if(!p2)return null;
      if(p1!==p2){lkMsg("两次输入不一致，没有改动");return null}
      return p1;
    });
  });
}
function verifyFlow(title){return L?prompt2({mode:"verify",title:title||"输入当前 PIN",sub:"需要先验证你的 PIN",len:L.len}):Promise.resolve(true)}
$("lockBody").addEventListener("click",function(e){
  var b=e.target.closest&&e.target.closest("button");if(!b)return;
  var id=b.id;
  if(id==="lkOn"){newPinFlow().then(function(pin){if(!pin)return;hashPin(pin).then(function(r){L={hash:r.hash,salt:r.salt,iter:r.iter,len:r.len,bio:null,timeout:1,fails:0,until:0};saveLock();lastActive=Date.now();lockView();toast("应用锁已开启","以后打开 app 需要 PIN")})})}
  else if(id==="lkNow")lockNow();
  else if(id==="lkChange"){verifyFlow().then(function(ok){if(!ok)return;newPinFlow().then(function(pin){if(!pin)return;hashPin(pin).then(function(r){L.hash=r.hash;L.salt=r.salt;L.iter=r.iter;L.len=r.len;L.fails=0;L.until=0;saveLock();lockView();toast("PIN 已更改")})})})}
  else if(id==="lkOff"){verifyFlow("关闭应用锁").then(function(ok){if(!ok)return;L=null;saveLock();$("lockBtn").hidden=true;lockView();toast("应用锁已关闭")})}
  else if(id==="lkBioTog"){
    if(L.bio){L.bio=null;saveLock();lockView();toast("已关闭面容 / 指纹解锁")}
    else bioEnable().then(function(){lockView();toast("面容 / 指纹解锁已开启","下次锁屏时可以直接验证")},function(){lkMsg("没有开启：验证被取消或设备不支持")});
  }
});
$("lockBody").addEventListener("change",function(e){if(e.target.id==="lkTimeout"&&L){L.timeout=+e.target.value;saveLock()}});
buildPad();loadLock();
bioAvailable().then(function(v){bioOK=v;lockView()});
lockView();
if(L)lockNow();
else document.documentElement.classList.remove("locked");



PL.on("settings",lockView);
PL.sub("lock",function(){return L?"已开启":"未开启"});
