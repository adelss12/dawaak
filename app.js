/* افهم دواءك — الإصدار 2 (Gemini) */
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ico = n => `<svg class="ico" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const LS = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};
function toast(m, err=false){ const t = $('toast'); t.textContent = m; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(t._t); t._t = setTimeout(()=> t.classList.remove('show'), 2800); }

/* ============ Gemini ============ */
const API = 'https://generativelanguage.googleapis.com/v1beta';
const K_KEY = 'dawaak_gemini_key', K_MODEL = 'dawaak_gemini_model', K_HIST = 'dawaak_history_v2';
const getKey = () => LS.get(K_KEY, '');
const K_MODE = 'dawaak_key_mode';
/* نرسل المفتاح في الترويسة x-goog-api-key، وإن فشل نجرّب ?key= (المفاتيح الجديدة AQ. والقديمة AIza) */
async function gfetch(path, key, init={}){
  const modes = LS.get(K_MODE, '') === 'query' ? ['query','header'] : ['header','query'];
  let last;
  for(const mode of modes){
    try{
      const url = mode === 'query' ? `${API}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}` : `${API}${path}`;
      const headers = {...(init.headers || {})};
      if(mode === 'header') headers['x-goog-api-key'] = key;
      const r = await fetch(url, {...init, headers});
      if(r.ok || ![400,401,403].includes(r.status)){ if(r.ok) LS.set(K_MODE, mode); return r; }
      last = r;
    }catch(e){ last = e; }
  }
  if(last instanceof Response) return last;
  throw last;
}


/* نختار أحدث نموذج Flash متاح للمفتاح بدل تثبيت اسم قد يتغير */
const K_MODELS = 'dawaak_gemini_models';
/* نحصل على قائمة نماذج Flash المتاحة لمفتاحك ونرتبها: الأحدث المستقر أولاً، ثم البدائل */
async function pickModels(key, force=false){
  const cached = LS.get(K_MODELS, null);
  if(cached && cached.length && !force) return cached;
  let names = [];
  const r = await gfetch('/models?pageSize=200', key);
  if(r.ok){
    names = ((await r.json()).models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(n => /^gemini-/.test(n) && /flash/.test(n) && !/(image|tts|audio|live|thinking|exp|embedding|native)/.test(n));
  }else{
    const e = await apiError(r);
    if([400,401,403].includes(r.status)) throw e;
  }
  const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const score = n => {
    if(n === 'gemini-flash-latest') return 500;
    let s = ver(n) * 100;
    if(/preview/.test(n)) s -= 300;          // المعاينات أقل ثباتاً وأكثر انشغالاً
    if(/lite/.test(n)) s -= 60;              // الخفيف بديل أخير
    if(/-\d{3}$|\d{2}-\d{2}/.test(n)) s -= 1;
    return s;
  };
  names = [...new Set([...names, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'])].sort((x, y) => score(y) - score(x)).slice(0, 5);
  LS.set(K_MODELS, names);
  LS.set(K_MODEL, names[0]);
  return names;
}
async function pickModel(key, force=false){ return (await pickModels(key, force))[0]; }
async function apiError(r){
  let msg = '';
  try{ msg = (await r.json()).error?.message || ''; }catch(e){}
  const e = new Error(msg || `HTTP ${r.status}`); e.status = r.status;
  if((r.status === 400 || r.status === 401) && /key|credential|auth/i.test(msg)) e.friendly = 'المفتاح غير صحيح. انسخه من جديد من Google AI Studio.';
  else if(r.status === 403) e.friendly = 'المفتاح لا يملك صلاحية. تأكد أنك أنشأته من Google AI Studio.';
  else if(r.status === 429) e.friendly = 'تجاوزت الحد المجاني المسموح مؤقتاً. انتظر دقيقة ثم أعد المحاولة.';
  else if(r.status >= 500) e.friendly = 'خدمة Google مشغولة الآن على كل النماذج المتاحة. أعد المحاولة بعد دقيقة.';
  return e;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let onAttempt = null; // لإظهار حالة المحاولات في الواجهة
async function gemini(body){
  const key = getKey();
  if(!key) throw Object.assign(new Error('nokey'), {friendly:'أضف مفتاح Gemini أولاً من الإعدادات.'});
  let models = await pickModels(key);
  let lastErr = null, useSchema = true, refreshed = false;
  for(let mi = 0; mi < models.length; mi++){
    const model = models[mi];
    for(let attempt = 0; attempt < 3; attempt++){
      const b = useSchema ? body : {...body, generationConfig:{...body.generationConfig, responseSchema:undefined}};
      const r = await gfetch(`/models/${model}:generateContent`, key, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)});
      if(r.ok){
        const j = await r.json();
        const cand = j.candidates?.[0];
        if(!cand || cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') throw Object.assign(new Error('blocked'), {friendly:'لم تُرجع الخدمة إجابة لهذه الصورة. جرّب صورة أوضح للعبوة.'});
        if(mi > 0){ LS.set(K_MODEL, model); LS.set(K_MODELS, [model, ...models.filter(m => m !== model)]); } // نبدأ به في المرة القادمة
        return (cand.content?.parts || []).map(p => p.text || '').join('');
      }
      lastErr = await apiError(r);
      lastErr.model = model;
      if(r.status === 404){
        if(!refreshed){ refreshed = true; LS.del(K_MODELS); models = await pickModels(key, true); mi = -1; }
        break; // جرّب النموذج التالي
      }
      if(r.status === 400 && /schema|response_schema|responseSchema|mime/i.test(lastErr.message) && useSchema){ useSchema = false; attempt--; continue; }
      if([400,401,403].includes(r.status)) throw lastErr;
      // 429 أو 5xx: انتظار ثم إعادة، وبعدها ننتقل لنموذج آخر
      onAttempt?.(mi, attempt);
      if(attempt < 2) await sleep(1500 * (attempt + 1) + Math.random() * 500);
    }
  }
  throw lastErr || new Error('failed');
}

const SYSTEM = `أنت صيدلي سريري يشرح الأدوية لمستخدم في السعودية بلغة عربية بسيطة وواضحة.
المطلوب: التعرّف على الدواء من صورة العبوة أو الشريط أو النشرة أو من الاسم المكتوب، ثم تقديم ملخص تثقيفي دقيق.
قواعد مهمة:
- اعتمد على ما يظهر في الصورة (الاسم التجاري، المادة الفعالة، التركيز، الشكل الصيدلاني). اذكر في readFromImage ما قرأته فعلاً.
- استخدم الأسماء المتداولة في السوق السعودي إن عرفتها، واذكر الاسم الإنجليزي.
- الجرعات: اذكر الجرعات المعتادة كما في النشرة المعتمدة للبالغين وللأطفال إن كان مناسباً لهم، والحد الأقصى اليومي، وبين المسافة بين الجرعات. إن كانت الجرعة تعتمد على الحالة أو الوزن فقل ذلك بوضوح ولا تخترع رقماً.
- إن لم تكن متأكداً من هوية الدواء أو التركيز فاجعل confidence منخفضة ووضّح السبب في confidenceNote، واقترح ما يلزم تصويره.
- إن لم تكن الصورة لدواء فاجعل isMedicine = false واشرح السبب.
- لا تخترع معلومات. الجمل قصيرة، والقوائم من 2 إلى 6 نقاط.
- prescription: "بدون وصفة" أو "يُصرف بوصفة طبية" أو "غير متأكد".`;

const SCHEMA = {
  type:'OBJECT',
  properties:{
    isMedicine:{type:'BOOLEAN'},
    notMedicineReason:{type:'STRING'},
    readFromImage:{type:'STRING'},
    nameAr:{type:'STRING'}, nameEn:{type:'STRING'},
    activeIngredients:{type:'ARRAY', items:{type:'OBJECT', properties:{name:{type:'STRING'}, strength:{type:'STRING'}}}},
    form:{type:'STRING'}, category:{type:'STRING'}, prescription:{type:'STRING'},
    summary:{type:'STRING'},
    uses:{type:'ARRAY', items:{type:'STRING'}},
    howToUse:{type:'ARRAY', items:{type:'STRING'}},
    dosing:{type:'OBJECT', properties:{adults:{type:'STRING'}, children:{type:'STRING'}, maxDaily:{type:'STRING'}, notes:{type:'STRING'}}},
    sideEffects:{type:'ARRAY', items:{type:'STRING'}},
    seekHelp:{type:'ARRAY', items:{type:'STRING'}},
    cautions:{type:'ARRAY', items:{type:'STRING'}},
    interactions:{type:'ARRAY', items:{type:'STRING'}},
    pregnancy:{type:'STRING'}, storage:{type:'STRING'},
    confidence:{type:'STRING', enum:['high','medium','low']}, confidenceNote:{type:'STRING'}
  },
  required:['isMedicine','confidence']
};

async function identify({image, name}){
  const parts = [];
  if(image) parts.push({inline_data:{mime_type:'image/jpeg', data:image.base64}});
  parts.push({text: image ? `تعرّف على الدواء في الصورة${name ? ` (قد يكون اسمه: ${name})` : ''} وقدّم الملخص.` : `الدواء: ${name}\nقدّم الملخص عن هذا الدواء.`});
  const text = await gemini({
    systemInstruction:{parts:[{text:SYSTEM}]},
    contents:[{role:'user', parts}],
    generationConfig:{temperature:0.2, responseMimeType:'application/json', responseSchema:SCHEMA}
  });
  try{ return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch(e){ throw Object.assign(new Error('parse'), {friendly:'وصلت إجابة غير مكتملة. أعد المحاولة.'}); }
}
async function askFollowUp(drug, question, prev){
  const ctx = `معلومات الدواء التي سبق تقديمها:\n${JSON.stringify(drug)}`;
  const contents = [{role:'user', parts:[{text:ctx}]}, {role:'model', parts:[{text:'حسناً، اسألني عن هذا الدواء.'}]}];
  for(const x of prev){ contents.push({role:'user', parts:[{text:x.q}]}, {role:'model', parts:[{text:x.a}]}); }
  contents.push({role:'user', parts:[{text:question}]});
  return gemini({
    systemInstruction:{parts:[{text:SYSTEM + '\nأجب الآن عن سؤال المستخدم عن هذا الدواء نفسه بإيجاز ووضوح، بنص عادي دون JSON ودون تنسيق Markdown. إن كان السؤال يحتاج تقييماً طبياً شخصياً فانصح بمراجعة الطبيب أو الصيدلي.'}]},
    contents, generationConfig:{temperature:0.3}
  });
}

/* ============ الصور ============ */
function prepareImage(file, maxDim=1600, q=0.85){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = ()=>{
      const s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const dataUrl = cv.toDataURL('image/jpeg', q);
      // صورة مصغّرة للسجل
      const t = document.createElement('canvas'), ts = 120 / Math.max(cv.width, cv.height);
      t.width = Math.round(cv.width * ts); t.height = Math.round(cv.height * ts);
      t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height);
      URL.revokeObjectURL(url);
      resolve({dataUrl, base64:dataUrl.split(',')[1], thumb:t.toDataURL('image/jpeg', 0.7)});
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('img')); };
    img.src = url;
  });
}

/* ============ الحالة والواجهة ============ */
const S = { image:null, current:null, qa:[] };
function show(id, on=true){ $(id).hidden = !on; }
function refreshHome(){
  const has = !!getKey();
  show('setup', !has); show('capture', has);
  renderHistory();
}

/* الإعداد */
async function verifyAndSave(key, msgEl){
  // إزالة المسافات والأسطر وعلامات الاقتباس التي قد تُلصق مع المفتاح
  key = String(key || '').replace(/[\s"'“”‘’<>]/g, '');
  if(key.length < 20){ msgEl.className = 'msg err'; msgEl.textContent = 'المفتاح قصير أو ناقص. انسخه كاملاً بزر النسخ في Google AI Studio.'; return false; }
  msgEl.className = 'msg'; msgEl.textContent = 'جارٍ التحقق…';
  try{
    LS.del(K_MODEL); LS.del(K_MODE); LS.del(K_MODELS);
    const model = await pickModel(key, true);
    LS.set(K_KEY, key);
    persistStorage();
    msgEl.className = 'msg ok'; msgEl.textContent = `تم الحفظ. النموذج المستخدم: ${model}`;
    return true;
  }catch(e){
    msgEl.className = 'msg err';
    msgEl.textContent = (e.friendly || 'تعذر التحقق من المفتاح. تحقق من الإنترنت.') + (e.message && !/^HTTP/.test(e.message) ? `\nرسالة Google: ${e.message}` : (e.status ? ` (رمز ${e.status})` : ''));
    return false;
  }
}
/* زر «لصق» للمفتاح: يقرأ النص من الحافظة مباشرة */
$('keyPaste').addEventListener('click', async ()=>{
  try{
    const t = (await navigator.clipboard.readText()).trim();
    if(!t){ toast('الحافظة فارغة. انسخ المفتاح أولاً.', true); return; }
    $('keyInput').value = t;
  }catch(e){
    $('keyInput').focus();
    toast('اضغط مطولاً في خانة المفتاح واختر «لصق»');
  }
});
/* نطلب من المتصفح حفظ بيانات البرنامج (المفتاح والسجل) بشكل دائم حتى لا يمسحها عند امتلاء الذاكرة */
function persistStorage(){ try{ navigator.storage?.persist?.(); }catch(e){} }
persistStorage();

$('keySave').addEventListener('click', async ()=>{ if(await verifyAndSave($('keyInput').value, $('keyMsg'))) setTimeout(refreshHome, 600); });
$('settingsBtn').addEventListener('click', ()=>{
  $('keyEdit').value = getKey(); $('keyEditMsg').textContent = '';
  $('modelInfo').textContent = LS.get(K_MODEL, '') ? `النموذج الحالي: ${LS.get(K_MODEL, '')}، والبدائل: ${(LS.get(K_MODELS, []) || []).slice(1).join('، ') || '—'}. المفتاح محفوظ على هذا الجهاز فقط ويُرسل إلى Google وحدها.` : '';
  $('settings').showModal();
});
$('settings').addEventListener('click', e=>{ if(e.target === $('settings') || e.target.closest('[data-close]')) $('settings').close(); });
$('keyEditSave').addEventListener('click', async ()=>{ if(await verifyAndSave($('keyEdit').value, $('keyEditMsg'))) refreshHome(); });
$('keyRemove').addEventListener('click', ()=>{ LS.del(K_KEY); LS.del(K_MODEL); LS.del(K_MODE); LS.del(K_MODELS); $('settings').close(); refreshHome(); toast('حُذف المفتاح'); });
$('clearHist').addEventListener('click', async ()=>{ if(confirm('مسح كل سجل البحث من هذا الجهاز؟ (يُنصح بحفظ نسخة احتياطية أولاً)')){ await Log.clear(); renderHistory(); $('settings').close(); } });

/* الالتقاط */
$('photo').addEventListener('change', e=>{
  const f = e.target.files[0]; e.target.value = '';
  if(f) useImage(f);
});
async function useImage(f){
  if(!getKey()){ toast('أضف مفتاح Gemini أولاً', true); return; }
  try{
    S.image = await prepareImage(f);
    $('previewImg').src = S.image.dataUrl;
    show('shootBox', false); show('previewBox', true); show('result', false);
    $('analyze').focus();
  }catch(err){ toast('تعذر قراءة الصورة. جرّب صورة أخرى.', true); }
}

/* لصق صورة: زر الحافظة، أو Ctrl+V، أو الضغط المطوّل في الخانة على الجوال */
function imageFromClipboardData(dt){
  for(const it of [...(dt?.items || [])]) if(it.kind === 'file' && /^image\//.test(it.type)) return it.getAsFile();
  return [...(dt?.files || [])].find(f => /^image\//.test(f.type)) || null;
}
document.addEventListener('paste', e=>{
  if($('capture').hidden) return;
  const inBox = e.target.closest?.('#pasteBox');
  if(e.target.closest?.('input, textarea') && !inBox) return; // لصق نص عادي في خانات الكتابة
  const f = imageFromClipboardData(e.clipboardData);
  if(f){ e.preventDefault(); $('pasteBox').textContent = ''; useImage(f); }
  else if(inBox){ e.preventDefault(); toast('لا توجد صورة في الحافظة. انسخ الصورة أولاً.', true); }
});
$('pasteBox').addEventListener('input', ()=>{
  // بعض المتصفحات تُدرج الصورة داخل الخانة بدل إرسالها كملف
  const img = $('pasteBox').querySelector('img');
  $('pasteBox').textContent = '';
  if(img?.src){ fetch(img.src).then(r => r.blob()).then(b => useImage(new File([b], 'pasted', {type:b.type || 'image/png'}))).catch(()=> toast('تعذر قراءة الصورة الملصقة', true)); }
});
$('pasteBtn').addEventListener('click', async ()=>{
  if(!navigator.clipboard?.read){ $('pasteBox').focus(); toast('اضغط مطولاً في الخانة المجاورة واختر «لصق»'); return; }
  try{
    for(const item of await navigator.clipboard.read()){
      const type = item.types.find(t => /^image\//.test(t));
      if(type){ const b = await item.getType(type); useImage(new File([b], 'pasted', {type})); return; }
    }
    toast('لا توجد صورة في الحافظة. انسخ الصورة أولاً.', true);
  }catch(e){
    $('pasteBox').focus();
    toast('لم يُسمح بقراءة الحافظة. اضغط مطولاً في الخانة واختر «لصق».', true);
  }
});
$('retake').addEventListener('click', ()=>{ S.image = null; show('previewBox', false); show('shootBox', true); });
$('analyze').addEventListener('click', ()=> run({image:S.image, name:$('nameInput').value.trim()}));
$('searchForm').addEventListener('submit', e=>{ e.preventDefault(); const n = $('nameInput').value.trim(); if(!n){ $('nameInput').focus(); return; } run({image:null, name:n}); });

const STEPS = ['جارٍ قراءة العبوة…', 'جارٍ التعرّف على المادة الفعالة…', 'جارٍ تجهيز الملخص…'];
async function run({image, name}){
  if(!image && !name) return;
  show('result', false); show('loading', true);
  let i = 0; $('loadingText').textContent = image ? STEPS[0] : 'جارٍ البحث عن الدواء…';
  const tm = setInterval(()=>{ if(image && i < STEPS.length - 1) $('loadingText').textContent = STEPS[++i]; }, 2500);
  onAttempt = (mi, attempt)=>{ $('loadingText').textContent = mi === 0 ? `الخدمة مشغولة، نعيد المحاولة (${attempt + 2})…` : 'نجرّب نموذجاً بديلاً…'; };
  $('loading').scrollIntoView({behavior:'smooth', block:'center'});
  try{
    const drug = await identify({image, name});
    S.current = {drug, thumb:image?.thumb || '', at:Date.now(), id:Date.now(), query:name || '',
                 kind:image ? 'image' : 'name', status:drug.isMedicine ? 'ok' : 'notmed', qa:[]};
    S.qa = S.current.qa;
    await Log.put(S.current);
    renderHistory();
    renderResult();
  }catch(e){
    console.error(e);
    Log.put({id:Date.now(), at:Date.now(), kind:image ? 'image' : 'name', query:name || '', thumb:image?.thumb || '',
             status:'error', error:e.friendly || 'تعذر الاتصال بالخدمة', qa:[]}).then(renderHistory);
    const det = e.status ? `\n(رمز ${e.status}${e.model ? ' · ' + e.model : ''}${e.message && !/^HTTP/.test(e.message) ? ' · ' + e.message : ''})` : '';
    $('result').innerHTML = `<p class="msg err" style="margin:0">${esc((e.friendly || 'تعذر الاتصال بالخدمة. تحقق من الإنترنت ثم أعد المحاولة.') + det)}</p>
      <div class="actions"><button type="button" class="btn btn-soft" id="again">إعادة المحاولة</button></div>`;
    show('result', true);
    $('again').onclick = ()=> run({image, name});
  }finally{ clearInterval(tm); show('loading', false); }
}

const CONF = {high:['تعرّف واضح',''], medium:['تعرّف متوسط الثقة','amber'], low:['تعرّف غير مؤكد','red']};
function list(arr){ return (arr || []).filter(Boolean).length ? `<ul>${arr.filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''; }
function sec(icon, title, body, cls=''){ return body ? `<div class="sec ${cls}"><h3>${ico(icon)}${title}</h3>${body}</div>` : ''; }
function renderResult(){
  const {drug:d, thumb} = S.current, box = $('result');
  if(!d.isMedicine){
    box.innerHTML = `<h2>لم نتعرّف على دواء في الصورة</h2><p class="sub">${esc(d.notMedicineReason || 'جرّب تصوير واجهة العبوة بحيث يظهر الاسم والتركيز بوضوح.')}</p>`;
    show('result', true); return;
  }
  const ing = (d.activeIngredients || []).filter(x => x && x.name);
  const conf = CONF[d.confidence] || CONF.medium;
  const rxCls = /وصفة طبية/.test(d.prescription || '') ? 'amber' : 'blue';
  const ds = d.dosing || {};
  const dose = [['البالغون', ds.adults], ['الأطفال', ds.children], ['الحد الأقصى', ds.maxDaily]].filter(r => r[1]);
  box.innerHTML = `
    <div class="hero">${thumb ? `<img src="${thumb}" alt="">` : ''}
      <div><h2>${esc(d.nameAr || d.nameEn || 'دواء')}</h2>${d.nameEn ? `<div class="en">${esc(d.nameEn)}</div>` : ''}
        <div class="tags">
          ${ing.map(x => `<span class="tag">${esc(x.name)}${x.strength ? ' ' + esc(x.strength) : ''}</span>`).join('')}
          ${d.form ? `<span class="tag blue">${esc(d.form)}</span>` : ''}
          ${d.prescription ? `<span class="tag ${rxCls}">${esc(d.prescription)}</span>` : ''}
          <span class="tag ${conf[1]}">${conf[0]}</span>
        </div></div></div>
    ${d.confidence !== 'high' && d.confidenceNote ? `<div class="warnbox">${esc(d.confidenceNote)}</div>` : ''}
    ${d.summary ? `<p class="summary">${esc(d.summary)}</p>` : ''}
    ${sec('target', 'يُستخدم لـ', list(d.uses))}
    ${sec('clock', 'طريقة الاستخدام', list(d.howToUse))}
    ${sec('scale', 'الجرعات المعتادة', dose.length || ds.notes ? `${dose.length ? `<dl class="dose">${dose.map(([a,b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join('')}</dl>` : ''}${ds.notes ? `<p style="margin-top:6px;color:var(--ink-2)">${esc(ds.notes)}</p>` : ''}` : '')}
    ${sec('alert', 'اطلب المساعدة فوراً إذا ظهر', list(d.seekHelp), 'alert')}
    ${sec('bolt', 'أعراض جانبية شائعة', list(d.sideEffects))}
    ${sec('ban', 'احتياطات وموانع', list(d.cautions))}
    ${sec('link', 'تداخلات مع أدوية أو أطعمة', list(d.interactions))}
    ${sec('baby', 'الحمل والرضاعة', d.pregnancy ? `<p>${esc(d.pregnancy)}</p>` : '')}
    ${sec('box', 'الحفظ', d.storage ? `<p>${esc(d.storage)}</p>` : '')}
    ${d.category ? `<p class="sub" style="margin-top:12px">التصنيف: ${esc(d.category)}</p>` : ''}
    <div class="sec"><h3>${ico('chat')}اسأل عن هذا الدواء</h3>
      <form id="askForm" class="search"><input class="input" id="askInput" placeholder="مثال: هل آخذه قبل الأكل أم بعده؟" aria-label="سؤالك"><button class="btn btn-soft" type="submit">اسأل</button></form>
      <div class="qa" id="qa"></div></div>
    <div class="actions">
      <button type="button" class="btn btn-soft" id="shareRes">${ico('share')}مشاركة الملخص</button>
      <button type="button" class="btn btn-line" id="newRes">دواء آخر</button>
    </div>
    <p class="disclaimer">ملخص تثقيفي آلي قد يخطئ، ولا يغني عن نشرة الدواء أو استشارة الطبيب أو الصيدلي. تأكد دائماً من الاسم والتركيز المكتوبين على عبوتك. في الحالات الطارئة اتصل بالإسعاف على 997.</p>`;
  show('result', true);
  renderQA();
  $('result').scrollIntoView({behavior:'smooth', block:'start'});
  $('askForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const q = $('askInput').value.trim(); if(!q) return;
    const btn = e.target.querySelector('button'); btn.disabled = true;
    S.qa.push({q, a:'…'}); renderQA(); $('askInput').value = '';
    try{ S.qa[S.qa.length - 1].a = (await askFollowUp(S.current.drug, q, S.qa.slice(0, -1))).trim(); }
    catch(err){ S.qa[S.qa.length - 1].a = err.friendly || 'تعذر الحصول على إجابة الآن.'; }
    btn.disabled = false; renderQA();
    if(S.current?.id){ S.current.qa = S.qa; Log.put(S.current); }
  });
  $('shareRes').addEventListener('click', shareSummary);
  $('newRes').addEventListener('click', ()=>{ S.image = null; show('previewBox', false); show('shootBox', true); show('result', false); $('nameInput').value = ''; window.scrollTo({top:0, behavior:'smooth'}); });
}
function renderQA(){ $('qa').innerHTML = S.qa.map(x => `<div class="q">${esc(x.q)}</div><div class="a">${esc(x.a)}</div>`).join(''); }
async function shareSummary(){
  const d = S.current.drug;
  const lines = [`${d.nameAr || ''}${d.nameEn ? ` (${d.nameEn})` : ''}`,
    (d.activeIngredients || []).map(x => `${x.name} ${x.strength || ''}`).join('، '), '', d.summary || '',
    d.uses?.length ? '\nيُستخدم لـ:\n- ' + d.uses.join('\n- ') : '',
    d.dosing?.adults ? `\nالجرعة المعتادة للبالغين: ${d.dosing.adults}` : '',
    d.seekHelp?.length ? '\nاطلب المساعدة فوراً إذا ظهر:\n- ' + d.seekHelp.join('\n- ') : '',
    '\n(ملخص تثقيفي من «افهم دواءك» لا يغني عن الطبيب أو الصيدلي)'];
  const text = lines.filter(x => x !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  try{
    if(navigator.share) await navigator.share({text});
    else{ await navigator.clipboard.writeText(text); toast('نُسخ الملخص'); }
  }catch(e){ if(e.name !== 'AbortError'){ try{ await navigator.clipboard.writeText(text); toast('نُسخ الملخص'); }catch(_){} } }
}

/* ============ سجل البحث: كل عملية بحث تُحفظ في IndexedDB على هذا الجهاز ============ */
const Log = (()=>{
  const DB = 'dawaak', STORE = 'searches';
  let dbp = null, mem = null;          // mem: احتياطي في الذاكرة إن تعذر IndexedDB (التصفح الخاص)
  function open(){
    if(dbp) return dbp;
    dbp = new Promise((res, rej)=>{
      try{
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = ()=> r.result.createObjectStore(STORE, {keyPath:'id'});
        r.onsuccess = ()=> res(r.result);
        r.onerror = ()=> rej(r.error);
      }catch(e){ rej(e); }
    }).catch(e=>{ mem = mem || []; return null; });
    return dbp;
  }
  async function tx(mode, fn){
    const db = await open();
    if(!db) return fn(null);
    return new Promise((res, rej)=>{
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
      let out; Promise.resolve(fn(st)).then(v => out = v);
      t.oncomplete = ()=> res(out); t.onerror = ()=> rej(t.error); t.onabort = ()=> rej(t.error);
    });
  }
  const req = r => new Promise((res, rej)=>{ r.onsuccess = ()=> res(r.result); r.onerror = ()=> rej(r.error); });
  return {
    async all(){
      const list = await tx('readonly', st => st ? req(st.getAll()) : mem.slice());
      return (list || []).sort((a, b)=> b.at - a.at);
    },
    put(item){
      const clean = JSON.parse(JSON.stringify(item));
      return tx('readwrite', st => st ? req(st.put(clean)) : (mem = mem.filter(x => x.id !== clean.id).concat(clean))).catch(()=>{});
    },
    del(id){ return tx('readwrite', st => st ? req(st.delete(id)) : (mem = mem.filter(x => x.id !== id))).catch(()=>{}); },
    clear(){ return tx('readwrite', st => st ? req(st.clear()) : (mem = [])).catch(()=>{}); },
    async migrate(){                     // نقل السجل القديم (آخر 30 دواء) مرة واحدة
      const old = LS.get(K_HIST, null);
      if(!Array.isArray(old) || !old.length) return;
      for(const x of old) await this.put({...x, kind:x.thumb ? 'image' : 'name', status:'ok', query:x.query || '', qa:x.qa || []});
      LS.del(K_HIST);
    }
  };
})();

const H = { all:[], shown:20, filter:'' };
const STATUS = {notmed:['لم يُتعرّف على دواء','amber'], error:['فشل البحث','red']};
const fmtWhen = t => new Date(t).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit'});
const titleOf = x => x.drug?.isMedicine ? (x.drug.nameAr || x.drug.nameEn) : (x.query || (x.kind === 'image' ? 'صورة' : 'بحث'));
async function renderHistory(){
  if(!getKey()){ show('historyCard', false); return; }
  H.all = await Log.all();
  show('historyCard', H.all.length > 0);
  $('histCount').textContent = H.all.length ? `(${H.all.length})` : '';
  const f = H.filter.trim().toLowerCase();
  const list = f ? H.all.filter(x => [titleOf(x), x.query, x.drug?.nameEn, x.drug?.nameAr,
                                      ...(x.drug?.activeIngredients || []).map(i => i.name)].join(' ').toLowerCase().includes(f))
                 : H.all;
  const part = list.slice(0, H.shown);
  $('history').innerHTML = part.map(x => {
    const st = STATUS[x.status];
    const sub = x.status === 'ok' ? (x.drug.activeIngredients || []).map(i => i.name).join('، ') : (x.error || x.drug?.notMedicineReason || '');
    return `<div class="h">${x.thumb ? `<img src="${x.thumb}" alt="">` : `<span class="ph">${ico(x.kind === 'image' ? 'camera' : 'search')}</span>`}
    <button type="button" class="open" data-open="${x.id}"><b>${esc(titleOf(x))}</b>
      <small>${st ? `<span class="tag ${st[1]} mini">${st[0]}</span> ` : ''}${x.qa?.length ? `💬 ${x.qa.length} · ` : ''}${esc(fmtWhen(x.at))}</small>
      ${sub ? `<small class="line">${esc(sub)}</small>` : ''}</button>
    <button type="button" class="del" data-del="${x.id}" aria-label="حذف من السجل">${ico('trash')}</button></div>`;
  }).join('') || `<p class="sub" style="margin:8px 0">لا توجد نتائج لـ «${esc(H.filter)}»</p>`;
  show('histMore', list.length > H.shown);
  $('histMore').textContent = `عرض المزيد (${list.length - H.shown})`;
}
$('histFilter').addEventListener('input', e=>{ H.filter = e.target.value; H.shown = 20; renderHistory(); });
$('histMore').addEventListener('click', ()=>{ H.shown += 30; renderHistory(); });
$('history').addEventListener('click', async e=>{
  const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]');
  if(d){ await Log.del(+d.dataset.del); renderHistory(); return; }
  if(!o) return;
  const x = H.all.find(i => i.id === +o.dataset.open);
  if(!x) return;
  if(x.drug){ S.current = x; S.qa = x.qa || (x.qa = []); renderResult(); return; }
  if(x.query){ $('nameInput').value = x.query; run({image:null, name:x.query}); return; }   // بحث فاشل بالاسم ← نعيده
  toast('هذا بحث بالصورة لم يكتمل. صوّر العبوة مرة أخرى.', true);
});

/* نسخة احتياطية من السجل (ملف) واستعادتها */
$('histExport').addEventListener('click', async ()=>{
  const data = JSON.stringify({app:'dawaak', version:1, exported:new Date().toISOString(), searches:await Log.all()});
  const name = `سجل-دوائي-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([data], name, {type:'application/json'});
  try{
    if(navigator.canShare?.({files:[file]})){ await navigator.share({files:[file], title:'سجل افهم دواءك'}); return; }
  }catch(e){ if(e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 4000);
});
$('histImport').addEventListener('click', ()=> $('histFile').click());
$('histFile').addEventListener('change', async e=>{
  const f = e.target.files[0]; e.target.value = '';
  if(!f) return;
  try{
    const j = JSON.parse(await f.text());
    const items = (j.searches || []).filter(x => x && x.id && x.at);
    for(const x of items) await Log.put(x);
    toast(`استُعيد ${items.length} بحث`); $('settings').close(); renderHistory();
  }catch(err){ toast('الملف غير صالح', true); }
});

Log.migrate().then(renderHistory);

refreshHome();
