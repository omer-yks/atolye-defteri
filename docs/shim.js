/* Atölye Defteri — bağımsız uygulama katmanı.
 * Uygulama Claude içinde window.claude.use(...) ile veri deposu, kullanıcı, yapay zekâ, indirme
 * ve bağlayıcılara ulaşıyordu. Burada aynı arayüz Supabase (veri + giriş), Gemini (yapay zekâ)
 * ve tarayıcının kendisiyle sağlanır; uygulamanın geri kalanı değişmeden çalışır. */
(function(){
'use strict';
const SB_URL='https://cqfplrjpgmwougakadqv.supabase.co', SB_KEY='sb_publishable_8Brw-_LO8wNc3fpSPUduQQ_GrkPR13c';
const AI_MODELS=['gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite'];
const LS=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}};
const sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:'atolye-auth'}});
window.ATL={sb};
let USER=null,READY=null;
/* ---------- Giriş ---------- */
const css=`#atlLogin{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:var(--bg,#EDF1F7);padding:16px;font-family:var(--f-body,system-ui)}
#atlLogin .c{width:min(380px,100%);background:var(--surface,#fff);border-radius:22px;padding:28px 24px;box-shadow:0 24px 60px rgba(10,20,40,.14);display:grid;gap:14px;animation:atlIn .45s cubic-bezier(.2,.9,.3,1)}
@keyframes atlIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
#atlLogin .bm{width:46px;height:46px;border-radius:14px;background:var(--accent,#4B3CF0);color:#fff;display:grid;place-items:center}
#atlLogin h1{margin:0;font-family:var(--f-display,system-ui);font-size:1.5rem;font-weight:600;color:var(--ink,#17191F)}
#atlLogin p{margin:0;color:var(--mute,#7A8395);font-size:.9rem}
#atlLogin label{display:grid;gap:5px;font-size:.8rem;font-weight:600;color:var(--mute,#7A8395)}
#atlLogin input{border:1px solid var(--line,#E7EBF2);border-radius:12px;background:var(--soft,#F3F5FA);padding:11px 12px;font:inherit;font-size:1rem;color:var(--ink,#17191F)}
#atlLogin input:focus{outline:2px solid var(--accent,#4B3CF0);outline-offset:0;background:var(--surface,#fff)}
#atlLogin button.go{border:0;border-radius:12px;background:var(--char,#2E2F34);color:var(--on-char,#fff);padding:12px;font:inherit;font-weight:600;cursor:pointer}
#atlLogin button.go:disabled{opacity:.6}
#atlLogin .atl-sw{border:0;background:none;color:var(--accent,#4B3CF0);font:inherit;font-weight:600;font-size:.88rem;cursor:pointer;padding:0;justify-self:start}
#atlLogin .msg{font-size:.86rem;border-radius:10px;padding:9px 12px;display:none}
#atlLogin .msg.err{display:block;background:var(--late-bg,#FFE9E9);color:var(--late,#DE454A)}
#atlLogin .msg.ok{display:block;background:var(--ok-bg,#E1F7E9);color:var(--ok,#178F49)}`;
function loginUI(){
  return new Promise(resolve=>{
    const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
    const w=document.createElement('div');w.id='atlLogin';
    w.innerHTML=`<form class="c" novalidate><div class="bm"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5zM3.3 7.5L12 12.5l8.7-5M12 22v-9.5"/></svg></div>
      <h1>Atölye Defteri</h1><p class="sub">Defterine girmek için e-posta ve şifreni yaz.</p>
      <label>E-posta<input type="email" name="e" autocomplete="username" required></label>
      <label>Şifre<input type="password" name="p" autocomplete="current-password" minlength="6" required></label>
      <div class="msg"></div><button type="submit" class="go">Giriş yap</button><button type="button" class="atl-sw">Hesabın yok mu? Hesap oluştur</button></form>`;
    document.body.appendChild(w);
    const f=w.querySelector('form'),msg=w.querySelector('.msg'),go=w.querySelector('.go'),swb=w.querySelector('.atl-sw'),sub=w.querySelector('.sub');let mode='in';
    const say=(t,ok)=>{msg.textContent=t;msg.className='msg '+(ok?'ok':'err')};
    swb.onclick=()=>{mode=mode==='in'?'up':'in';go.textContent=mode==='in'?'Giriş yap':'Hesap oluştur';swb.textContent=mode==='in'?'Hesabın yok mu? Hesap oluştur':'Hesabın var mı? Giriş yap';sub.textContent=mode==='in'?'Defterine girmek için e-posta ve şifreni yaz.':'Bir kez hesap oluştur; sonra her cihazdan bu bilgilerle girersin.';msg.className='msg';f.p.autocomplete=mode==='in'?'current-password':'new-password'};
    f.onsubmit=async e=>{e.preventDefault();const em=f.e.value.trim(),pw=f.p.value;
      if(!/^\S+@\S+\.\S+$/.test(em))return say('Geçerli bir e-posta yaz.');if(pw.length<6)return say('Şifre en az 6 karakter olmalı.');
      go.disabled=true;
      try{
        if(mode==='up'){const{data,error}=await sb.auth.signUp({email:em,password:pw,options:{emailRedirectTo:location.origin+location.pathname}});if(error)throw error;
          if(!data.session){say('Hesap oluşturuldu. E-postana gelen bağlantıya tıkla; açılan sayfa hata gösterse bile hesabın onaylanır. Sonra buraya dönüp giriş yap.',true);swb.onclick();go.disabled=false;return}
          w.remove();resolve(data.session.user);return}
        const{data,error}=await sb.auth.signInWithPassword({email:em,password:pw});if(error)throw error;w.remove();resolve(data.user);
      }catch(er){const m=String(er&&er.message||er);say(/invalid login/i.test(m)?'E-posta ya da şifre yanlış.':/not confirmed/i.test(m)?'E-postanı henüz onaylamadın; gelen bağlantıya tıkla.':/already registered/i.test(m)?'Bu e-postayla zaten hesap var; giriş yap.':/sahibi var|Database error saving new user/i.test(m)?'Bu defterin zaten bir sahibi var; yeni hesap açılamaz. Kendi hesabınla giriş yap.':/rate|too many/i.test(m)?'Çok fazla deneme oldu; biraz sonra tekrar dene.':'Olmadı: '+m)}
      finally{go.disabled=false}};
    setTimeout(()=>{try{f.e.focus()}catch(e){}},50);
  });
}
async function auth(){
  if(READY)return READY;
  READY=(async()=>{const{data}=await sb.auth.getSession();USER=data.session?data.session.user:await loginUI();return USER})();
  return READY;
}
sb.auth.onAuthStateChange((ev,s)=>{if(ev==='SIGNED_OUT'){USER=null;location.reload()}});
/* ---------- Veri deposu: claude 'db' arayüzünün Supabase karşılığı ---------- */
const COLMAP=new Map(),SUBS=new Map();let CH=null,LOADING=null;
function snapOf(c){const m=COLMAP.get(c)||new Map();const docs=[...m.entries()].map(([id,d])=>({id,data:()=>d}));return{metadata:{fromCache:false},size:docs.length,docs}}
function emit(c){(SUBS.get(c)||[]).forEach(cb=>{try{cb(snapOf(c))}catch(e){console.error(e)}})}
async function loadAll(){
  const all=[];for(let from=0;;from+=1000){const{data,error}=await sb.from('docs').select('col,id,data').range(from,from+999);if(error)throw error;all.push(...data);if(data.length<1000)break}
  COLMAP.clear();all.forEach(r=>{if(!COLMAP.has(r.col))COLMAP.set(r.col,new Map());COLMAP.get(r.col).set(r.id,r.data)});
}
function realtime(){
  if(CH)return;
  CH=sb.channel('docs-'+USER.id).on('postgres_changes',{event:'*',schema:'public',table:'docs',filter:'owner=eq.'+USER.id},p=>{
    const r=p.eventType==='DELETE'?p.old:p.new;if(!r||!r.col)return;
    if(!COLMAP.has(r.col))COLMAP.set(r.col,new Map());
    if(p.eventType==='DELETE')COLMAP.get(r.col).delete(r.id);else COLMAP.get(r.col).set(r.id,r.data);emit(r.col);
  }).subscribe(s=>{if(s==='CHANNEL_ERROR'||s==='TIMED_OUT')setTimeout(()=>{try{sb.removeChannel(CH)}catch(e){}CH=null;realtime()},5000)});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')loadAll().then(()=>[...SUBS.keys()].forEach(emit)).catch(()=>{})});
}
const err=(code,message)=>Object.assign(new Error(message||code),{code});
const DB={
  doc(){return{collection(c){return{
    doc(id){return{
      async set(data){const{error}=await sb.from('docs').upsert({owner:USER.id,col:c,id,data,updated_at:new Date().toISOString()},{onConflict:'owner,col,id'});if(error)throw err(/fetch|network/i.test(error.message)?'unavailable':'write_failed',error.message);
        if(!COLMAP.has(c))COLMAP.set(c,new Map());COLMAP.get(c).set(id,data)},
      async delete(){const{error}=await sb.from('docs').delete().match({owner:USER.id,col:c,id});if(error)throw err(/fetch|network/i.test(error.message)?'unavailable':'write_failed',error.message);
        COLMAP.get(c)&&COLMAP.get(c).delete(id)}}},
    onSnapshot(cb,onErr){if(!SUBS.has(c))SUBS.set(c,[]);SUBS.get(c).push(cb);
      (LOADING||(LOADING=loadAll().then(realtime))).then(()=>cb(snapOf(c)),e=>{LOADING=null;onErr&&onErr(e)});return()=>{const L=SUBS.get(c)||[];const i=L.indexOf(cb);if(i>=0)L.splice(i,1)}}}}}}
};
const USERAPI={id:async()=>USER&&USER.id,me:async()=>({id:USER.id,name:USER.email||'',email:USER.email||''}),isOwner:()=>true,canEdit:()=>true,can:()=>true,profiles:async()=>({}),search:async()=>[]};
/* ---------- İndirme ---------- */
const DOWNLOADS={async save({filename,data}){const b=data instanceof Blob?data:new Blob([data]);const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=filename||'dosya';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},3000);return{}}};
/* ---------- Yazıcı: Supabase'teki tablolar (atölyedeki Windows servisi yazar) ---------- */
const MCP={
  async callTool(server,tool,args){
    if(server==='Supabase'&&tool==='execute_sql'){
      const[s,j]=await Promise.all([sb.from('printer_status').select('data,device,updated_at').eq('id','main').maybeSingle(),sb.from('printer_jobs').select('*').order('ended_at',{ascending:false,nullsFirst:false}).limit(200)]);
      if(s.error&&j.error)throw err('tool_error',(s.error||j.error).message);
      const ms=v=>v?Date.parse(v):null;
      const r={status:s.data?{data:s.data.data,device:s.data.device,updatedAt:ms(s.data.updated_at)}:null,
        jobs:(j.data||[]).map(x=>({id:x.id,name:x.name,startedAt:ms(x.started_at),endedAt:ms(x.ended_at),durationSec:x.duration_sec,result:x.result,grams:x.grams,predSec:x.pred_sec,filaments:x.filaments,late:x.late,approx:x.approx,device:x.device}))};
      return{payload:[{r}],content:[]};
    }
    throw err('server_not_connected','Bu araç bağımsız uygulamada yok');
  },
  watchTool(server,tool,input,handler){setTimeout(()=>{try{handler({type:'error',error:err('server_not_connected')})}catch(e){}},0);return()=>{}},
  listTools:async()=>[],describeTool:async()=>null
};
/* ---------- Yapay zekâ: Gemini (ücretsiz plan). Müşteri adları takma adla gönderilir. ---------- */
function aiKey(){return(LS('atl-gemini-key')||'').trim()}
function aliasMap(){
  const names=new Map();
  try{['customers','orders','sales'].forEach(c=>(S[c]||[]).forEach(r=>{const n=String((c==='customers'?r.name:r.cust)||'').trim();if(n.length>=2)names.set(n.toLocaleLowerCase('tr'),n)}))}catch(e){}
  const list=[...names.values()].sort((a,b)=>b.length-a.length),M=[];
  const tokCount=new Map();list.forEach(n=>n.split(/\s+/).filter(w=>w.length>=4).forEach(w=>{const k=w.toLocaleLowerCase('tr');tokCount.set(k,(tokCount.get(k)||0)+1)}));
  list.forEach((n,i)=>{const al=`Müşteri ${i+1}`;M.push([n,al]);n.split(/\s+/).filter(w=>w.length>=4&&tokCount.get(w.toLocaleLowerCase('tr'))===1&&!/^(atölye|optik|tekstil|branda|anaokulu|restoran|resturant|market|ltd|şti|limited)$/i.test(w)).forEach(w=>M.push([w,al]))});
  M.sort((a,b)=>b[0].length-a[0].length);
  return{M,back:new Map(list.map((n,i)=>[`Müşteri ${i+1}`,n]))};
}
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function mask(t,A){if(!t||!A.M.length)return t;let s=String(t);A.M.forEach(([n,al])=>{s=s.replace(new RegExp('(^|[^\\p{L}\\p{N}])('+reEsc(n)+')(?=[^\\p{L}\\p{N}]|$)','giu'),(m,p)=>p+al)});return s}
function unmask(t,A){if(!t||!A.back.size)return t;return String(t).replace(/Müşteri (\d+)/g,(m,n)=>A.back.get('Müşteri '+n)||m)}
async function b64(blob){const buf=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=32768)s+=String.fromCharCode.apply(null,buf.subarray(i,i+32768));return btoa(s)}
async function toContents(input,images,A){
  const turns=typeof input==='string'?[{role:'user',content:input}]:input;
  const C=turns.map(t=>({role:t.role==='assistant'?'model':'user',parts:[{text:mask(String(t.content||''),A)}]}));
  const imgs=images?(Array.isArray(images)?images:[images]).filter(Boolean):[];
  if(imgs.length){const last=C[C.length-1];for(const b of imgs.slice(0,8))last.parts.push({inline_data:{mime_type:b.type||'image/png',data:await b64(b)}})}
  return C;
}
let MODEL_OK=LS('atl-gemini-model')||'';
async function gem(contents,{stream,json,signal,onText,A,temp}){
  const key=aiKey();if(!key)throw err('not_granted','Gemini anahtarı girilmemiş');
  const models=[MODEL_OK,...AI_MODELS].filter((m,i,a)=>m&&a.indexOf(m)===i);let last=null;
  for(const model of models){
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream?'streamGenerateContent?alt=sse':'generateContent'}`;
    let r;try{r=await fetch(url,{method:'POST',signal,headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents,generationConfig:{temperature:temp!=null?temp:json?0.2:0.5,maxOutputTokens:8192,...(json?{responseMimeType:'application/json'}:{})}})})}
    catch(e){if(e&&e.name==='AbortError')throw err('cancelled');throw err('upstream_error','İnternet bağlantısı yok gibi görünüyor.')}
    if(r.status===404){last=err('model_unavailable',model);continue}
    if(!r.ok){const t=await r.text().catch(()=>'');if(r.status===429)throw err('rate_limited',t);if(r.status===400&&/API key|API_KEY/i.test(t)||r.status===401||r.status===403)throw err('not_granted','Gemini anahtarı geçersiz');throw err('upstream_error',`Gemini ${r.status}: ${t.slice(0,200)}`)}
    if(MODEL_OK!==model){MODEL_OK=model;LS('atl-gemini-model',model)}
    if(!stream){const j=await r.json();const t=(((j.candidates||[])[0]||{}).content||{}).parts||[];return t.map(p=>p.text||'').join('')}
    const rd=r.body.getReader(),dec=new TextDecoder();let buf='',full='';
    try{for(;;){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;
      while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line.startsWith('data:'))continue;
        try{const j=JSON.parse(line.slice(5));const d=((((j.candidates||[])[0]||{}).content||{}).parts||[]).map(p=>p.text||'').join('');if(d){full+=d;onText&&onText({text:unmask(full,A),delta:unmask(d,A)})}}catch(e){}}}}
    catch(e){if(e&&e.name==='AbortError')throw Object.assign(err('cancelled'),{text:unmask(full,A)});throw e}
    return full;
  }
  throw last||err('model_unavailable');
}
function sample(input,opts){opts=opts||{};const A=aliasMap();return(async()=>{const C=await toContents(input,opts.images,A);
  try{const t=await gem(C,{stream:true,signal:opts.signal,onText:opts.onText,A});return{text:unmask(t,A),truncated:false}}
  catch(e){if(e&&e.text)e.text=unmask(e.text,A);throw e}})()}
sample.json=async(input,opts)=>{opts=opts||{};const A=aliasMap();const C=await toContents(input,opts.images,A);
  const t=unmask(await gem(C,{stream:false,json:true,signal:opts.signal,A}),A);
  try{return JSON.parse(t)}catch(e){const m=/[\[{][\s\S]*[\]}]/.exec(t);if(m)return JSON.parse(m[0]);throw err('bad_json','Yapay zekânın cevabı okunamadı')}};
sample.limits=async()=>({maxInputBytes:4e6,images:{maxCount:8,maxBytes:7e6,types:['image/png','image/jpeg','image/webp']},modelTiers:['quick','default','complex']});
/* ---------- Sesle yazma: mikrofon kaydı → Gemini ile yazıya dökme (Brave ve masaüstü uygulamasında da çalışır) ---------- */
async function toWav(blob){
  const AC=window.AudioContext||window.webkitAudioContext,ac=new AC();
  try{const ab=await ac.decodeAudioData(await blob.arrayBuffer());const sr=16000,len=Math.max(1,Math.ceil(ab.duration*sr));
    const oc=new OfflineAudioContext(1,len,sr),src=oc.createBufferSource();src.buffer=ab;src.connect(oc.destination);src.start();
    const d=(await oc.startRendering()).getChannelData(0),buf=new ArrayBuffer(44+d.length*2),v=new DataView(buf);
    const w=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i))};
    w(0,'RIFF');v.setUint32(4,36+d.length*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,d.length*2,true);
    let peak=0;for(let i=0;i<d.length;i++){const x=Math.max(-1,Math.min(1,d[i]));peak=Math.max(peak,Math.abs(x));v.setInt16(44+i*2,x<0?x*0x8000:x*0x7fff,true)}
    return{wav:new Blob([buf],{type:'audio/wav'}),sec:ab.duration,peak}}
  finally{try{ac.close()}catch(e){}}
}
const STT_MAX=120000;
const STT={rec:null,stopT:null,
  active(){return!!this.rec},
  stop(){if(this.rec&&this.rec.state!=='inactive')this.rec.stop()},
  async start(onState){
    if(this.rec)throw err('busy','Kayıt zaten sürüyor');
    if(!aiKey())throw err('not_granted','Gemini anahtarı girilmemiş');
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder)throw err('mic_none','Bu tarayıcı ses kaydını desteklemiyor');
    let st;try{st=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1}})}
    catch(e){throw err(e&&(e.name==='NotAllowedError'||e.name==='SecurityError')?'mic_denied':e&&(e.name==='NotReadableError'||e.name==='AbortError')?'mic_busy':'mic_none',e&&e.message||'')}
    const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'].find(m=>{try{return MediaRecorder.isTypeSupported(m)}catch(e){return false}})||'';
    const rec=new MediaRecorder(st,mime?{mimeType:mime}:undefined),chunks=[];this.rec=rec;
    rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
    const done=new Promise(res=>{rec.onstop=res});
    rec.start(1000);onState&&onState('rec');this.stopT=setTimeout(()=>this.stop(),STT_MAX);
    await done;clearTimeout(this.stopT);st.getTracks().forEach(t=>t.stop());this.rec=null;
    try{
      if(!chunks.length)return'';
      onState&&onState('busy');
      const{wav,sec,peak}=await toWav(new Blob(chunks,{type:rec.mimeType||mime||'audio/webm'}));
      if(sec<0.4||peak<0.01)return'';
      const C=[{role:'user',parts:[{text:'Bu ses kaydında Türkçe konuşan birinin söylediklerini aynen yazıya dök. Uygun noktalama ve büyük harf kullan; sayıları rakamla yaz. Yalnızca söylenen metni yaz: açıklama, tırnak, başlık ekleme. Kayıtta anlaşılır konuşma yoksa hiçbir şey yazma.'},{inline_data:{mime_type:'audio/wav',data:await b64(wav)}}]}];
      const t=await gem(C,{stream:false,temp:0,A:{M:[],back:new Map()}});
      return String(t||'').replace(/^\s*["“”]|["“”]\s*$/g,'').trim();
    }finally{onState&&onState('idle')}
  }
};
window.__atlSTT=STT;
const IS_DESKTOP=/Electron\//.test(navigator.userAgent);
function micHelp(code){
  if(code==='mic_denied')return IS_DESKTOP
    ?'Mac mikrofon iznini kapalı tutuyor.\nSistem Ayarları → Gizlilik ve Güvenlik → Mikrofon → “Atolye Defteri”nin anahtarını aç. Sonra uygulamayı kapatıp (⌘Q) yeniden aç.'
    :'Tarayıcı mikrofon iznini kapalı tutuyor.\nAdres çubuğunun solundaki simgeye tıkla → Mikrofon → İzin ver ve sayfayı yenile.\nAyrıca Mac’te: Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon → tarayıcının (ör. Brave Browser) anahtarı açık olmalı.';
  if(code==='mic_none')return'Mikrofon bulunamadı. Mac’te Sistem Ayarları → Ses → Giriş bölümünde bir mikrofon seçili olmalı.';
  if(code==='mic_busy')return'Mikrofon şu an başka bir uygulama tarafından kullanılıyor olabilir (ör. görüntülü görüşme). O uygulamayı kapatıp tekrar dene.';
  if(code==='not_granted')return'Gemini anahtarı girilmemiş: ses yazıya dökülemez. Bu sayfanın üstündeki “Yapay zekâ (Gemini)” bölümüne anahtarını yapıştır.';
  return'';
}
window.__atlMicHelp=micHelp;
async function micPerm(){try{const r=await navigator.permissions.query({name:'microphone'});return r.state}catch(e){return'?'}}
async function micPaint(){const ul=document.getElementById('atlMicSt');if(!ul)return;const k=!!aiKey(),p=await micPerm();
  ul.innerHTML=`<li>Gemini anahtarı: ${k?'✓ girildi':'✗ <b>girilmedi</b> (sesle yazma için gerekli)'}</li><li>Mikrofon izni: ${p==='granted'?'✓ verildi':p==='denied'?'✗ <b>engellenmiş</b>':'henüz sorulmadı (“Mikrofonu dene”ye bas)'}</li>`}
let MIC_T=null;
async function micTest(){const m=document.getElementById('atlMicMsg'),bar=document.getElementById('atlMicBar'),b=document.getElementById('atlMicTest');
  if(MIC_T)return;m.textContent='Mikrofon açılıyor…';bar.style.width='0';
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){m.textContent='Bu tarayıcı mikrofonu desteklemiyor.';return}
  let st;try{st=await navigator.mediaDevices.getUserMedia({audio:true})}
  catch(e){const n=e&&e.name;m.textContent='✗ '+micHelp(n==='NotAllowedError'||n==='SecurityError'?'mic_denied':n==='NotReadableError'||n==='AbortError'?'mic_busy':'mic_none')+(n?`\n(hata: ${n})`:'');micPaint();return}
  const tr=st.getAudioTracks()[0],AC=window.AudioContext||window.webkitAudioContext,ac=new AC(),an=ac.createAnalyser();an.fftSize=1024;ac.createMediaStreamSource(st).connect(an);
  const buf=new Float32Array(an.fftSize);let peak=0;b.disabled=true;m.textContent=`Dinliyorum: “${tr&&tr.label||'mikrofon'}”. Bir şeyler söyle…`;
  const t0=Date.now();await new Promise(res=>{MIC_T=setInterval(()=>{an.getFloatTimeDomainData(buf);let s=0;for(const x of buf)s+=x*x;const rms=Math.sqrt(s/buf.length);peak=Math.max(peak,rms);bar.style.width=Math.min(100,rms*400)+'%';if(Date.now()-t0>4000){clearInterval(MIC_T);MIC_T=null;res()}},60)});
  st.getTracks().forEach(t=>t.stop());try{ac.close()}catch(e){}bar.style.width='0';b.disabled=false;
  m.textContent=peak>0.02?`✓ Mikrofon çalışıyor (${tr&&tr.label||'mikrofon'}).`+(aiKey()?' Sesle yazmaya hazır.':'\n'+micHelp('not_granted')):`Mikrofon açıldı ama ses gelmedi (${tr&&tr.label||'mikrofon'}). Mac’te Sistem Ayarları → Ses → Giriş’ten doğru mikrofonun seçili ve sesinin açık olduğunu denetle.`;
  micPaint();
}
/* ---------- window.claude ---------- */
window.claude={use:async name=>{
  if(name==='db'){await auth();return DB}
  if(name==='user'){await auth();return USERAPI}
  if(name==='sample')return sample;
  if(name==='downloads')return DOWNLOADS;
  if(name==='mcp'){await auth();return MCP}
  return null;
}};
/* ---------- Ayarlar sayfasına: hesap, yapay zekâ, yedekten içe aktarma ---------- */
function settingsUI(){
  const pg=document.getElementById('pg-settings');if(!pg||document.getElementById('atlSet'))return;
  const sec=document.createElement('section');sec.className='set';sec.id='atlSet';sec.setAttribute('aria-labelledby','atlAiT');
  sec.innerHTML=`<h2 id="atlAiT">Yapay zekâ (Gemini)</h2>
    <p>Asistan ve ekran görüntüsünden okuma Google Gemini'nin ücretsiz planıyla çalışır. Anahtarı <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> adresinden ücretsiz alıp buraya yapıştır. Müşteri adları Google'a gönderilmeden önce “Müşteri 1” gibi takma adlarla değiştirilir. Mikrofonla yazarken ses kaydı yazıya dökülmek için Gemini'ye gönderilir.</p>
    <div class="bk"><input id="atlKey" type="password" autocomplete="off" placeholder="AIza…" style="flex:1;min-width:200px;border:1px solid var(--line);border-radius:12px;background:var(--soft);padding:10px 12px;font:inherit"><button type="button" class="btn primary" id="atlKeySave">Kaydet</button></div>
    <span class="bk-last" id="atlKeyMsg"></span>
    <h2>Mikrofon ve sesle yazma</h2>
    <p>🎤 düğmesine bas, konuş, tekrar bas; söylediklerin yazıya dökülür. Çalışmıyorsa aşağıdan dene, sorun neyse burada yazar.</p>
    <ul id="atlMicSt" style="margin:0 0 10px;padding-left:18px;line-height:1.7"></ul>
    <div class="bk"><button type="button" class="btn" id="atlMicTest">Mikrofonu dene</button>
      <span style="flex:1;min-width:140px;height:10px;border-radius:99px;background:var(--soft);overflow:hidden;align-self:center"><i id="atlMicBar" style="display:block;height:100%;width:0;background:var(--ok,#1F9D55);transition:width .08s"></i></span></div>
    <span class="bk-last" id="atlMicMsg" style="white-space:pre-line"></span>
    <h2>Hesap</h2><p id="atlAcc"></p>
    <div class="bk"><button type="button" class="btn" id="atlImp">Yedekten içe aktar (JSON)</button><button type="button" class="btn danger" id="atlOut">Çıkış yap</button><input type="file" id="atlImpF" accept=".json,application/json" hidden></div>
    <span class="bk-last" id="atlImpMsg"></span>`;
  const first=pg.querySelector('.set');first?first.after(sec):pg.appendChild(sec);
  const paint=()=>{const k=aiKey();document.getElementById('atlKey').value='';document.getElementById('atlKey').placeholder=k?'Anahtar kayıtlı (değiştirmek için yenisini yapıştır)':'AIza…';document.getElementById('atlKeyMsg').textContent=k?'✓ Anahtar bu cihazda kayıtlı'+(MODEL_OK?` · model: ${MODEL_OK}`:''):'Anahtar girilmedi: asistan ve ekran görüntüsü okuma kapalı.';document.getElementById('atlAcc').textContent=USER?`Giriş yapılan hesap: ${USER.email}`:''};
  paint();micPaint();
  document.getElementById('atlMicTest').onclick=micTest;
  document.getElementById('atlKeySave').onclick=async()=>{const v=document.getElementById('atlKey').value.trim();if(!v){LS('atl-gemini-key',null);paint();return}
    const m=document.getElementById('atlKeyMsg');m.textContent='Deneniyor…';LS('atl-gemini-key',v);
    try{await gem([{role:'user',parts:[{text:'Sadece "tamam" yaz.'}]}],{stream:false,A:{M:[],back:new Map()}});paint();micPaint();m.textContent='✓ Anahtar çalışıyor · model: '+MODEL_OK}
    catch(e){m.textContent=e.code==='not_granted'?'Anahtar geçersiz; tekrar kopyalayıp yapıştır.':e.code==='rate_limited'?'Anahtar kaydedildi; şu an kullanım sınırına gelinmiş, biraz sonra çalışır.':'Anahtar kaydedildi ama denenemedi: '+(e.message||e.code)}};
  document.getElementById('atlOut').onclick=()=>{if(confirm('Bu cihazda çıkış yapılsın mı?'))sb.auth.signOut()};
  document.getElementById('atlImp').onclick=()=>document.getElementById('atlImpF').click();
  document.getElementById('atlImpF').onchange=async e=>{const f=e.target.files[0];if(!f)return;const m=document.getElementById('atlImpMsg');
    try{const j=JSON.parse(await f.text()),cols=j&&j.collections||j;let n=0,rows=[];
      Object.entries(cols).forEach(([c,list])=>{if(!/^[a-z_]{1,32}$/.test(c)||!Array.isArray(list))return;list.forEach(r=>{if(!r||!r.id)return;const{id,...data}=r;rows.push({owner:USER.id,col:c,id:String(id),data,updated_at:new Date().toISOString()})})});
      if(!rows.length)throw new Error('Dosyada kayıt bulunamadı');
      if(!confirm(`${rows.length} kayıt içe aktarılacak. Aynı kimlikteki kayıtların üzerine yazılır. Devam edilsin mi?`))return;
      for(let i=0;i<rows.length;i+=500){m.textContent=`Aktarılıyor… ${Math.min(rows.length,i+500)}/${rows.length}`;const{error}=await sb.from('docs').upsert(rows.slice(i,i+500),{onConflict:'owner,col,id'});if(error)throw error;n+=Math.min(500,rows.length-i)}
      m.textContent=`✓ ${n} kayıt aktarıldı`;await loadAll();[...SUBS.keys()].forEach(emit);
    }catch(er){m.textContent='Aktarılamadı: '+(er.message||er)}finally{e.target.value=''}};
}
document.addEventListener('DOMContentLoaded',()=>{settingsUI();const pg=document.getElementById('pg-settings');if(pg)new MutationObserver(()=>settingsUI()).observe(pg,{childList:true})});
/* ---------- Güncelleme: yeni sürüm yayınlanınca kendiliğinden yenile ---------- */
let VER0=null;
async function verCheck(){try{const r=await fetch('version.json?'+Date.now(),{cache:'no-store'});if(!r.ok)return;const j=await r.json();if(VER0===null){VER0=j.v;return}
  if(j.v!==VER0){const busy=document.querySelector('dialog[open]')||document.activeElement&&/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if(busy){window.__atlUpd=true;return}location.reload()}}catch(e){}}
verCheck();setInterval(verCheck,5*60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')verCheck()});
})();
