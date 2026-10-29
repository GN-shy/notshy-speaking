import {ExamEngine,SprintEngine,STAGES,tokens} from './engine.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=s=>{s=Math.max(0,Math.floor(Number.isFinite(s)?s:0));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
const date=ts=>new Date(ts*1000).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const ICONS={grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',book:'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15"/>',history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',settings:'<path d="M9 4 10 2h4l1 2 3 2 3 1v4l-2 2-1 3v3l-4 2-2-1-3-1-3 1-3-3 1-3-1-3-1-2 2-4h3z"/><circle cx="12" cy="11" r="3"/>',mic:'<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',check:'<path d="m5 12 4 4L19 6"/>',leaf:'<path d="M4 20c0-11 2-16 16-16 0 14-5 16-12 13M4 20 15 9"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',volume:'<path d="m11 4-6 5H2v6h3l6 5V4M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',play:'<path d="m8 4 12 8-12 8V4z"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]||ICONS.book}</svg>`;
function icons(){$$('i[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
const defaults={region:'mainland',identity:'student',voice:'local',rate:'0',autoNext:true,adaptive:true,transcribe:false};
function stored(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
let settings={...defaults,...stored('speaking-settings',{})};
let bank,usage={},examUsage={},examTopics={},history=[],sprint={},token='',route='home',partFilter=1,engine=null,session=null;
let stream=null,audioContext=null,analyser=null,recording=null,speechAudio=null,speechAbort=null,speechResolve=null;
let recorderStopping=Promise.resolve(),persistQueue=Promise.resolve(),speaking=false,generation=0,recognition=null;
let voiceTimer=null,recRestart=null,listenActive=false,recognitionBlocked=false;
let animation=0,interval=null,saveInterval=null,finishing=false,allowText=false,endingDecision=false,questionLoading=false;
const recordingJobs=new Set();
function toast(message,long=false){const el=$('#toast');el.textContent=message;el.classList.remove('hidden');clearTimeout(voiceTimer);voiceTimer=setTimeout(()=>el.classList.add('hidden'),long?6500:3500);}
async function api(path,body){const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-App-Token':token},body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok){let error;try{error=(await response.json()).error;}catch{}throw Error(error||`请求失败 (${response.status})`);}return response.json();}
function modal(html){$('#modal-content').innerHTML=html;if(!$('#modal').open)$('#modal').showModal();icons();}
function closeModal(){$('#modal').close();}
function go(next){if(engine&&engine.stage!=='done'&&next!=='exam'){toast('当前练习进行中。如需离开，请先点击“提前结束”选择保存或不保存。');return;}route=next;$$('.page').forEach(el=>el.classList.toggle('hidden',el.id!==next));$$('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===next));$('#page-name').textContent={home:'练习首页',bank:'口语题库',history:'练习记录',settings:'考试设置',exam:session?.mode==='sprint'?'Shy 十天冲刺':session?.mode==='topic'?'题库练习':'模拟考试'}[next];if(next==='bank')renderBank();if(next==='history')renderHistory();if(next==='settings')renderSettings();window.scrollTo(0,0);}
function available(){return bank.topics.filter(t=>settings.region==='all'||t.region==='mainland');}
function qids(t){return t.part===1?t.questions.map(q=>q.id):[t.id,...t.part3.map(q=>q.id)];}
function topicCount(t){return qids(t).filter(id=>usage[id]).length;}
function examTopicLabel(t){const progress=examTopics[t.id];return progress?`整套：抽到 ${progress.drawn} 次 · 完成 ${progress.completed} 次`:'整套：未抽到';}
function renderHome(){
  const topics=available(),ids=topics.flatMap(qids),seen=ids.filter(id=>usage[id]).length;
  const completed=history.filter(s=>s.status==='completed'&&s.mode==='full').length;
  const minutes=Math.round(history.reduce((n,s)=>n+(s.elapsed||0),0)/60);
  const covered=topics.filter(t=>topicCount(t)>0).length;
  const stats=[['完成模拟',completed,'场','完整走过 Part 1–3','check'],['累计练习',minutes,'分钟','每次开口都算数','clock'],['单题已练',seen,'题',`题库共 ${ids.length} 个问题 / 题卡`,'book'],['单题话题',covered,`/ ${topics.length}`,settings.region==='all'?'全部题库已开启':'默认：中国大陆题库','leaf']];
  $('#stats').innerHTML=stats.map(([label,value,unit,small,i])=>`<div class="stat"><span class="stat-label">${label}</span>${icon(i)}<strong class="stat-value">${value}<small>${unit}</small></strong><p class="stat-bottom">${small}</p></div>`).join('');
  $('#recent').innerHTML=history.length?history.slice(0,2).map(s=>historyRow(s,true)).join(''):`<div class="empty-state">${icon('history')}<strong>你的第一场模拟，还在等你。</strong><small>完成练习后，录音与题目会出现在这里。</small></div>`;
  const p1=topics.filter(t=>t.part===1),p2=topics.filter(t=>t.part===2);
  $('#coverage').innerHTML=[['Part 1 · 日常话题',p1],['Part 2 & 3 · 陈述与讨论',p2]].map(([name,ts])=>{const n=ts.filter(t=>topicCount(t)>0).length;return `<div class="coverage-row"><span>${name}</span><b>${n} / ${ts.length}</b></div><div class="progress-track"><span style="width:${100*n/ts.length}%"></span></div>`;}).join('');
  bindHistoryRows();
  renderSprint();
}
function renderSprint(){
  const saved=sprint.session,done=saved?.status==='completed';
  $('#sprint-status').textContent=`第 ${sprint.day||1} / 10 天 · 已完成 ${sprint.completedDays||0} 天${done?' · 今日任务完成':saved?' · 今日任务已保存，可继续':' · 今天的任务等你开始'}`;
  $('#sprint-days').innerHTML=Array.from({length:10},(_,i)=>{const state=sprint.days?.find(d=>d.day===i+1);return `<span class="${state?.status==='completed'?'done':i+1===(sprint.day||1)?'current':''}">${i+1}${state?.status==='completed'?' ✓':''}</span>`;}).join('');
  $('#start-sprint').textContent=done?'今日任务完成 ✓':saved?'继续今日任务 →':'开始今日任务 →';
}
async function sprintPrompt(){
  if(engine&&engine.stage!=='done'){toast('请先结束当前练习，再进入今日任务。');return;}
  try{
    sprint=await api('/api/sprint');renderSprint();
    if(sprint.session?.status==='completed'){
      modal(`<p class="eyebrow">SHY'S DAILY SPRINT · DAY ${sprint.day}</p><h2 class="modal-title">今日任务完成 ✓</h2><p class="modal-sub">4 个 Part 1 完整主题、6 组 Part 2 与对应全部 Part 3 已完成。${sprint.day===10?'十天计划已到最后一天。':'明天回来继续下一天。'}</p><div class="modal-actions"><button id="sprint-review" class="button primary">查看今日记录</button></div>`);
      $('#sprint-review').onclick=()=>showReview(sprint.session);return;
    }
    modal(`<p class="eyebrow">JUST FOR SHY · DAY ${sprint.day} / 10</p><h2 class="modal-title">${sprint.session?'继续':'开始'}今日冲刺任务</h2><p class="modal-sub">4 个 Part 1 大类，每类全部小题；6 张 Part 2 题卡，每张接对应的全部 Part 3 原题。<br>按这个顺序练完，今天任务就结束。准备和回答均不限时，点击“说完了”才下一题。<br>优先未练题；题库轮完后优先练习次数少的。完成的小题同步显示“单题已练”。中途保存后可继续；不保存会撤销本场进度。${sprint.plan?'<br>今天已组好题，继续时沿用原题与原身份设置。':'<br>首次开始当天记为第 1 天，此后按日期推进，共 10 天。'}</p><p id="start-error" class="muted" role="status"></p><div class="modal-actions"><button id="confirm-start" class="button primary">允许麦克风并${sprint.session?'继续':'开始'} →</button><button id="text-start" class="button secondary">字幕练习（不录音）</button></div>`);
    $('#confirm-start').onclick=()=>begin('sprint',null,false,'practice');$('#text-start').onclick=()=>begin('sprint',null,true,'practice');
  }catch(e){toast(e.message,true);}
}
function historyRow(s,compact=false){const count=s.events.filter(e=>e.kind==='bank'||e.kind==='card').length;const label=s.mode==='sprint'?`Shy 十天冲刺 · 第 ${s.sprintDay} 天`:s.mode==='full'?`模拟考试 · ${s.type==='practice'?'手动下一题':'官方计时'}`:`题库练习 · ${s.topicTitle||'自选话题'}`;return `<button class="history-row ${compact?'compact':''}" data-session="${escape(s.id)}"><span class="history-icon">${icon('mic')}</span><div class="history-info"><strong>${escape(label)}</strong><small>${date(s.started)} · ${count} 道题 · ${fmt(s.elapsed||0)}</small></div><span>${s.status==='completed'?'已完成':'未完成'} ↗</span></button>`;}
function bindHistoryRows(){$$('[data-session]').forEach(el=>el.onclick=()=>showReview(history.find(s=>s.id===el.dataset.session)));}
function renderHistory(){$('#history-list').innerHTML=history.length?history.map(s=>historyRow(s)).join(''):`<div class="panel empty-state">${icon('history')}<strong>这里会记录你的每一次开口。</strong><small>先开始一场模拟，或在题库里选一个话题。</small></div>`;bindHistoryRows();}
function renderBank(){
  const search=$('#bank-search').value.toLowerCase(),filter=$('#bank-progress').value;
  const topics=available().filter(t=>t.part===partFilter).filter(t=>JSON.stringify(t).toLowerCase().includes(search)).filter(t=>filter==='all'||(filter==='new'?topicCount(t)===0:topicCount(t)>0));
  $('#bank-summary').textContent=`共 ${topics.length} 个话题 · ${settings.region==='all'?'全部地区':'中国大陆'} · 单题进度和整套抽题分别统计`;
  $('#bank-list').innerHTML=topics.map(t=>`<button class="topic-card" data-topic="${t.id}"><span class="tag soft">${{new:'新题',retained:'保留题',evergreen:'常考题'}[t.category]} · ${t.region==='mainland'?'大陆':'非大陆'}</span><h3>${escape(t.title)}</h3><p>${escape(t.part===1?t.questions[0].text:t.prompt)}</p><div class="topic-footer"><span>${t.part===1?`${t.questions.length} 个问题`:`1 张题卡 · ${t.part3.length} 个 P3 问题`}</span><span>${topicCount(t)?`单题已练 ${topicCount(t)}/${qids(t).length}`:'单题未练'} ↗</span></div><small class="exam-draw-state">${examTopicLabel(t)}</small></button>`).join('')||'<div class="muted">没有找到对应的话题。</div>';
  $$('[data-topic]').forEach(el=>el.onclick=()=>showTopic(bank.topics.find(t=>t.id===el.dataset.topic)));
}
function showTopic(t){
  const list=qs=>`<ol class="question-list">${qs.map(q=>`<li lang="en">${escape(q.text)}<small>${q.branch?`${q.branch==='student'?'学生':'工作'} · `:''}PDF 第 ${q.page} 页 · ${usage[q.id]?`单题已练 ${usage[q.id].count} 次`:'单题未练'} · 整套抽到 ${examUsage[q.id]?.drawn||0} 次 / 完成 ${examUsage[q.id]?.completed||0} 次</small></li>`).join('')}</ol>`;
  modal(`<p class="eyebrow">PART ${t.part===1?'1':'2 & 3'} · QUESTION BANK</p><h2 class="modal-title">${escape(t.title)}</h2><p class="progress-explanation">单题已练 ${topicCount(t)} / ${qids(t).length} · ${examTopicLabel(t)}<br>题库练习与十天冲刺共用单题已练进度；整套模拟独立记录。</p>${t.part===2?`<div class="modal-cue" lang="en">${escape(t.prompt)}<ul>${t.bullets.map(b=>`<li>${escape(b)}</li>`).join('')}</ul></div><h3 style="margin-top:25px">Part 3 · 对应讨论</h3>${list(t.part3)}`:list(t.questions)}<span class="source-badge">原题来源：用户提供的题库 · ${bank.version} · 非官方发布试题</span><div class="modal-actions"><button id="practice-topic" class="button primary">练习这个话题 →</button></div>`);
  $('#practice-topic').onclick=()=>startPrompt('topic',t.id,'practice');
}
function renderSettings(){const form=$('#settings-form');for(const [key,value]of Object.entries(settings)){const el=form.elements[key];if(el){if(el.type==='checkbox')el.checked=!!value;else el.value=value;}}}
function readSettings(){const result={};for(const key of Object.keys(defaults)){const el=$('#settings-form').elements[key];result[key]=el.type==='checkbox'?el.checked:el.value;}return result;}
function startPrompt(mode='full',topicId=null,type='exam'){
  const t=bank.topics.find(t=>t.id===topicId);
  const full=mode==='full',manual=type==='practice';
  const title=full?`模拟考试 · ${manual?'手动下一题':'官方计时'}`:escape(t.title);
  const description=manual?(full?'按完整考试流程，从姓名问答开始，经过三个 Part 1 话题，再完成配对的 Part 2 与 Part 3。':'题库练习：围绕自己选择的话题练习，Part 2 连同对应 Part 3 一起练。')+'每一步都由你手动推进，点击“说完了”才进入下一题；停顿和超时都不会切题。Part 2 准备不限时，点击“开始回答”再陈述。':'按完整考试流程，从姓名问答开始，进入多个日常话题，再完成题卡陈述与深入讨论。整场 11–14 分钟，录音时优先等你说完再接题，回答过长或阶段时间到时会适时打断，整场仍按官方时长控制。字幕模式按计时推进。Part 2 的 60 秒准备时间从读题结束后开始。';
  const selector=full?`<div class="tabs mode-tabs" aria-label="模拟考试推进方式"><button id="select-timed" class="${manual?'':'active'}" aria-pressed="${!manual}">官方计时 · 自动推进</button><button id="select-manual" class="${manual?'active':''}" aria-pressed="${manual}">自己点击下一题</button></div>`:'';
  modal(`<p class="eyebrow">${full?'FULL MOCK EXAM · PART 0–3':'QUESTION BANK PRACTICE'}</p><h2 class="modal-title">${title}</h2>${selector}<p class="modal-sub">${description}<br>提前结束时可以选择保存或不保存。建议戴上耳机。</p><div class="start-checks"><span>${manual?'不限时 · 手动下一题':'计时 · 自动推进'}</span><span>${settings.region==='all'?'全部地区':'中国大陆'}</span><span>${settings.identity==='student'?'学生':'已工作'}</span><span>未练题优先</span><span>${settings.transcribe?'英文转写已开启':'本地录音'}</span></div><p id="start-error" class="muted" role="status"></p><div class="modal-actions"><button id="confirm-start" class="button primary">允许麦克风并开始 →</button><button id="text-start" class="button secondary">使用字幕模式（不录音）</button></div>`);
  if(full){$('#select-timed').onclick=()=>startPrompt(mode,topicId,'exam');$('#select-manual').onclick=()=>startPrompt(mode,topicId,'practice');}
  $('#confirm-start').onclick=()=>begin(mode,topicId,false,type);$('#text-start').onclick=()=>begin(mode,topicId,true,type);
}
async function prepareMic(){
  if(!navigator.mediaDevices?.getUserMedia)throw Error('当前浏览器不支持麦克风，请使用 Edge 或 Chrome。');
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  audioContext=new (window.AudioContext||window.webkitAudioContext)();await audioContext.resume();
  analyser=audioContext.createAnalyser();analyser.fftSize=2048;audioContext.createMediaStreamSource(stream).connect(analyser);
  stream.getAudioTracks()[0].onended=()=>{if(engine&&engine.stage!=='done'){toast('麦克风已断开。题目继续显示，请重新连接设备。',true);$('#mic-status').textContent='麦克风已断开';$('#mic-dot').classList.add('off');}};
}
async function begin(mode,topicId,textOnly,type){
  const button=$('#confirm-start');button.disabled=true;$('#text-start').disabled=true;
  $('#start-error').textContent=textOnly?'正在准备题目…':'正在请求麦克风权限…';
  try{
    allowText=textOnly;
    if(!textOnly)await prepareMic();
    const daily=mode==='sprint'?await api('/api/sprint',settings):null;
    if(daily?.session?.status==='completed')throw Error('今日任务已经完成。');
    const plan=daily?daily.plan:await api('/api/plan',{...settings,mode,topicId,type});
    engine=mode==='sprint'?new SprintEngine(plan,{...settings,speechDriven:false}):new ExamEngine(plan,{...settings,usage:mode==='full'?examUsage:usage,speechDriven:!textOnly});finishing=false;recognitionBlocked=false;endingDecision=false;
    const selection=mode==='full'?[...plan.part1.slice(0,3).flatMap(t=>t.questions.map(q=>q.id)),plan.part2.id,...plan.part2.part3.map(q=>q.id)]:[];
    session={id:crypto.randomUUID(),started:Date.now()/1000,mode,type,selection,status:'in_progress',topicTitle:bank.topics.find(t=>t.id===topicId)?.title||null,settings:{...settings},events:[],elapsed:0,notes:'',recording:!textOnly};
    if(daily){session={...session,...daily.session,id:daily.sessionId,status:'in_progress',mode:'sprint',type:'practice',sprintDay:daily.day,settings:{...settings,...plan.settings},recording:!textOnly};sprint=daily;}
    $('#notes').value=session.notes||'';$('#recognition-status').textContent=settings.transcribe?'识别准备中…':'英文转写已关闭，可在考试设置中开启';
    if(textOnly){$('#mic-status').textContent='字幕模式 · 本场未录音';$('#mic-dot').classList.add('off');}
    else{$('#mic-status').textContent='麦克风已连接';$('#mic-dot').classList.remove('off');}
    $('.exam-clock').classList.toggle('hidden',mode==='sprint');
    closeModal();go('exam');engine.onchange=questionChanged;engine.start(daily?.session);
    interval=setInterval(()=>{if(!engine||engine.stage==='done')return;engine.current&&(engine.current.answer=$('#answer').value);if(!endingDecision)engine.tick();updateTimers();},200);
    saveInterval=setInterval(()=>persist(),5000);meterLoop();
  }catch(error){stopDevices();$('#start-error').textContent=`${error.name==='NotAllowedError'?'麦克风未获授权。请在地址栏允许麦克风，或选择字幕模式。':error.message}`;button.disabled=false;$('#text-start').disabled=false;}
}
function snapshot(){if(!session)return null;return {...session,events:engine?engine.snapshot():session.events,elapsed:engine?(engine.finishedElapsed??engine.elapsed):session.elapsed,notes:$('#notes').value};}
function persist(){
  if(session?.discarded)return Promise.resolve();
  const payload=snapshot();if(!payload)return Promise.resolve();
  try{localStorage.setItem('speaking-active',JSON.stringify(payload));}catch{}
  $('#save-status').textContent='正在保存…';
  const job=persistQueue.catch(()=>{}).then(()=>session?.discarded?null:api('/api/session',payload));
  persistQueue=job;
  job.then(()=>{$('#save-status').textContent='已保存到本机';if(payload.status!=='in_progress'){const storedSession=stored('speaking-active',null);if(storedSession?.id===payload.id&&storedSession?.status!=='in_progress')localStorage.removeItem('speaking-active');}}).catch(()=>{$('#save-status').textContent='保存失败 · 本机草稿待重试';});
  return job;
}
function stopSpeech(){
  speechAbort?.abort();speechAbort=null;
  if(speechAudio){speechAudio.pause();speechAudio.src='';speechAudio=null;}
  window.speechSynthesis?.cancel();
  speechResolve?.();speechResolve=null;speaking=false;$('#voice-bars').classList.remove('speaking');
}
async function speak(text,gen=generation){
  stopSpeech();if(settings.voice==='off')return;
  speaking=true;$('#voice-bars').classList.add('speaking');$('#examiner-state').textContent='Alex is speaking…';
  try{
    if(settings.voice==='local'){
      const controller=new AbortController();speechAbort=controller;
      const response=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':token},body:JSON.stringify({text,rate:settings.rate}),signal:controller.signal});
      if(!response.ok)throw Error('本机英文语音暂时不可用');
      const blob=await response.blob();if(gen!==generation)return;
      const url=URL.createObjectURL(blob),audio=new Audio(url);speechAudio=audio;
      try{await new Promise((resolve,reject)=>{speechResolve=resolve;audio.onended=resolve;audio.onerror=()=>reject(Error('无法播放考官声音'));audio.play().catch(reject);});}finally{URL.revokeObjectURL(url);}
    }else{
      await browserSpeak(text,gen);
    }
  }catch(error){if(error.name!=='AbortError'&&gen===generation){toast(`${error.message}，请继续看字幕作答。`,true);}}
  finally{if(gen===generation){speaking=false;speechResolve=null;$('#voice-bars').classList.remove('speaking');$('#examiner-state').textContent='Your turn. Take your time.';}}
}
function browserSpeak(text,gen){return new Promise((resolve,reject)=>{
  if(!window.speechSynthesis)return reject(Error('当前浏览器不支持朗读'));
  const u=new SpeechSynthesisUtterance(text);u.lang='en-GB';u.rate=1+Number(settings.rate)*.12;
  const voices=speechSynthesis.getVoices();u.voice=voices.find(v=>v.lang==='en-GB')||voices.find(v=>v.lang.startsWith('en'))||null;
  let timeout;const done=()=>{clearTimeout(timeout);resolve();};u.onend=done;u.onerror=done;speechResolve=done;
  timeout=setTimeout(()=>{if(gen===generation)speechSynthesis.cancel();done();},Math.min(60000,8000+text.length*90));
  speechSynthesis.speak(u);
});}
async function questionChanged(q){
  const gen=++generation;stopSpeech();stopRecognition();const stop=stopRecording();
  if(!q){questionLoading=true;$('#next').disabled=true;$('#repeat').disabled=true;await stop;return finishSession();}
  questionLoading=true;
  $('#answer').value=q.answer||'';$('#answer-wrap').classList.toggle('hidden',engine.stage==='prep');
  $('#question').textContent=q.text;$('#cue-bullets').innerHTML=(engine.stage==='prep'||engine.stage==='talk'?engine.plan.part2.bullets:[]).map(b=>`<li>${escape(b)}</li>`).join('');
  if(engine.stage==='talk')$('#question').textContent=engine.plan.part2.prompt;
  $('#topic-name').textContent=q.topic;$('#exam-title').textContent=STAGES[engine.stage];
  $('#stage-badge').textContent=stageLabel(engine.stage);$('#question-source').textContent=q.kind==='bank'||q.kind==='card'?`题库原题 · PDF p.${q.page}`:q.kind==='supplement'?'考官补充追问':'考官流程用语';
  $('#exam-mode').textContent=session.mode==='sprint'?`SHY'S 10-DAY SPRINT · DAY ${session.sprintDay}`:session.mode==='topic'?'QUESTION BANK PRACTICE':engine.isPractice?'FULL MOCK EXAM · MANUAL ADVANCE':'FULL MOCK EXAM · OFFICIAL TIMING';
  renderStages();updateTimers();persist();
  await stop;if(gen!==generation)return;
  let text=q.text;
  if(engine.stage==='prep')text=engine.isPractice?`Here is your topic. ${q.text}. Take as much preparation time as you need, then click 'Begin speaking'.`:`Now I'm going to give you a topic. You have one minute to prepare, and you can make notes. ${q.text}. Your preparation time starts after I finish speaking.`;
  if(engine.stage==='part3'&&engine.events.filter(e=>e.stage==='part3').length===1)text=`We've been talking about ${engine.plan.part2.title.match(/[a-z]/i)?engine.plan.part2.title:'this topic'}. Now I'd like to discuss some more general questions. ${q.text}`;
  const previous=engine.events.at(-2);
  if(previous?.interrupted)text=`Thank you. I'll stop you there so we can move on. ${text}`;
  await speak(text,gen);if(gen!==generation||engine.stage==='done')return;
  engine.ready();questionLoading=false;updateTimers();
  if(engine.stage!=='prep'){
    startRecording(q);startRecognition(q,gen);
    engine.beginAnswer(!!recording&&recording.rec.state==='recording');
    $('#mic-status').textContent=allowText?(engine.isPractice?'字幕模式 · 手动下一题':'字幕模式 · 按计时推进'):engine.isPractice?'正在录音 · 说完后手动下一题':'正在听你回答 · 说完后停顿片刻';
  }else $('#mic-status').textContent=allowText?'字幕模式 · 本场未录音':'准备中 · 陈述开始后录音';
  updateTimers();
}
function stageLabel(stage){return {intro:'PART 0 · INTRO',part1:'PART 1',prep:'PART 2 · PREPARATION',talk:'PART 2 · LONG TURN',roundup:'PART 2 · ROUND-OFF',part3:'PART 3'}[stage]||'';}
function renderStages(){if(session.mode==='sprint'){const p=engine.progress();$('#stage-track').innerHTML=`<span class="stage-step ${engine.stage==='part1'?'active':'passed'}">Part 1 · ${p.part1} / 4 个主题</span><span class="stage-step ${engine.stage!=='part1'?'active':''}">Part 2 / 3 · ${p.cards} / 6 组</span>`;return;}const names=[['intro','0 · 开场'],['part1','1 · 日常话题'],['prep','2 · 准备'],['talk','2 · 陈述'],['roundup','2 · 追问'],['part3','3 · 讨论']];const index=names.findIndex(([s])=>s===engine.stage);$('#stage-track').innerHTML=names.map(([s,label],i)=>`<span class="stage-step ${i===index?'active':i<index?'passed':''}">${label}</span>`).join('');}
function updateTimers(){
  if(!engine)return;$('#total-clock').textContent=fmt(engine.finishedElapsed??engine.elapsed);
  const stage=engine.stage;
  if(engine.isPractice){
    $('#phase-clock').textContent=engine.waitingForVoice?'读题中':'不限时';
    $('#phase-progress').style.width='0%';$('#phase-label').textContent=session.mode==='sprint'?'今日任务 · 手动推进':session.mode==='full'?'模拟考试 · 手动推进':'题库练习 · 手动推进';
    $('#timing-note').textContent='准备与回答都不限时。不会因为停顿、超时或达到考试时长而自动切题。';
    $('#phase-hint').textContent=stage==='prep'?'准备好后点击“开始回答”，按自己的节奏陈述。':stage==='talk'?(session.mode==='sprint'?'陈述不限时。说完后点击“说完了”进入本题对应的 Part 3。':'陈述不限时。说完后点击“说完了”进入简短追问。'):'按自己的节奏回答，说完后点击“说完了”进入下一题。';
    if(session.mode==='sprint'){const p=engine.progress();$('#phase-clock').textContent=`${p.part1+p.cards} / 10`;$('#phase-progress').style.width=`${100*p.answered/p.total}%`;$('#timing-note').textContent=`已完成 ${p.part1}/4 个 Part 1 主题、${p.cards}/6 组 Part 2/3 · 小题 ${p.answered}/${p.total}`;}
    $('#next').disabled=speaking||questionLoading||engine.waitingForVoice||endingDecision;
    $('#next').innerHTML=stage==='prep'?'开始回答 <span>→</span>':'说完了 <span>→</span>';
    $('#repeat').disabled=speaking||stage==='prep'||stage==='talk';
    return;
  }
  $('#phase-clock').textContent=engine.waitingForVoice?'读题中':Number.isFinite(engine.remaining)?fmt(Math.ceil(engine.remaining)):'专项练习';
  const duration=(engine.deadline-(engine.stageAt-engine.startedAt)/1000)||1;
  $('#phase-progress').style.width=Number.isFinite(duration)?`${Math.min(100,100*engine.stageElapsed/duration)}%`:'0%';
  const hints={intro:'先用英语自然回答。开场介绍包含在官方 Part 1 时间内。',part1:'录音时优先等你说完，停顿约 3 秒后接题。短暂停顿不会立即切题；回答过长或阶段时间到时，考官会适时打断。',prep:'你有完整的 60 秒准备时间，可以在右侧记笔记。时间到后考官会请你开始。',talk:'持续陈述 1–2 分钟。满 1 分钟后，说完并停顿约 5 秒可自动进入追问，也可点击“回答完成”。满 2 分钟考官会打断。',roundup:'围绕题卡做简短补充。此阶段结束后进入 Part 3。',part3:'解释观点、给出理由与例子。录音时等你说完再接题；长答会适时打断，题库原题优先。'};
  $('#phase-hint').textContent=hints[stage]||'';
  $('#timing-note').textContent=session.mode==='full'?'官方结构：P1 4–5 分钟；P2 3–4 分钟；P3 4–5 分钟。':'专项练习：沿用当前部分的准备与回答时间。';
  $('#phase-label').textContent=stage==='prep'?'准备时间 · 60 SECONDS':stage==='talk'?'陈述时间 · UP TO 2 MIN':'本阶段剩余';
  const next=$('#next');next.disabled=speaking||questionLoading||engine.waitingForVoice||stage==='prep'||(stage==='talk'&&engine.stageElapsed<60)||(stage==='roundup'&&engine.elapsed-engine.part2At<180);
  next.innerHTML=stage==='prep'?'准备中…':stage==='talk'&&engine.stageElapsed<60?`至少陈述 1 分钟 · ${fmt(60-engine.stageElapsed)}`:stage==='roundup'&&next.disabled?'稍后进入 Part 3':'回答完成 <span>→</span>';
  $('#repeat').disabled=speaking||stage==='prep'||stage==='talk';
}
function startRecording(event){
  if(!stream||!stream.active||!window.MediaRecorder)return;
  try{
    const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x));
    const rec=new MediaRecorder(stream,mime?{mimeType:mime}:{}),chunks=[];
    rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.start(1000);recording={rec,event,chunks};
  }catch(error){$('#mic-status').textContent='录音不可用 · 请看字幕继续';toast(`录音未启动：${error.message}`,true);}
}
function stopRecording(){
  if(!recording)return recorderStopping;
  const {rec,event,chunks}=recording;recording=null;
  if(rec.state==='inactive')return Promise.resolve();
  const sid=session.id;
  const promise=new Promise(resolve=>{
    rec.onstop=async()=>{
      if(session?.discarded){resolve();return;}
      const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});
      if(!blob.size){resolve();return;}
      let job;
      job=(async()=>{
        try{
          if(session?.discarded)return;
          try{await cacheAudio(event.id,blob);}catch{}event.audioPending=true;
          if(session?.discarded)return;
          const response=await fetch('/api/audio',{method:'POST',headers:{'X-App-Token':token,'X-Session-Id':sid,'X-Event-Id':event.id,'Content-Type':blob.type},body:blob});
          if(!response.ok)throw Error('录音保存失败');
          event.audio=(await response.json()).url;event.audioPending=false;await deleteCachedAudio(event.id);await persist();
        }catch(error){if(!session?.discarded){event.audioPending=true;toast('录音上传到本机失败，已留存浏览器备份。恢复后可在记录页重试。',true);await persist().catch(()=>{});}}
      })();
      recordingJobs.add(job);job.finally(()=>recordingJobs.delete(job));resolve();
    };rec.stop();
  });recorderStopping=promise;return promise;
}
// IndexedDB preserves an audio segment if a local-server request is interrupted.
let audioDB;
function openAudioDB(){if(audioDB)return audioDB;audioDB=new Promise((resolve,reject)=>{const request=indexedDB.open('speaking-audio-backup',1);request.onupgradeneeded=()=>request.result.createObjectStore('segments',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return audioDB;}
async function cacheAudio(id,blob){const db=await openAudioDB();return new Promise((resolve,reject)=>{const tx=db.transaction('segments','readwrite');tx.objectStore('segments').put({id,sid:session.id,blob});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function deleteCachedAudio(id){const db=await openAudioDB();return new Promise((resolve,reject)=>{const tx=db.transaction('segments','readwrite');tx.objectStore('segments').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function deleteSessionAudioBackup(sid){
  const db=await openAudioDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('segments','readwrite'),store=tx.objectStore('segments'),request=store.openCursor();
    request.onsuccess=()=>{const cursor=request.result;if(cursor){if(cursor.value.sid===sid)cursor.delete();cursor.continue();}};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
async function completeDiscard(sid){
  await api('/api/discard',{id:sid});await deleteSessionAudioBackup(sid);
  const active=stored('speaking-active',null);if(active?.id===sid)localStorage.removeItem('speaking-active');
  const pending=stored('speaking-discard-pending',[]).filter(id=>id!==sid);
  if(pending.length)localStorage.setItem('speaking-discard-pending',JSON.stringify(pending));else localStorage.removeItem('speaking-discard-pending');
}
function markDiscard(){
  session.discarded=true;session.status='discarded';
  const pending=new Set(stored('speaking-discard-pending',[]));pending.add(session.id);
  localStorage.setItem('speaking-discard-pending',JSON.stringify([...pending]));
  if(stored('speaking-active',null)?.id===session.id)localStorage.removeItem('speaking-active');
}
async function retryAudio(){
  const db=await openAudioDB();const segments=await new Promise((resolve,reject)=>{const req=db.transaction('segments').objectStore('segments').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  let count=0;
  for(const item of segments){
    const s=history.find(h=>h.id===item.sid);const event=s?.events.find(e=>e.id===item.id);if(!event)continue;
    const response=await fetch('/api/audio',{method:'POST',headers:{'X-App-Token':token,'X-Session-Id':item.sid,'X-Event-Id':item.id,'Content-Type':item.blob.type},body:item.blob});
    if(!response.ok)throw Error('仍然无法保存录音，请确认软件服务正常。');
    event.audio=(await response.json()).url;event.audioPending=false;await api('/api/session',s);await deleteCachedAudio(item.id);count++;
  }
  toast(count?`已恢复 ${count} 段录音。`:'没有待恢复的录音。');await refresh();
}
function stopRecognition(){listenActive=false;clearTimeout(recRestart);if(recognition){recognition.onend=null;recognition.abort();recognition=null;}}
function startRecognition(event,gen){
  if(!settings.transcribe||!stream||recognitionBlocked)return;
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){$('#recognition-status').textContent='此浏览器没有英文转写功能 · 录音照常保存';return;}
  const rec=new Recognition();recognition=rec;listenActive=true;rec.lang='en-US';rec.continuous=true;rec.interimResults=true;
  let base=$('#answer').value;
  rec.onresult=e=>{
    if(gen!==generation)return;let final='',interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)final+=e.results[i][0].transcript+' ';else interim+=e.results[i][0].transcript;}
    if(final)base=(base+' '+final).trim();$('#answer').value=(base+' '+interim).trim();event.answer=$('#answer').value;
  };
  rec.onerror=e=>{if(['network','not-allowed','service-not-allowed','language-not-supported','audio-capture'].includes(e.error)){recognitionBlocked=true;listenActive=false;$('#recognition-status').textContent='英文转写不可用 · 录音继续保存，可手动补充文字';}else if(e.error!=='no-speech'&&e.error!=='aborted')$('#recognition-status').textContent='转写暂时中断，录音照常进行';};
  rec.onend=()=>{if(listenActive&&!recognitionBlocked&&gen===generation){base=$('#answer').value;recRestart=setTimeout(()=>{try{rec.start();}catch{}},400);}};
  try{rec.start();$('#recognition-status').textContent='英文转写已开启（由浏览器识别）';}catch{$('#recognition-status').textContent='英文转写未启动 · 录音照常保存';}
}
function meterLoop(){
  if(!engine||engine.stage==='done')return;
  if(!analyser)return;
  animation=requestAnimationFrame(meterLoop);
  const data=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(data);
  let sum=0;for(const n of data)sum+=((n-128)/128)**2;const rms=Math.sqrt(sum/data.length);
  $('#mic-level').style.width=`${Math.min(100,rms*500)}%`;
  if(!speaking&&!questionLoading&&!endingDecision&&recording?.rec.state==='recording')engine.receiveLevel(rms);
}
function stopDevices(){
  cancelAnimationFrame(animation);stopRecognition();stream?.getTracks().forEach(t=>t.stop());stream=null;
  audioContext?.close().catch(()=>{});audioContext=null;analyser=null;
}
async function finishSession(){
  if(finishing)return;finishing=true;
  clearInterval(interval);clearInterval(saveInterval);stopSpeech();await stopRecording();stopDevices();
  if(session.discarded){
    await Promise.allSettled([...recordingJobs,persistQueue]);
    try{await completeDiscard(session.id);await refresh();go('home');toast('本次已结束，不保留记录、录音或练习次数。',true);}
    catch(error){modal(`<h2 class="modal-title">本次已停止，正在等待清除。</h2><p class="modal-sub">${escape(error.message)}。已记住“不保存”的选择，重新打开时会继续清除。</p><div class="modal-actions"><button id="retry-discard" class="button primary">重试清除</button></div>`);$('#retry-discard').onclick=()=>{closeModal();finishing=false;finishSession();};}
    return;
  }
  session.status=engine.reason==='completed'?'completed':'interrupted';session.finished=Date.now()/1000;
  const closing=engine.reason==='completed'&&!engine.isPractice?'Thank you. That is the end of the speaking test.':'This practice session has ended. Thank you.';
  $('#question').textContent=closing;$('#cue-bullets').innerHTML='';$('#exam-title').textContent=session.mode==='sprint'?(session.status==='completed'?'今日任务完成':'今日任务已保存'):session.mode==='full'?'考试结束':'练习结束';
  $('#next').disabled=true;$('#repeat').disabled=true;$('#phase-clock').textContent='完成';
  await Promise.allSettled([...recordingJobs,speak(closing,generation)]);
  try{await persist();await refresh();go('history');showReview(history.find(s=>s.id===session.id)||snapshot(),true);}
  catch(error){toast('本机保存未完成，草稿已保留。请保持窗口打开并重试保存。',true);modal(`<h2 class="modal-title">练习已结束，正在等待保存。</h2><p class="modal-sub">${escape(error.message)}。文字草稿和已缓存录音保留在当前浏览器。</p><div class="modal-actions"><button id="retry-save" class="button primary">重试保存</button><button id="download-draft" class="button secondary">导出文字草稿</button></div>`);$('#retry-save').onclick=()=>{finishing=false;finishSession();};$('#download-draft').onclick=()=>download(snapshot(),'练习草稿.json');}
}
function showReview(s,justFinished=false){
  if(!s)return;
  const answered=s.events.filter(e=>e.answered&&(e.stage==='talk'||e.kind==='bank'||e.kind==='supplement'));
  const audioCount=s.events.filter(e=>e.audio).length;
  const wordCount=s.events.reduce((n,e)=>n+(e.answer.match(/\b[a-zA-Z]+\b/g)||[]).length,0);
  const hasPending=s.events.some(e=>e.audioPending);
  modal(`<p class="eyebrow">${justFinished?'WELL DONE. TAKE A BREATH.':'YOUR PRACTICE, REVISITED.'}</p><h2 class="modal-title">${s.mode==='sprint'?(s.status==='completed'?'今日任务完成 ✓':'今日任务已保存，下次继续。'):s.status==='completed'?'又完成了一次开口。':'这次练习，也值得留下。'}</h2><p class="modal-sub">${date(s.started)} · ${s.mode==='sprint'?`Shy 十天冲刺 · 第 ${s.sprintDay} 天`:s.mode==='full'?`模拟考试 · ${s.type==='practice'?'手动下一题':'官方计时'}`:'题库练习'} · ${s.status==='completed'?'已完成':'未完成'}${s.recording?'':' · 字幕模式，未录音'}</p><div class="summary-grid"><div><strong>${fmt(s.elapsed||0)}</strong><small>练习时长</small></div><div><strong>${answered.length}</strong><small>本场已回答</small></div><div><strong>${audioCount}</strong><small>已保存录音</small></div></div><p class="review-note">${wordCount?`转写共 ${wordCount} 个英语单词。转写可能有误，可以结合录音复盘。`:'本次没有保存回答文字，可以直接回听录音。'} 此版本记录练习过程，不提供自动雅思分数。<br>${s.mode==='full'?(s.status==='completed'?'本场仅计入整套完成进度，不改变单题已练。':'本场仅计入整套抽到次数，不计入整套完成或单题已练。'):'本场实际完成的小题计入单题练习进度，不改变整套抽题记录。'}</p>${hasPending?'<div class="error-banner">部分录音仍在浏览器备份中。<button id="retry-audio" class="text-button">点击重试保存录音 ↗</button></div>':''}<div class="modal-actions"><button id="export-session" class="button secondary">导出本场文字记录</button>${justFinished?'<button id="back-home" class="button primary">回到练习首页 →</button>':''}</div>${s.notes?`<div class="review-note" style="margin-top:22px"><b>Part 2 笔记</b><br>${escape(s.notes).replace(/\n/g,'<br>')}</div>`:''}${s.events.map(e=>`<article class="review-event"><div class="review-meta">${escape(stageLabel(e.stage))} · ${escape(e.topic)} · ${e.kind==='supplement'?'补充追问':e.kind==='bank'||e.kind==='card'?'题库原题':'流程用语'} · ${fmt(e.duration||0)}${e.interrupted?' · 考官控制进度打断':e.advanceReason==='answer-finished'?' · 回答结束后接题':''}${e.answered?'':' · 仅展示'}</div><strong lang="en">${escape(e.stage==='talk'?bank.topics.find(t=>t.id===e.topicId)?.prompt||e.text:e.text)}</strong>${e.bullets?.length?`<p lang="en">${e.bullets.map(escape).join('<br>')}</p>`:''}<p lang="en">${escape(e.answer||'未保存转写文字')}</p>${e.audio?`<audio controls preload="none" src="${escape(e.audio)}"></audio>`:''}</article>`).join('')}`);
  $('#export-session').onclick=()=>download(s,`口语练习-${new Date(s.started*1000).toISOString().slice(0,10)}.json`);
  if($('#back-home'))$('#back-home').onclick=()=>{closeModal();go('home');};
  if($('#retry-audio'))$('#retry-audio').onclick=async()=>{try{await retryAudio();showReview(history.find(h=>h.id===s.id));}catch(e){toast(e.message,true);}};
}
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function readProgress(boot){$('#quit-app').classList.toggle('hidden',!boot.desktop);sprint=boot.sprint||{};usage=boot.usage;examUsage=boot.examUsage||{};examTopics=boot.examTopics||{};}
async function refresh(){const boot=await api('/api/bootstrap');readProgress(boot);history=await api('/api/history');renderHome();}

$('#modal-close').onclick=closeModal;
$('#quit-app').onclick=async()=>{
  if(engine&&engine.stage!=='done'){toast('请先提前结束，并选择保存或不保存，再退出应用。');return;}
  try{await api('/api/quit',{});stopDevices();stopSpeech();$('#quit-app').disabled=true;$('#main').innerHTML='<section class="page"><h1>NotShy 已退出</h1><p class="sub">可以关闭此窗口。下次双击 NotShy.exe 继续练习。</p></section>';}
  catch(error){toast(error.message,true);}
};
$$('[data-nav]').forEach(el=>el.onclick=()=>go(el.dataset.nav));
$$('[data-route]').forEach(el=>el.onclick=()=>go(el.dataset.route));
$('.brand').onclick=e=>{e.preventDefault();go('home');};
$('#start-full').onclick=()=>startPrompt('full',null,'exam');
$('#start-practice').onclick=()=>go('bank');
$('#start-sprint').onclick=sprintPrompt;$('#nav-sprint').onclick=sprintPrompt;
$$('[data-part]').forEach(el=>el.onclick=()=>{partFilter=Number(el.dataset.part);$$('[data-part]').forEach(b=>b.classList.toggle('active',b===el));renderBank();});
$('#bank-search').oninput=renderBank;$('#bank-progress').onchange=renderBank;
$('#settings-form').onsubmit=e=>{e.preventDefault();settings=readSettings();localStorage.setItem('speaking-settings',JSON.stringify(settings));renderHome();toast('设置已保存。');};
$('#test-voice').onclick=async()=>{const saved=settings;settings=readSettings();$('#test-voice').disabled=true;await speak("Hello. I'm Alex, your speaking examiner. What's your full name, please?");settings=saved;$('#test-voice').disabled=false;};
$('#test-mic').onclick=async()=>{try{await prepareMic();$('#device-result').textContent='麦克风已连接。请说一句话，检测持续 5 秒。';let peak=0;const probe=setInterval(()=>{const values=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(values);peak=Math.max(peak,...values.map(v=>Math.abs(v-128)));},100);setTimeout(()=>{clearInterval(probe);stopDevices();$('#device-result').textContent=peak>3?'检测到麦克风声音，可以开始练习。':'麦克风权限正常，但没有检测到明显声音。请检查输入设备。';},5000);}catch(e){stopDevices();$('#device-result').textContent=`麦克风检测未通过：${e.message}`;}};
$('#next').onclick=()=>{if(engine&&!$('#next').disabled)engine.next($('#answer').value);};
$('#repeat').onclick=async()=>{if(!engine||speaking||questionLoading)return;const q=engine.current,gen=++generation;questionLoading=true;engine.answerReadyAt=null;stopRecognition();if(recording?.rec.state==='recording')recording.rec.pause();await speak(q.text,gen);if(engine.stage!=='done'&&engine.current===q){if(recording?.rec.state==='paused')recording.rec.resume();startRecognition(q,gen);engine.beginAnswer(!!recording&&recording.rec.state==='recording');questionLoading=false;updateTimers();}};
$('#answer').oninput=()=>{if(engine?.current)engine.current.answer=$('#answer').value;};
$('#end-exam').onclick=()=>{endingDecision=true;modal(`<h2 class="modal-title">结束前，要保存这次${session.mode==='full'?'模拟':'练习'}吗？</h2><p class="modal-sub">保存会留下本场题目、回答和录音，并标记为“未完成”。不保存会清除本场记录、录音与练习次数。${engine.isPractice?'':'模拟考试的计时仍在继续。'}</p><div class="modal-actions"><button id="confirm-end" class="button primary">保存并结束</button><button id="discard-end" class="button secondary">不保存并结束</button><button id="keep-going" class="button secondary">继续${session.mode==='full'?'考试':'练习'}</button></div>`);};
$('#modal').addEventListener('close',()=>{endingDecision=false;});
$('#modal-content').addEventListener('click',e=>{if(e.target.closest('#confirm-end')){endingDecision=false;closeModal();engine.finish('interrupted');}if(e.target.closest('#discard-end')){markDiscard();endingDecision=false;closeModal();engine.finish('discarded');}if(e.target.closest('#keep-going')){endingDecision=false;closeModal();}});
$('#export-all').onclick=async()=>{try{download(await api('/api/backup',{}),'雅思口语练习记录备份.json');toast('已导出文字记录。完整录音请另行备份 data 文件夹。',true);}catch(e){toast(e.message,true);}};
window.addEventListener('beforeunload',e=>{if(engine&&engine.stage!=='done'){const payload=snapshot();try{localStorage.setItem('speaking-active',JSON.stringify(payload));}catch{}fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':token},body:JSON.stringify(payload),keepalive:true}).catch(()=>{});e.preventDefault();e.returnValue='';}});

async function init(){
  icons();$('#today').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'});
  try{
    const boot=await api('/api/bootstrap');token=boot.token;bank=boot.bank;readProgress(boot);history=await api('/api/history');
    for(const sid of stored('speaking-discard-pending',[]))await completeDiscard(sid);
    history=await api('/api/history');readProgress(await api('/api/bootstrap'));
    const draft=stored('speaking-active',null);
    if(draft){
      const existing=history.find(s=>s.id===draft.id);
      if(!existing||(existing.status!=='completed'&&draft.events.length>=existing.events.length)){draft.status=draft.status==='completed'?'completed':'interrupted';await api('/api/session',draft);localStorage.removeItem('speaking-active');history=await api('/api/history');readProgress(await api('/api/bootstrap'));toast('已恢复上次练习记录，保存在“练习记录”中。',true);}
      else localStorage.removeItem('speaking-active');
    }
    renderHome();renderSettings();
  }catch(e){$('#home').insertAdjacentHTML('afterbegin',`<div class="error-banner">启动未完成：${escape(e.message)}。请关闭窗口后，重新双击“启动雅思口语模拟”。</div>`);$('#start-full').disabled=true;}
}
init();
