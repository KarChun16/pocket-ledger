/* init.js
   Start-up sequence. Loaded last. The features do their own set-up on the "init" event. */
load();buildPops();
PL.emit("init");
syncUI();
startLang();
syncNow();
window.addEventListener("online",function(){PL.emit("online");syncNow()});
document.addEventListener("visibilitychange",function(){if(!document.hidden){PL.emit("visible");syncNow()}});
if("serviceWorker" in navigator&&location.protocol.indexOf("http")===0)navigator.serviceWorker.register("sw.js").catch(function(){});
