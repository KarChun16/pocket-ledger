/* records.js
   Records: the one generic place for everything that is "something happened at a time" (a cigarette, a clock-in, a glass of water...).
   Stored locally in S.records and synced to the Records sheet, like expenses: local first, queued, idempotent (same id = same row).
   Every new feature module keeps its data here under its own module name, so the sheet backend never has to change again.
     row = {id, mod, date:"yyyy-mm-dd", time:"HH:MM" or "", val:number, text:string (<=200), extra:string (<=500, usually JSON)} */
PL.rec=(function(){
  var lastId=0;
  function newId(){lastId=Math.max(Date.now(),lastId+1);return lastId}
  function pad(n){return String(n).padStart(2,"0")}
  function now(){var d=new Date();return pad(d.getHours())+":"+pad(d.getMinutes())}
  function clean(o,id){
    var mod=String(o.mod||"");if(!/^[a-z][a-z0-9_-]{0,23}$/.test(mod))return null;
    var date=o.date||today();if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
    var time=o.time===undefined||o.time===null?"":String(o.time);
    if(time==="now")time=now();
    if(time!==""&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return null;
    var val=Number(o.val);if(!isFinite(val))val=0;
    var extra=o.extra===undefined||o.extra===null?"":(typeof o.extra==="string"?o.extra:JSON.stringify(o.extra));
    return {id:id,mod:mod,date:date,time:time,val:Math.round(val*1000)/1000,text:String(o.text||"").trim().slice(0,200),extra:extra.slice(0,500)};
  }
  function put(row){applyOp({op:"radd",row:row});queue({op:"radd",row:row});PL.emit("data");return row}
  var R={
    /* add a record; o = {mod, date?, time? ("now" ok), val?, text?, extra? (object or string)}; returns the row, or null if it is not valid */
    add:function(o){var r=clean(o||{},newId());return r?put(r):null},
    /* change an existing record (same id = same row everywhere); patch = any of the fields above */
    update:function(id,patch){
      var old=R.get(id);if(!old)return null;
      var r=clean({mod:old.mod,date:old.date,time:old.time,val:old.val,text:old.text,extra:old.extra,...patch,mod:old.mod},old.id);
      return r?put(r):null;
    },
    del:function(id){
      if(!R.get(id))return false;
      applyOp({op:"rdel",id:id});queue({op:"rdel",id:id});PL.emit("data");return true;
    },
    get:function(id){return S.records.filter(function(x){return String(x.id)===String(id)})[0]||null},
    /* records of one module, oldest first; f = {from?, to?} (dates, inclusive) */
    list:function(mod,f){
      f=f||{};
      return S.records.filter(function(x){return x.mod===mod&&(!f.from||x.date>=f.from)&&(!f.to||x.date<=f.to)}).sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:a.time<b.time?-1:a.time>b.time?1:a.id-b.id});
    },
    data:function(row){try{return row.extra?JSON.parse(row.extra):{}}catch(e){return {}}}
  };
  return R;
})();
