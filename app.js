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

/* نختار أحدث نموذج Flash متاح للمفتاح بدل تثبيت اسم قد يتغير */
async function pickModel(key, force=false){
  const cached = LS.get(K_MODEL, '');
  if(cached && !force) return cached;
  const r = await fetch(`${API}/models?pageSize=200&key=${encodeURIComponent(key)}`);
  if(!r.ok) throw await apiError(r);
  const list = ((await r.json()).models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini-/.test(n) && /flash/.test(n) && !/(lite|image|tts|audio|live|thinking|exp|embedding)/.test(n));
  const score = n => {
    if(n === 'gemini-flash-latest') return 1e6;
    const v = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    return v * 100 - (/preview/.test(n) ? 50 : 0) - (/-\d{3,}$|\d{2}-\d{2}/.test(n) ? 1 : 0);
  };
  list.sort((a, b) => score(b) - score(a));
  const model = list[0] || 'gemini-2.5-flash';
  LS.set(K_MODEL, model);
  return model;
}
async function apiError(r){
  let msg = '';
  try{ msg = (await r.json()).error?.message || ''; }catch(e){}
  const e = new Error(msg || `HTTP ${r.status}`); e.status = r.status;
  if(r.status === 400 && /API key/i.test(msg)) e.friendly = 'المفتاح غير صحيح. انسخه من جديد من Google AI Studio.';
  else if(r.status === 403) e.friendly = 'المفتاح لا يملك صلاحية. تأكد أنك أنشأته من Google AI Studio.';
  else if(r.status === 429) e.friendly = 'تجاوزت الحد المجاني المسموح مؤقتاً. انتظر دقيقة ثم أعد المحاولة.';
  else if(r.status >= 500) e.friendly = 'خدمة Google مشغولة الآن. أعد المحاولة بعد قليل.';
  return e;
}
async function gemini(body, {retryModel=true}={}){
  const key = getKey();
  if(!key) throw Object.assign(new Error('nokey'), {friendly:'أضف مفتاح Gemini أولاً من الإعدادات.'});
  const model = await pickModel(key);
  const r = await fetch(`${API}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
  });
  if(r.status === 404 && retryModel){ LS.del(K_MODEL); await pickModel(key, true); return gemini(body, {retryModel:false}); }
  if(!r.ok) throw await apiError(r);
  const j = await r.json();
  const cand = j.candidates?.[0];
  if(!cand || cand.finishReason === 'SAFETY') throw Object.assign(new Error('blocked'), {friendly:'لم تُرجع الخدمة إجابة لهذه الصورة. جرّب صورة أوضح للعبوة.'});
  return (cand.content?.parts || []).map(p => p.text || '').join('');
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
  try{ return JSON.parse(text); }
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
  key = key.trim();
  if(!/^AIza[\w-]{20,}$/.test(key)){ msgEl.className = 'msg err'; msgEl.textContent = 'شكل المفتاح غير صحيح. يبدأ عادة بـ AIza.'; return false; }
  msgEl.className = 'msg'; msgEl.textContent = 'جارٍ التحقق…';
  try{
    LS.del(K_MODEL);
    const model = await pickModel(key, true);
    LS.set(K_KEY, key);
    msgEl.className = 'msg ok'; msgEl.textContent = `تم الحفظ. النموذج المستخدم: ${model}`;
    return true;
  }catch(e){
    msgEl.className = 'msg err'; msgEl.textContent = e.friendly || 'تعذر التحقق من المفتاح. تحقق من الإنترنت.';
    return false;
  }
}
$('keySave').addEventListener('click', async ()=>{ if(await verifyAndSave($('keyInput').value, $('keyMsg'))) setTimeout(refreshHome, 600); });
$('settingsBtn').addEventListener('click', ()=>{
  $('keyEdit').value = getKey(); $('keyEditMsg').textContent = '';
  $('modelInfo').textContent = LS.get(K_MODEL, '') ? `النموذج الحالي: ${LS.get(K_MODEL, '')}. المفتاح محفوظ على هذا الجهاز فقط ويُرسل إلى Google وحدها.` : '';
  $('settings').showModal();
});
$('settings').addEventListener('click', e=>{ if(e.target === $('settings') || e.target.closest('[data-close]')) $('settings').close(); });
$('keyEditSave').addEventListener('click', async ()=>{ if(await verifyAndSave($('keyEdit').value, $('keyEditMsg'))) refreshHome(); });
$('keyRemove').addEventListener('click', ()=>{ LS.del(K_KEY); LS.del(K_MODEL); $('settings').close(); refreshHome(); toast('حُذف المفتاح'); });
$('clearHist').addEventListener('click', ()=>{ if(confirm('مسح كل السجل من هذا الجهاز؟')){ LS.set(K_HIST, []); renderHistory(); $('settings').close(); } });

/* الالتقاط */
$('photo').addEventListener('change', async e=>{
  const f = e.target.files[0]; e.target.value = '';
  if(!f) return;
  try{
    S.image = await prepareImage(f);
    $('previewImg').src = S.image.dataUrl;
    show('shootBox', false); show('previewBox', true); show('result', false);
    $('analyze').focus();
  }catch(err){ toast('تعذر قراءة الصورة. جرّب صورة أخرى.', true); }
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
  $('loading').scrollIntoView({behavior:'smooth', block:'center'});
  try{
    const drug = await identify({image, name});
    S.current = {drug, thumb:image?.thumb || '', at:Date.now(), id:Date.now(), query:name};
    S.qa = [];
    if(drug.isMedicine) saveHistory(S.current);
    renderResult();
  }catch(e){
    console.error(e);
    $('result').innerHTML = `<p class="msg err" style="margin:0">${esc(e.friendly || 'تعذر الاتصال بالخدمة. تحقق من الإنترنت ثم أعد المحاولة.')}</p>
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

/* السجل */
function saveHistory(item){
  let h = LS.get(K_HIST, []);
  const key = (item.drug.nameEn || item.drug.nameAr || '').toLowerCase();
  h = h.filter(x => (x.drug.nameEn || x.drug.nameAr || '').toLowerCase() !== key);
  h.unshift(item);
  h = h.slice(0, 30);
  while(!LS.set(K_HIST, h) && h.length > 1) h.pop();
}
function renderHistory(){
  const h = getKey() ? LS.get(K_HIST, []) : [];
  show('historyCard', h.length > 0);
  $('history').innerHTML = h.map(x => `<div class="h">${x.thumb ? `<img src="${x.thumb}" alt="">` : `<span class="ph">${ico('pill')}</span>`}
    <button type="button" class="open" data-open="${x.id}"><b>${esc(x.drug.nameAr || x.drug.nameEn)}</b><small>${esc((x.drug.activeIngredients || []).map(i => i.name).join('، '))} · ${new Date(x.at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', {day:'numeric', month:'long'})}</small></button>
    <button type="button" class="del" data-del="${x.id}" aria-label="حذف من السجل">${ico('trash')}</button></div>`).join('');
}
$('history').addEventListener('click', e=>{
  const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]');
  const h = LS.get(K_HIST, []);
  if(d){ LS.set(K_HIST, h.filter(x => x.id !== +d.dataset.del)); renderHistory(); return; }
  if(o){ const x = h.find(i => i.id === +o.dataset.open); if(x){ S.current = x; S.qa = []; renderResult(); } }
});

refreshHome();
