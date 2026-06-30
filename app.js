"use strict";
const $=id=>document.getElementById(id);
const DB="MSS_V01", SS="sentences", VS="vocab", AS="audioCache";
const App={db:null,sentences:[],vocab:[],analysed:[],importMode:"sentences",
  mandarinVoice:null,currentAudio:null,currentAudioResolve:null,elevenAbort:null,
  playbackContext:"main",cur:{book:"",chapter:"",group:1,index:0}};

const Util={esc:s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])),clean:s=>String(s??"").replace(/^["']|["']$/g,"").trim(),uniq:a=>[...new Set(a)],nat:(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:"base"}),sleep:ms=>new Promise(r=>setTimeout(r,ms)),gnum:s=>Math.floor((Number(s.order)-1)/10)+1,sortS:(a,b)=>String(a.book).localeCompare(String(b.book))||String(a.chapter).localeCompare(String(b.chapter),undefined,{numeric:true,sensitivity:"base"})||Number(a.order)-Number(b.order)};

const Storage={open(){return new Promise((res,rej)=>{let r=indexedDB.open(DB,1);r.onupgradeneeded=e=>{let d=e.target.result;if(!d.objectStoreNames.contains(SS))d.createObjectStore(SS,{keyPath:"id",autoIncrement:true});if(!d.objectStoreNames.contains(VS))d.createObjectStore(VS,{keyPath:"id",autoIncrement:true});if(!d.objectStoreNames.contains(AS))d.createObjectStore(AS,{keyPath:"key"});};r.onsuccess=e=>res(e.target.result);r.onerror=e=>rej(e.target.error);});},store(n,m="readonly"){return App.db.transaction(n,m).objectStore(n);},all(n){return new Promise((res,rej)=>{let r=this.store(n).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});},get(n,k){return new Promise((res,rej)=>{let r=this.store(n).get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});},put(n,o){return new Promise((res,rej)=>{let t=App.db.transaction(n,"readwrite");t.objectStore(n).put(o);t.oncomplete=res;t.onerror=()=>rej(t.error);});},addMany(store,items){return new Promise((res,rej)=>{let t=App.db.transaction(store,"readwrite"),s=t.objectStore(store);items.forEach(x=>s.add(x));t.oncomplete=res;t.onerror=()=>rej(t.error);});},clear(n){return new Promise((res,rej)=>{let r=this.store(n,"readwrite").clear();r.onsuccess=res;r.onerror=()=>rej(r.error);});}};

/* ── Tone utilities ─────────────────────────────────────────────────────── */
const Tones={
  _t1:/[āēīōūǖĀĒĪŌŪǕ]/,_t2:/[áéíóúǘÁÉÍÓÚǗ]/,_t3:/[ǎěǐǒǔǚǍĚǏǑǓǙ]/,_t4:/[àèìòùǜÀÈÌÒÙǛ]/,
  detect(s){if(this._t1.test(s))return 1;if(this._t2.test(s))return 2;if(this._t3.test(s))return 3;if(this._t4.test(s))return 4;return 0;},
  _vm:["aeiouü","āēīōūǖ","áéíóúǘ","ǎěǐǒǔǚ","àèìòùǜ"],
  change(syl,from,to){
    let s=syl,fm=this._vm[from],tm=this._vm[to];
    for(let i=0;i<6;i++){
      if(s.includes(fm[i]))return s.replace(fm[i],tm[i]);
      let u=fm[i].toUpperCase();if(s.includes(u))return s.replace(u,tm[i].toUpperCase());
    }
    return s;
  },
  /* Apply tone sandhi rules to a pinyin string */
  sandhi(pinyin){
    // Split preserving whitespace and punctuation tokens
    let toks=pinyin.split(/(\s+|[,。！？、·；：…]+)/);
    let syls=toks.map((t,i)=>({t,i,s:/\S/.test(t)&&!/^[,。！？、·；：…]+$/.test(t)}));
    let sl=syls.filter(x=>x.s);
    let res=[...toks];
    for(let j=0;j<sl.length;j++){
      let {t:s,i}=sl[j],tone=this.detect(s),next=sl[j+1],nt=next?this.detect(next.t):0,out=s;
      // Rule 1: 3rd + 3rd → 2nd + 3rd
      if(tone===3&&nt===3)out=this.change(s,3,2);
      // Rule 2: bù before 4th → bú
      if(s==="bù"&&nt===4)out="bú";
      // Rule 3: yī sandhi (not final)
      if(s==="yī"&&next){if(nt===4)out="yí";else if(nt>=1&&nt<=3)out="yì";}
      res[i]=out;
    }
    return res.join("");
  },
  /* Return HTML string with tone-coloured spans (CSS classes t0–t4) */
  html(pinyin,useSandhi=false){
    if(!pinyin)return"";
    let text=useSandhi?this.sandhi(pinyin):pinyin;
    return text.split(/(\s+)/).map(tok=>{
      if(/^\s*$/.test(tok))return tok;
      return`<span class="t${this.detect(tok)}">${Util.esc(tok)}</span>`;
    }).join("");
  },
  /* Return HTML string with word-index-coloured spans (CSS classes w0–w5) */
  wordHtml(pinyin,useSandhi=false){
    if(!pinyin)return"";
    let text=useSandhi?this.sandhi(pinyin):pinyin;
    let wi=0;
    return text.split(/(\s+)/).map(tok=>{
      if(/^\s*$/.test(tok))return tok;
      return`<span class="w${wi++%6}">${Util.esc(tok)}</span>`;
    }).join("");
  },
  /* Return HTML string for hanzi with word-index colours matching wordHtml */
  hanziWordHtml(hanzi){
    if(!hanzi)return"";
    let wi=0;
    return[...hanzi].map(c=>{
      if(/[\s，。！？、；：…·]/u.test(c))return Util.esc(c);
      return`<span class="w${wi++%6}">${Util.esc(c)}</span>`;
    }).join("");
  },
  /* Colour pinyin using current mode (tone or word) */
  colourPinyin(pinyin,useSandhi=false){
    return $("colourMode")?.value==="word"?this.wordHtml(pinyin,useSandhi):this.html(pinyin,useSandhi);
  },
  /* Colour hanzi using current mode (tone mode = plain text; word mode = word colours) */
  colourHanzi(hanzi){
    if(!hanzi)return"";
    return $("colourMode")?.value==="word"?this.hanziWordHtml(hanzi):Util.esc(hanzi);
  }
};

/* ── Library ────────────────────────────────────────────────────────────── */
const Library={
  _csv(text){
    text=String(text||"").replace(/^﻿/,"");
    let rows=[],row=[],f="",q=false;
    for(let i=0;i<text.length;i++){let c=text[i],n=text[i+1];if(c==='"'&&q&&n==='"'){f+='"';i++;}else if(c==='"')q=!q;else if(c===","&&!q){row.push(f);f="";}else if((c==="\n"||c==="\r")&&!q){if(c==="\r"&&n==="\n")i++;row.push(f);f="";if(row.some(x=>x.trim()))rows.push(row);row=[];}else f+=c;}
    row.push(f);if(row.some(x=>x.trim()))rows.push(row);
    return rows;
  },
  parseSentencesCSV(text,defs){
    let rows=this._csv(text);if(!rows.length)return[];
    let heads=rows[0].map(x=>x.trim().toLowerCase());
    let has=heads.includes("pinyin")||heads.includes("hanzi")||heads.includes("english")||heads.includes("italian");
    let data=has?rows.slice(1):rows;
    let idx=ns=>{for(let n of ns){let i=heads.indexOf(n);if(i>=0)return i;}return-1;};
    let bi=idx(["book"]),ci=idx(["chapter","lesson","unit"]),oi=idx(["order","number","no","#"]),
        pi=idx(["pinyin","romanisation","romanization","roman","display"]),
        hi=idx(["hanzi","characters","simplified","chinese","audio"]),
        ei=idx(["english","translation","meaning","en"]);
    return data.map((r,i)=>{
      let pinyin="",hanzi="",english="";
      if(has){pinyin=pi>=0?r[pi]:"";hanzi=hi>=0?r[hi]:"";english=ei>=0?r[ei]:"";}
      else if(r.length>=3){pinyin=r[0];hanzi=r[1];english=r[2];}
      else{pinyin=r[0];}
      return{book:Util.clean(has&&bi>=0?r[bi]:defs.book),chapter:Util.clean(has&&ci>=0?r[ci]:defs.chapter),order:Number(Util.clean(has&&oi>=0?r[oi]:i+1))||i+1,pinyin:Util.clean(pinyin),hanzi:Util.clean(hanzi),english:Util.clean(english),bookmarked:false,difficult:false,notes:""};
    }).filter(x=>x.pinyin||x.hanzi);
  },
  parseVocabCSV(text){
    let rows=this._csv(text);if(!rows.length)return[];
    let heads=rows[0].map(x=>x.trim().toLowerCase());
    let has=heads.includes("pinyin")||heads.includes("hanzi")||heads.includes("english");
    let data=has?rows.slice(1):rows;
    let idx=ns=>{for(let n of ns){let i=heads.indexOf(n);if(i>=0)return i;}return-1;};
    let pi=idx(["pinyin","romanisation","romanization"]),hi=idx(["hanzi","characters","simplified","chinese"]),
        ei=idx(["english","translation","meaning","en"]),ki=idx(["category","cat","type","group","class"]);
    return data.map((r,i)=>{
      let pinyin="",hanzi="",english="",category="";
      if(has){pinyin=pi>=0?r[pi]:"";hanzi=hi>=0?r[hi]:"";english=ei>=0?r[ei]:"";category=ki>=0?r[ki]:"";}
      else if(r.length>=4){pinyin=r[0];hanzi=r[1];english=r[2];category=r[3];}
      else if(r.length>=3){pinyin=r[0];hanzi=r[1];english=r[2];}
      else{pinyin=r[0];}
      return{pinyin:Util.clean(pinyin),hanzi:Util.clean(hanzi),english:Util.clean(english),category:Util.clean(category),bookmarked:false};
    }).filter(x=>x.pinyin||x.hanzi);
  },
  chapter(){return App.sentences.filter(s=>s.book==App.cur.book&&s.chapter==App.cur.chapter).sort(Util.sortS);},
  group(){return this.chapter().filter(s=>Util.gnum(s)==Number(App.cur.group));},
  current(){let g=this.group();if(!g.length)return null;App.cur.index=Math.max(0,Math.min(App.cur.index,g.length-1));return g[App.cur.index];},
  async refresh(){
    App.sentences=(await Storage.all(SS)).sort(Util.sortS);
    App.vocab=(await Storage.all(VS)).sort((a,b)=>Util.nat(a.pinyin,b.pinyin));
    if(App.sentences.length&&!App.cur.book){let s=App.sentences[0];App.cur={book:s.book,chapter:s.chapter,group:Util.gnum(s),index:0};}
    UI.renderAll();
  }
};

/* ── UI ─────────────────────────────────────────────────────────────────── */
const UI={
  fill(sel,vals,val,label=x=>x){sel.innerHTML="";if(!vals.length){sel.innerHTML="<option>—</option>";return;}vals.forEach(v=>{let o=document.createElement("option");o.value=v;o.textContent=label(v);if(String(v)==String(val))o.selected=true;sel.appendChild(o);});},
  renderAll(){this.renderSelectors();this.renderTree();this.renderViewer();VocabDrill.render();this.stats();},
  renderSelectors(){
    let books=Util.uniq(App.sentences.map(s=>s.book)).sort(Util.nat);
    if(!books.includes(App.cur.book)&&books[0])App.cur.book=books[0];
    let ch=Util.uniq(App.sentences.filter(s=>s.book==App.cur.book).map(s=>s.chapter)).sort(Util.nat);
    if(!ch.includes(App.cur.chapter)&&ch[0])App.cur.chapter=ch[0];
    let gs=Util.uniq(App.sentences.filter(s=>s.book==App.cur.book&&s.chapter==App.cur.chapter).map(Util.gnum)).sort((a,b)=>a-b);
    if(!gs.includes(Number(App.cur.group))&&gs[0])App.cur.group=gs[0];
    this.fill($("bookSel"),books,App.cur.book);this.fill($("chapterSel"),ch,App.cur.chapter);this.fill($("groupSel"),gs.map(String),String(App.cur.group),g=>"Group "+g);
  },
  renderTree(){
    let t=$("tree");t.innerHTML="";
    if(!App.sentences.length){t.innerHTML='<p class="small">No sentences yet. Import a CSV to begin.</p>';return;}
    Util.uniq(App.sentences.map(s=>s.book)).sort(Util.nat).forEach(b=>{
      let bd=document.createElement("div");bd.className="book "+(App.cur.book==b?"active":"");bd.textContent=b;
      bd.onclick=()=>{App.cur.book=b;App.cur.chapter="";App.cur.group=1;App.cur.index=0;UI.renderAll();};t.appendChild(bd);
      Util.uniq(App.sentences.filter(s=>s.book==b).map(s=>s.chapter)).sort(Util.nat).forEach(c=>{
        let cd=document.createElement("div");cd.className="chapter "+(App.cur.book==b&&App.cur.chapter==c?"active":"");cd.textContent=c;
        cd.onclick=()=>{App.cur.book=b;App.cur.chapter=c;App.cur.group=1;App.cur.index=0;UI.renderAll();};t.appendChild(cd);
        if(App.cur.book==b&&App.cur.chapter==c)Util.uniq(App.sentences.filter(s=>s.book==b&&s.chapter==c).map(Util.gnum)).sort((a,b)=>a-b).forEach(g=>{
          let gd=document.createElement("div");gd.className="groupItem "+(Number(App.cur.group)==g?"active":"");gd.textContent="Group "+g;
          gd.onclick=()=>{App.cur.group=g;App.cur.index=0;UI.renderAll();};t.appendChild(gd);
        });
      });
    });
  },
  card(s,active,i){
    let showEn=$("showEnglish").value!=="hide";
    let d=document.createElement("div");d.className="card "+(active?"active":"");
    const selectCard=()=>{if(i!==undefined)SentenceController.jumpToIndex(i);};
    d.onclick=selectCard;
    d.addEventListener("touchend",e=>{if(e.target.closest("button"))return;e.preventDefault();selectCard();},{passive:false});
    let pinyinHTML=Tones.colourPinyin(s.pinyin);
    d.innerHTML=`<span class="pill">${s.order}</span>${s.bookmarked?'<span class="pill">★</span>':""}<div class="pinyin-text">${pinyinHTML}</div>${s.hanzi?`<div class="hanzi-text">${Tones.colourHanzi(s.hanzi)}</div>`:""} ${showEn&&s.english?`<div class="english">${Util.esc(s.english)}</div>`:""}<div class="cardTools"><button class="mini light" data-a="play">Play</button><button class="mini light" data-a="bm">★</button><button class="mini light" data-a="edit">Edit</button></div>`;
    d.querySelector('[data-a="play"]').onclick=async e=>{e.stopPropagation();await Speech.speak(s.hanzi||s.pinyin);};
    d.querySelector('[data-a="bm"]').onclick=async e=>{e.stopPropagation();s.bookmarked=!s.bookmarked;await Storage.put(SS,s);await Library.refresh();};
    d.querySelector('[data-a="edit"]').onclick=e=>{e.stopPropagation();Editor.open(s);};
    return d;
  },
  renderViewer(){
    let v=$("viewer");v.innerHTML="";
    if(!App.sentences.length){v.innerHTML='<div class="card"><h3>No sentences yet</h3><p>Import a CSV to begin.<br><br>Columns: <strong>book, chapter, order, pinyin, hanzi, english</strong></p></div>';return;}
    v.innerHTML=`<h2>${Util.esc(App.cur.book)} — ${Util.esc(App.cur.chapter)} — Group ${App.cur.group}</h2>`;
    let g=Library.group(),q=$("search").value.trim().toLowerCase();
    if($("displayMode").value=="single"){let s=Library.current();if(s)v.appendChild(this.card(s,true));return;}
    g.filter(s=>!q||(s.pinyin+" "+s.hanzi+" "+s.english).toLowerCase().includes(q)).forEach((s,i)=>v.appendChild(this.card(s,i==App.cur.index,i)));
    if($("autoScroll")?.value!=="off"){setTimeout(()=>{let a=$("viewer").querySelector(".card.active");if(a)a.scrollIntoView({behavior:"smooth",block:"nearest"});},80);}
  },
  stats(){
    let books=Util.uniq(App.sentences.map(s=>s.book)).length,ch=Util.uniq(App.sentences.map(s=>s.book+"|"+s.chapter)).length,gs=Util.uniq(App.sentences.map(s=>s.book+"|"+s.chapter+"|"+Util.gnum(s))).length;
    $("stats").innerHTML=`${App.sentences.length} sentences · ${App.vocab.length} vocab items<br>${books} book(s), ${ch} chapter(s), ${gs} group(s)`;
  },
  status(msg,cls=""){$("status").textContent=msg;$("status").className="status "+cls;}
};

/* ── Playback controls ──────────────────────────────────────────────────── */
const PlaybackControls={
  rate(){let id=(App.playbackContext==="vocab"&&$("vocabRate"))?"vocabRate":"rate";return Number($(id).value)||1;},
  pause(){let id=(App.playbackContext==="vocab"&&$("vocabPause"))?"vocabPause":"pause";return Number($(id).value)||0;},
  repeat(){let id=(App.playbackContext==="vocab"&&$("vocabRepeat"))?"vocabRepeat":"repeat";let v=$(id).value;return v==="infinite"?"infinite":Number(v)||1;}
};

/* ── Speech ─────────────────────────────────────────────────────────────── */
const Speech={
  loadVoices(){
    let vs=speechSynthesis.getVoices();
    App.mandarinVoice=vs.find(v=>v.name==="Ting-Ting")||vs.find(v=>v.name==="Meijia")||vs.find(v=>v.lang&&v.lang.toLowerCase().startsWith("zh"))||null;
  },
  stopAudioOnly(){
    if(App.elevenAbort){try{App.elevenAbort.abort();}catch(e){}App.elevenAbort=null;}
    if(App.currentAudio){try{App.currentAudio.pause();App.currentAudio.removeAttribute("src");App.currentAudio.load();}catch(e){}App.currentAudio=null;}
    if(App.currentAudioResolve){try{App.currentAudioResolve();}catch(e){}App.currentAudioResolve=null;}
  },
  stop(){speechSynthesis.cancel();this.stopAudioOnly();},
  system(text){return new Promise(res=>{speechSynthesis.cancel();let done=false,timer=null;const finish=()=>{if(done)return;done=true;if(timer)clearTimeout(timer);res();};let u=new SpeechSynthesisUtterance(text);u.lang="zh-CN";if(App.mandarinVoice)u.voice=App.mandarinVoice;u.rate=PlaybackControls.rate();u.onend=finish;u.onerror=finish;timer=setTimeout(finish,25000);speechSynthesis.speak(u);});},
  playBlob(blob){return new Promise((res,rej)=>{
    this.stopAudioOnly();
    let url=URL.createObjectURL(blob),a=new Audio(),settled=false,started=false,startTimer=null,totalTimer=null;
    App.currentAudio=a;
    const cleanup=()=>{if(startTimer)clearTimeout(startTimer);if(totalTimer)clearTimeout(totalTimer);try{URL.revokeObjectURL(url);}catch(e){}App.currentAudioResolve=null;if(App.currentAudio===a)App.currentAudio=null;};
    const finish=()=>{if(settled)return;settled=true;cleanup();res();};
    const fail=err=>{if(settled)return;settled=true;cleanup();try{a.pause();}catch(e){}rej(err||new Error("Audio failed"));};
    App.currentAudioResolve=finish;a.preload="auto";a.playsInline=true;
    a.onplaying=()=>{started=true;if(startTimer)clearTimeout(startTimer);};a.onended=finish;a.onerror=()=>fail(new Error("Audio playback error"));a.onstalled=()=>{if(!started)fail(new Error("Audio stalled"));};
    a.src=url;a.playbackRate=PlaybackControls.rate();startTimer=setTimeout(()=>{if(!started)fail(new Error("Audio did not start"));},9000);totalTimer=setTimeout(()=>fail(new Error("Audio timed out")),45000);
    let p=a.play();if(p&&p.catch)p.catch(err=>fail(err));
  });},
  key(text){return`${$("voiceId").value}|${$("model").value}|${text}`;},
  async prefetch(text){
    let api=$("apiKey").value.trim(),vid=$("voiceId").value.trim();
    if(!api||!vid)throw new Error("No API key or Voice ID");
    let key=this.key(text),cached=await Storage.get(AS,key);if(cached?.blob)return"cached";
    const controller=new AbortController();App.elevenAbort=controller;
    let timer=setTimeout(()=>controller.abort(),15000),r;
    try{r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}`,{method:"POST",headers:{"Accept":"audio/mpeg","Content-Type":"application/json","xi-api-key":api},body:JSON.stringify({text,model_id:$("model").value,voice_settings:{stability:.5,similarity_boost:.75}}),signal:controller.signal});}
    catch(e){if(e?.name==="AbortError"){if(App.elevenAbort!==controller)return"cancelled";throw new Error("ElevenLabs timed out");}throw e;}
    finally{clearTimeout(timer);if(App.elevenAbort===controller)App.elevenAbort=null;}
    if(r.status===429)throw new Error("Rate limited");if(!r.ok)throw new Error("ElevenLabs error "+r.status);
    let blob=await r.blob();if(!blob||!blob.size)throw new Error("Empty audio");
    await Storage.put(AS,{key,blob,createdAt:Date.now()});return"fetched";
  },
  async eleven(text){
    let api=$("apiKey").value.trim(),vid=$("voiceId").value.trim();
    if(!api||!vid){UI.status("Missing ElevenLabs key or Voice ID. Using system voice.","warntxt");return this.system(text);}
    let key=this.key(text),cached=await Storage.get(AS,key),blob;
    if(cached?.blob)blob=cached.blob;
    else{
      UI.status("Contacting ElevenLabs…");
      const controller=new AbortController();App.elevenAbort=controller;
      let timer=setTimeout(()=>controller.abort(),15000),r;
      try{r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}`,{method:"POST",headers:{"Accept":"audio/mpeg","Content-Type":"application/json","xi-api-key":api},body:JSON.stringify({text,model_id:$("model").value,voice_settings:{stability:.5,similarity_boost:.75}}),signal:controller.signal});}
      catch(e){if(e?.name==="AbortError"){if(App.elevenAbort!==controller)return;throw new Error("ElevenLabs connection timed out");}throw e;}
      finally{clearTimeout(timer);if(App.elevenAbort===controller)App.elevenAbort=null;}
      if(!r.ok)throw new Error("ElevenLabs error "+r.status);
      blob=await r.blob();if(!blob||!blob.size)throw new Error("ElevenLabs returned empty audio");
      await Storage.put(AS,{key,blob,createdAt:Date.now()});
    }
    return this.playBlob(blob);
  },
  async speak(text){
    if($("voiceMode").value=="eleven"){try{return await this.eleven(text);}catch(e){UI.status((e?.message||"ElevenLabs error")+". Using system voice.","warntxt");return this.system(text);}}
    return this.system(text);
  }
};

/* ── PlaybackEngine ─────────────────────────────────────────────────────── */
class PlaybackEngine{constructor(name,button,statusPrefix=""){this.name=name;this.button=button;this.statusPrefix=statusPrefix;this.run=0;this.playing=false;this.paused=false;this.stopped=false;this.provider=null;}setButton(){if(this.button)this.button.textContent=this.playing?(this.paused?"Resume":"Pause"):"Start";}async wait(run){while(this.paused&&!this.stopped&&run===this.run)await Util.sleep(120);}toggle(providerFactory){if(!this.playing){this.start(providerFactory);return;}if(!this.paused){this.paused=true;speechSynthesis.pause();if(App.currentAudio)App.currentAudio.pause();UI.status((this.statusPrefix||"Playback")+" paused.","warntxt");this.setButton();MediaSessionMgr.paused();return;}this.paused=false;speechSynthesis.resume();if(App.currentAudio)App.currentAudio.play().catch(()=>{});UI.status("Playing…");this.setButton();MediaSessionMgr.playing();}stop(msg="Stopped."){this.run++;this.stopped=true;this.playing=false;this.paused=false;Speech.stop();App.playbackContext="main";this.setButton();UI.status(msg,"warntxt");if(!MainPlayer.playing&&!VocabPlayer.playing){WakeLock.release();MediaSessionMgr.none();}}restart(providerFactory,delay=140){this.stop("Restarting…");setTimeout(()=>this.start(providerFactory),delay);}async start(providerFactory){if(this.playing)return;this.run++;let run=this.run;this.playing=true;this.paused=false;this.stopped=false;this.setButton();this.provider=providerFactory();App.playbackContext=this.name;UI.status("Playing…");WakeLock.request();MediaSessionMgr.playing();try{while(run===this.run&&!this.stopped){let item=this.provider.next();if(!item)break;if(item.onBefore)item.onBefore();if(item.label){UI.status(item.label);MediaSessionMgr.update(item.label,App.cur.book||"");}let reps=item.repeat??1;if(reps==="infinite"){while(run===this.run&&!this.stopped){await this.wait(run);if(run!==this.run||this.stopped)break;await Speech.speak(item.text);await this.wait(run);let pauseMs=PlaybackControls.pause();if(pauseMs>0)await Util.sleep(pauseMs);}}else{for(let i=0;i<Number(reps)&&run===this.run&&!this.stopped;i++){await this.wait(run);if(run!==this.run||this.stopped)break;await Speech.speak(item.text);await this.wait(run);let pauseMs=PlaybackControls.pause();if(pauseMs>0)await Util.sleep(pauseMs);}}}}catch(e){UI.status("Playback error: "+(e?.message||e),"dangertxt");}finally{if(run===this.run){this.playing=false;this.paused=false;this.stopped=false;Speech.stop();App.playbackContext="main";this.setButton();UI.status("Finished.","oktxt");WakeLock.release();MediaSessionMgr.none();}}}}

const MainPlayer=new PlaybackEngine("main",null,"Sentence playback");
const VocabPlayer=new PlaybackEngine("vocab",null,"Vocab drill");

/* ── SentenceController ─────────────────────────────────────────────────── */
const SentenceController={
  provider(){let m=$("playMode").value||"group";if(m==="current")return this.currentProvider(false);if(m==="loop-current")return this.currentProvider(true);if(m==="chapter")return this.seqProvider("chapter",false);if(m==="loop-chapter")return this.seqProvider("chapter",true);if(m==="loop-group")return this.seqProvider("group",true);return this.seqProvider("group",false);},
  currentProvider(loop){let done=false;return{next:()=>{let s=Library.current();if(!s||done&&!loop)return null;done=true;return{text:s.hanzi||s.pinyin,repeat:PlaybackControls.repeat(),label:"Sentence "+s.order,onBefore:()=>UI.renderViewer()};}};},
  seqProvider(scope,loop){
    let items=scope==="chapter"?Library.chapter():Library.group();
    let idx=0;
    if(scope==="group")idx=Math.max(0,Math.min(App.cur.index,items.length-1));
    else{let cur=Library.current();let pos=items.findIndex(x=>x.id===cur?.id);idx=Math.max(0,pos);}
    return{next:()=>{
      if(!items.length)return null;if(idx>=items.length){if(!loop)return null;idx=0;}
      let s=items[idx++];
      return{text:s.hanzi||s.pinyin,repeat:PlaybackControls.repeat(),label:(loop?"⟳ ":"")+"Sentence "+s.order,
        onBefore:()=>{App.cur.book=s.book;App.cur.chapter=s.chapter;App.cur.group=Util.gnum(s);App.cur.index=Library.group().findIndex(x=>x.id===s.id);if(App.cur.index<0)App.cur.index=0;UI.renderAll();}};
    }};
  },
  toggle(){MainPlayer.toggle(()=>this.provider());},
  reset(){MainPlayer.stop("Audio engine reset. Press Start to continue.");},
  restart(){if(MainPlayer.playing)MainPlayer.restart(()=>this.provider());},
  jumpToIndex(i){App.cur.index=i;UI.renderViewer();if(MainPlayer.playing)MainPlayer.restart(()=>this.provider());},
  next(){let g=Library.group();if(g.length)App.cur.index=(App.cur.index<g.length-1)?App.cur.index+1:0;UI.renderViewer();if(MainPlayer.playing)MainPlayer.restart(()=>this.provider());},
  prev(){let g=Library.group();if(g.length)App.cur.index=(App.cur.index>0)?App.cur.index-1:g.length-1;UI.renderViewer();if(MainPlayer.playing)MainPlayer.restart(()=>this.provider());}
};

/* ── VocabDrill ─────────────────────────────────────────────────────────── */
const VocabDrill={
  cats(){return["all",...Util.uniq(App.vocab.map(v=>v.category||"uncategorised")).sort(Util.nat)];},
  items(){let cat=$("vocabCat")?.value||"all";if(cat==="all")return App.vocab;return App.vocab.filter(v=>(v.category||"uncategorised")===cat);},
  render(){
    if(!$("vocabCat"))return;
    let cats=this.cats(),oldCat=$("vocabCat").value||"all";
    UI.fill($("vocabCat"),cats,cats.includes(oldCat)?oldCat:"all",c=>c==="all"?"all categories":c);
    let items=this.items(),ids=items.map(v=>String(v.id));
    let oldSel=$("vocabSel").value;
    UI.fill($("vocabSel"),ids,ids.includes(oldSel)?oldSel:(ids[0]||""),id=>{let v=App.vocab.find(x=>String(x.id)===id);return v?`${v.pinyin}${v.english?" — "+v.english:""}`:id;});
    if(!items.length){$("vocabStatus").innerHTML=App.vocab.length?"No items in this category.":"No vocab yet — import a vocab CSV to begin.";$("vocabStatus").className="status warntxt";}
    else{$("vocabStatus").innerHTML=`${items.length} item${items.length===1?"":"s"}`;$("vocabStatus").className="status";}
    this.renderView();
  },
  renderView(){
    let el=$("vocabView");if(!el)return;
    let id=$("vocabSel").value,v=App.vocab.find(x=>String(x.id)===id);
    if(!v){el.innerHTML="";return;}
    let py=Tones.colourPinyin(v.pinyin,true);
    el.innerHTML=`<div class="vocab-card"><div class="vocab-pinyin">${py}</div>${v.hanzi?`<div class="vocab-hanzi">${Tones.colourHanzi(v.hanzi)}</div>`:""}${v.english?`<div class="vocab-english">${Util.esc(v.english)}</div>`:""}${v.category?`<span class="pill">${Util.esc(v.category)}</span>`:""}</div>`;
  },
  provider(){
    let items=this.items();if(!items.length)return{next:()=>null};
    let mode=$("vocabMode").value,curId=$("vocabSel").value;
    let idx=Math.max(0,items.findIndex(x=>String(x.id)===curId));
    if(mode==="once"){let done=false;return{next:()=>{if(done)return null;done=true;let v=items[idx];return{text:v.hanzi||v.pinyin,repeat:PlaybackControls.repeat(),label:v.pinyin,onBefore:()=>{$("vocabSel").value=String(v.id);this.renderView();}};}};};
    if(mode==="loopitem"){return{next:()=>{let v=items[idx];return{text:v.hanzi||v.pinyin,repeat:"infinite",label:v.pinyin,onBefore:()=>{$("vocabSel").value=String(v.id);this.renderView();}};}};}
    // "next" or "loopall"
    return{next:()=>{
      if(!items.length)return null;
      if(idx>=items.length){if(mode==="loopall")idx=0;else return null;}
      let v=items[idx++];
      return{text:v.hanzi||v.pinyin,repeat:PlaybackControls.repeat(),label:v.pinyin,onBefore:()=>{$("vocabSel").value=String(v.id);this.renderView();}};
    }};
  },
  toggle(){VocabPlayer.toggle(()=>this.provider());},
  restart(){if(VocabPlayer.playing)VocabPlayer.restart(()=>this.provider());},
  moveItem(delta){
    let items=this.items(),ids=items.map(x=>String(x.id)),cur=$("vocabSel").value,i=ids.indexOf(cur);
    if(i<0)return;let ni=((i+delta)%ids.length+ids.length)%ids.length;$("vocabSel").value=ids[ni];this.renderView();if(VocabPlayer.playing)this.restart();
  }
};

/* ── Editor ─────────────────────────────────────────────────────────────── */
const Editor={sentence:null,
  open(s){this.sentence=s;$("editPinyin").value=s.pinyin||"";$("editHanzi").value=s.hanzi||"";$("editEnglish").value=s.english||"";$("editModal").style.display="flex";setTimeout(()=>$("editPinyin").focus(),50);},
  close(){$("editModal").style.display="none";this.sentence=null;},
  async save(){let s=this.sentence;if(!s)return;s.pinyin=$("editPinyin").value.trim();s.hanzi=$("editHanzi").value.trim();s.english=$("editEnglish").value.trim();if(!s.pinyin&&!s.hanzi){alert("Pinyin or Hanzi cannot both be empty.");return;}await Storage.put(SS,s);this.close();await Library.refresh();UI.status("Sentence updated.","oktxt");}
};

/* ── Importer ───────────────────────────────────────────────────────────── */
const Importer={
  open(mode){App.importMode=mode||"sentences";App.analysed=[];$("importSummary").textContent="No CSV analysed yet.";$("importPreview").innerHTML="";$("importModal").style.display="flex";$("importTitle").textContent=mode==="vocab"?"Import Vocabulary CSV":"Import Sentences CSV";$("importCols").innerHTML=mode==="vocab"?"<strong>pinyin, hanzi, english, category</strong>":"<strong>book, chapter, order, pinyin, hanzi, english</strong>";$("defaultBookRow").style.display=mode==="vocab"?"none":"";},
  preview(items){App.analysed=items;$("importSummary").textContent=items.length?`Detected ${items.length} ${App.importMode==="vocab"?"vocab items":"sentences"}.`:"Nothing detected — check your columns.";$("importSummary").className="status "+(items.length?"oktxt":"dangertxt");let sm=items.slice(0,10);if(App.importMode==="vocab"){$("importPreview").innerHTML=items.length?`<table><thead><tr><th>Pinyin</th><th>Hanzi</th><th>English</th><th>Category</th></tr></thead><tbody>${sm.map(v=>`<tr><td>${Util.esc(v.pinyin)}</td><td>${Util.esc(v.hanzi)}</td><td>${Util.esc(v.english)}</td><td>${Util.esc(v.category)}</td></tr>`).join("")}</tbody></table>`:"";}else{$("importPreview").innerHTML=items.length?`<table><thead><tr><th>Book</th><th>Ch.</th><th>#</th><th>Pinyin</th><th>Hanzi</th><th>English</th></tr></thead><tbody>${sm.map(s=>`<tr><td>${Util.esc(s.book)}</td><td>${Util.esc(s.chapter)}</td><td>${s.order}</td><td>${Util.esc(s.pinyin)}</td><td>${Util.esc(s.hanzi)}</td><td>${Util.esc(s.english)}</td></tr>`).join("")}</tbody></table>`:"";}},
  analyse(){let text=$("pasteCsv").value.trim();if(!text){alert("Paste CSV text first.");return;}this.preview(App.importMode==="vocab"?Library.parseVocabCSV(text):Library.parseSentencesCSV(text,{book:$("defaultBook").value,chapter:$("defaultChapter").value}));},
  analyseFile(f){if(!f)return;f.text().then(t=>this.preview(App.importMode==="vocab"?Library.parseVocabCSV(t):Library.parseSentencesCSV(t,{book:$("defaultBook").value,chapter:$("defaultChapter").value})));},
  async import(){
    if(!App.analysed.length){alert("Analyse a CSV first.");return;}
    let store=App.importMode==="vocab"?VS:SS;
    await Storage.addMany(store,App.analysed);
    if(App.importMode==="sentences"){let s=App.analysed[0];App.cur={book:s.book,chapter:s.chapter,group:Util.gnum(s),index:0};}
    App.analysed=[];$("importModal").style.display="none";
    await Library.refresh();
    UI.status("Imported successfully.","oktxt");
  }
};

/* ── Nav ────────────────────────────────────────────────────────────────── */
const Nav={
  nextGroup(){let gs=Util.uniq(Library.chapter().map(Util.gnum)).sort((a,b)=>a-b),i=gs.indexOf(Number(App.cur.group));if(i>=0&&i<gs.length-1){App.cur.group=gs[i+1];App.cur.index=0;UI.renderAll();if(MainPlayer.playing)SentenceController.restart();}},
  prevGroup(){let gs=Util.uniq(Library.chapter().map(Util.gnum)).sort((a,b)=>a-b),i=gs.indexOf(Number(App.cur.group));if(i>0){App.cur.group=gs[i-1];App.cur.index=0;UI.renderAll();if(MainPlayer.playing)SentenceController.restart();}}
};

/* ── Preloader ──────────────────────────────────────────────────────────── */
const Preloader={
  running:false,cancelled:false,
  _setPreloadBtns(disabled){["preloadBtn","vocabPreloadBtn"].forEach(id=>{let el=$(id);if(el)el.disabled=disabled;});},
  async _run(texts,labelFn,cancelId){
    let total=texts.length,done=0,fetched=0,skipped=0,failed=0;
    for(let text of texts){
      if(this.cancelled)break;
      UI.status(labelFn(done+1,total));
      try{let r=await Speech.prefetch(text);if(r==="cached")skipped++;else if(r==="fetched")fetched++;}catch(e){if(this.cancelled)break;failed++;}
      done++;if(!this.cancelled&&done<total)await Util.sleep(400);
    }
    this.running=false;this._setPreloadBtns(false);
    if($(cancelId))$(cancelId).classList.add("hidden");
    UI.status(this.cancelled?`Cancelled. ${fetched} downloaded, ${skipped} cached.`:`Done: ${fetched} downloaded, ${skipped} cached${failed?", "+failed+" failed":""}.`,this.cancelled?"warntxt":"oktxt");
  },
  async start(){
    if(this.running)return;
    if($("voiceMode").value!=="eleven"){UI.status("Switch voice to ElevenLabs to pre-download audio.","warntxt");return;}
    if(!$("apiKey").value.trim()||!$("voiceId").value.trim()){UI.status("Enter ElevenLabs API key and Voice ID first.","warntxt");return;}
    let scope=$("preloadScope").value;
    let sents=scope==="group"?Library.group():scope==="chapter"?Library.chapter():scope==="book"?App.sentences.filter(x=>x.book===App.cur.book):App.sentences;
    let texts=sents.map(s=>s.hanzi||s.pinyin);
    if(!texts.length){UI.status("No sentences in scope.","warntxt");return;}
    this.running=true;this.cancelled=false;this._setPreloadBtns(true);$("preloadCancel").classList.remove("hidden");
    await this._run(texts,(n,t)=>`Pre-downloading sentence ${n} of ${t}…`,"preloadCancel");
  },
  async startVocab(){
    if(this.running)return;
    if($("voiceMode").value!=="eleven"){UI.status("Switch voice to ElevenLabs to pre-download audio.","warntxt");return;}
    if(!$("apiKey").value.trim()||!$("voiceId").value.trim()){UI.status("Enter ElevenLabs API key and Voice ID first.","warntxt");return;}
    let items=VocabDrill.items(),texts=items.map(v=>v.hanzi||v.pinyin);
    if(!texts.length){UI.status("No vocab items in this category.","warntxt");return;}
    this.running=true;this.cancelled=false;this._setPreloadBtns(true);$("vocabPreloadCancel").classList.remove("hidden");
    await this._run(texts,(n,t)=>`Pre-downloading vocab audio ${n} of ${t}…`,"vocabPreloadCancel");
  },
  cancel(){this.cancelled=true;if(App.elevenAbort){try{App.elevenAbort.abort();}catch(e){}App.elevenAbort=null;}}
};

/* ── WakeLock ───────────────────────────────────────────────────────────── */
const WakeLock={
  lock:null,
  async request(){if(!("wakeLock" in navigator))return;try{this.lock=await navigator.wakeLock.request("screen");this.lock.addEventListener("release",()=>{this.lock=null;});}catch(e){}},
  release(){if(this.lock){try{this.lock.release();}catch(e){}this.lock=null;}},
  async reacquire(){if(!this.lock&&(MainPlayer.playing||VocabPlayer.playing))await this.request();}
};

/* ── MediaSession ───────────────────────────────────────────────────────── */
const MediaSessionMgr={
  init(){
    if(!("mediaSession" in navigator))return;
    navigator.mediaSession.setActionHandler("play",()=>{if(!MainPlayer.playing&&App.playbackContext!=="vocab")SentenceController.toggle();else if(!VocabPlayer.playing)VocabDrill.toggle();});
    navigator.mediaSession.setActionHandler("pause",()=>{if(MainPlayer.playing)SentenceController.toggle();else if(VocabPlayer.playing)VocabDrill.toggle();});
    navigator.mediaSession.setActionHandler("stop",()=>{MainPlayer.stop("Stopped.");VocabPlayer.stop("Stopped.");});
  },
  update(title,sub){if(!("mediaSession" in navigator))return;try{navigator.mediaSession.metadata=new MediaMetadata({title:title||"Mandarin Shadowing Studio",artist:sub||""});}catch(e){}},
  playing(){if("mediaSession" in navigator)try{navigator.mediaSession.playbackState="playing";}catch(e){}},
  paused(){if("mediaSession" in navigator)try{navigator.mediaSession.playbackState="paused";}catch(e){}},
  none(){if("mediaSession" in navigator)try{navigator.mediaSession.playbackState="none";}catch(e){}}
};

/* ── CSV export ─────────────────────────────────────────────────────────── */
function toCSV(){let h=["book","chapter","order","pinyin","hanzi","english","bookmarked","notes"];return h.join(",")+"\n"+App.sentences.map(s=>h.map(k=>`"${String(s[k]??"").replace(/"/g,'""')}"`).join(",")).join("\n");}
function download(name,text,type){let b=new Blob([text],{type}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();URL.revokeObjectURL(a.href);}

/* ── bind() ─────────────────────────────────────────────────────────────── */
function bind(){
  MainPlayer.button=$("mainToggle");VocabPlayer.button=$("vocabToggle");

  function activatePanel(p){
    document.querySelectorAll(".desktop-tabs [data-panel]").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(x=>x.classList.add("hidden"));
    let tb=document.querySelector(".desktop-tabs [data-panel='"+p+"']");if(tb)tb.classList.add("active");
    $(p).classList.remove("hidden");
    if(p==="verbs"){if(MainPlayer.playing)MainPlayer.stop("Switched to Vocab Drill.");VocabDrill.render();}
    else if(p==="study"&&VocabPlayer.playing)VocabPlayer.stop("Switched to Study.");
    else if(p==="settings"){if(MainPlayer.playing)MainPlayer.stop("Switched to Settings.");if(VocabPlayer.playing)VocabPlayer.stop("Switched to Settings.");}
  }
  document.querySelectorAll(".desktop-tabs [data-panel]").forEach(b=>b.onclick=()=>activatePanel(b.dataset.panel));

  function activateScreen(s){
    document.body.setAttribute("data-screen",s);
    document.querySelectorAll(".mobile-nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.screen===s));
    if(s!=="library")activatePanel(s);
  }
  document.querySelectorAll(".mobile-nav-btn").forEach(b=>b.onclick=()=>activateScreen(b.dataset.screen));
  if($("goToSettings"))$("goToSettings").onclick=()=>activateScreen("settings");

  // Library
  $("openImport").onclick=()=>Importer.open("sentences");
  $("openVocabImport").onclick=()=>Importer.open("vocab");
  $("closeImport").onclick=()=>$("importModal").style.display="none";
  $("analyseFile").onclick=()=>{let f=$("csvFile").files[0];if(!f){alert("Choose a CSV first.");return;}Importer.analyseFile(f);};
  $("analysePaste").onclick=()=>Importer.analyse();
  $("importPreviewed").onclick=()=>Importer.import();
  $("exportCsv").onclick=()=>download("mandarin-shadowing-library.csv",toCSV(),"text/csv;charset=utf-8");
  $("clearAll").onclick=async()=>{if(confirm("Delete all sentences, vocabulary and audio cache?")){await Storage.clear(SS);await Storage.clear(VS);await Storage.clear(AS);App.sentences=[];App.vocab=[];App.cur={book:"",chapter:"",group:1,index:0};UI.renderAll();}};
  $("bookSel").onchange=e=>{App.cur.book=e.target.value;App.cur.chapter="";App.cur.group=1;App.cur.index=0;UI.renderAll();};
  $("chapterSel").onchange=e=>{App.cur.chapter=e.target.value;App.cur.group=1;App.cur.index=0;UI.renderAll();};
  $("groupSel").onchange=e=>{App.cur.group=Number(e.target.value);App.cur.index=0;UI.renderAll();};
  $("prevGroup").onclick=()=>Nav.prevGroup();$("nextGroup").onclick=()=>Nav.nextGroup();
  $("showBookmarks").onclick=()=>{$("reviewView").innerHTML=App.sentences.filter(s=>s.bookmarked).map(s=>`<div class="card"><div class="pinyin-text">${Tones.colourPinyin(s.pinyin)}</div>${s.hanzi?`<div class="hanzi-text">${Tones.colourHanzi(s.hanzi)}</div>`:""}<div class="english">${Util.esc(s.english)}</div></div>`).join("")||"<p>No bookmarked sentences.</p>";};
  $("showAll").onclick=()=>{$("reviewView").innerHTML=App.sentences.map(s=>`<div class="card"><span class="pill">${Util.esc(s.book)} / ${Util.esc(s.chapter)} / ${s.order}</span><div class="pinyin-text">${Tones.colourPinyin(s.pinyin)}</div>${s.hanzi?`<div class="hanzi-text">${Tones.colourHanzi(s.hanzi)}</div>`:""}</div>`).join("");};

  // Study
  $("prevSentence").onclick=()=>SentenceController.prev();
  $("nextSentence").onclick=()=>SentenceController.next();
  $("mainToggle").onclick=()=>SentenceController.toggle();
  $("hardReset").onclick=()=>{MainPlayer.stop("Audio reset.");VocabPlayer.stop("Audio reset.");};
  ["displayMode","showEnglish","colourMode"].forEach(id=>{if($(id))$(id).onchange=()=>{UI.renderViewer();VocabDrill.renderView();};});
  $("playMode").onchange=()=>SentenceController.restart();
  $("search").oninput=()=>UI.renderViewer();

  // Edit modal
  $("closeEdit").onclick=()=>Editor.close();$("closeEditBottom").onclick=()=>Editor.close();
  $("saveEdit").onclick=()=>Editor.save();
  $("editModal").onclick=e=>{if(e.target===$("editModal"))Editor.close();};

  // Import modal
  $("importModal").onclick=e=>{if(e.target===$("importModal"))$("importModal").style.display="none";};

  // Playback controls → restart on change
  ["repeat","rate","pause","vocabRepeat","vocabRate","vocabPause"].forEach(id=>{if($(id))$(id).onchange=()=>{if(MainPlayer.playing)SentenceController.restart();if(VocabPlayer.playing)VocabDrill.restart();};});

  // Settings
  $("voiceMode").onchange=()=>{let m=$("voiceMode").value;localStorage.setItem("mssVoiceMode",m);$("elevenPanel").classList.toggle("hidden",m!=="eleven");if($("voiceChipLabel"))$("voiceChipLabel").textContent=m==="eleven"?"ElevenLabs":"System (Ting-Ting)";};
  $("saveElevenBtn").onclick=()=>{if($("saveEleven").value==="yes"){localStorage.setItem("mssKey",$("apiKey").value);localStorage.setItem("mssVoice",$("voiceId").value);localStorage.setItem("mssModel",$("model").value);localStorage.setItem("mssVoiceMode","eleven");$("voiceMode").value="eleven";$("elevenPanel").classList.remove("hidden");UI.status("ElevenLabs settings saved.","oktxt");}else{UI.status("Settings not saved — set 'Save locally' to yes first.","warntxt");}};
  $("clearElevenBtn").onclick=()=>{["mssKey","mssVoice","mssModel"].forEach(k=>localStorage.removeItem(k));$("apiKey").value="";$("voiceId").value="";UI.status("ElevenLabs settings cleared.","warntxt");};
  $("preloadBtn").onclick=()=>Preloader.start();$("preloadCancel").onclick=()=>Preloader.cancel();

  // Vocab drill
  $("vocabCat").onchange=()=>VocabDrill.render();
  $("vocabSel").onchange=()=>{VocabDrill.renderView();VocabDrill.restart();};
  $("vocabMode").onchange=()=>VocabDrill.restart();
  $("vocabToggle").onclick=()=>VocabDrill.toggle();
  $("prevItem").onclick=()=>VocabDrill.moveItem(-1);
  $("nextItem").onclick=()=>VocabDrill.moveItem(1);
  $("vocabPreloadBtn").onclick=()=>Preloader.startVocab();
  $("vocabPreloadCancel").onclick=()=>Preloader.cancel();

  // Theme
  if($("themeToggle"))$("themeToggle").onchange=()=>{let d=$("themeToggle").checked;document.documentElement.setAttribute("data-theme",d?"dark":"sage");localStorage.setItem("mssTheme",d?"dark":"sage");};
}

window.speechSynthesis.onvoiceschanged=()=>Speech.loadVoices();

/* ── init() ─────────────────────────────────────────────────────────────── */
(async function init(){
  let _th=localStorage.getItem("mssTheme")||"sage";
  document.documentElement.setAttribute("data-theme",_th);
  if($("themeToggle"))$("themeToggle").checked=_th==="dark";
  App.db=await Storage.open();
  bind();
  MediaSessionMgr.init();
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")WakeLock.reacquire();});
  window.addEventListener("orientationchange",()=>{setTimeout(()=>{
    if((MainPlayer.playing&&!MainPlayer.paused)||(VocabPlayer.playing&&!VocabPlayer.paused)){
      if(!speechSynthesis.speaking&&!App.currentAudio){
        if(MainPlayer.playing)SentenceController.restart();
        else if(VocabPlayer.playing)VocabDrill.restart();
      }
    }
  },600);});
  Speech.loadVoices();
  $("apiKey").value=localStorage.getItem("mssKey")||"";
  $("voiceId").value=localStorage.getItem("mssVoice")||"";
  $("model").value=localStorage.getItem("mssModel")||"eleven_multilingual_v2";
  $("voiceMode").value=localStorage.getItem("mssVoiceMode")||"eleven";
  $("elevenPanel").classList.toggle("hidden",$("voiceMode").value!=="eleven");
  if($("voiceChipLabel"))$("voiceChipLabel").textContent=$("voiceMode").value==="eleven"?"ElevenLabs":"System (Ting-Ting)";
  await Library.refresh();
  MainPlayer.setButton();VocabPlayer.setButton();
})();
