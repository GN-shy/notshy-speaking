const {chromium,browserExecutable}=require('./browser-runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BASE='http://127.0.0.1:8766';
const OUT=path.resolve(__dirname,'../test-results');
const get=async route=>(await fetch(BASE+route)).json();
const eventually=async fn=>{for(let i=0;i<80;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Expected persisted state did not arrive');};
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:browserExecutable,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1040},permissions:['microphone']});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('speaking-settings',JSON.stringify({voice:'off',autoNext:true})));
  await page.goto(BASE);await page.locator('.stat').first().waitFor();
  await page.screenshot({path:path.join(OUT,'modes-home.png'),fullPage:true});
  const baseline=(await get('/api/bootstrap')).usage;
  const baselineExam=(await get('/api/bootstrap')).examUsage;
  const baselineHistory=await get('/api/history');
  const boot=await get('/api/bootstrap');
  await page.locator('#start-full').click();
  assert.equal(await page.locator('#select-timed').getAttribute('aria-pressed'),'true');
  await page.locator('#select-manual').click();
  assert.match(await page.locator('#modal-content').innerText(),/手动下一题/);
  await page.screenshot({path:path.join(OUT,'manual-mode-choice.png'),fullPage:true});
  await page.locator('#confirm-start').click();
  await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  await page.waitForTimeout(1600);
  const manualId=await page.evaluate(()=>JSON.parse(localStorage.getItem('speaking-active')).id);
  await page.clock.install();
  const first=await page.locator('#question').innerText();
  await page.clock.fastForward(1200000);
  assert.equal(await page.locator('#question').innerText(),first,'manual exam does not advance after 20 minutes');
  assert.equal(await page.locator('#phase-clock').innerText(),'不限时');
  for(let i=0;i<4;i++){
    await page.waitForFunction(()=>!document.querySelector('#next').disabled);
    await page.locator('#next').click();
  }
  await page.waitForFunction(()=>document.querySelector('#stage-badge').textContent==='PART 1'&&!document.querySelector('#next').disabled);
  await eventually(async()=>(await get('/api/history')).find(s=>s.id===manualId)?.events.some(e=>e.audio));
  const manualSnapshot=(await get('/api/history')).find(s=>s.id===manualId);
  const audio=manualSnapshot.events.find(e=>e.audio).audio;
  await page.locator('#end-exam').click();
  await page.screenshot({path:path.join(OUT,'exit-save-choice.png'),fullPage:true});
  assert.equal(await page.locator('#confirm-end').innerText(),'保存并结束');
  await page.locator('#keep-going').click();
  assert.equal(await page.locator('#exam:not(.hidden)').count(),1,'continue preserves the active exam');
  await page.locator('#end-exam').click();await page.locator('#discard-end').click();
  await page.waitForSelector('#home:not(.hidden)');
  assert.equal((await get('/api/history')).some(s=>s.id===manualId),false);
  assert.deepEqual((await get('/api/bootstrap')).usage,baseline,'discard restores all question counts');
  assert.deepEqual((await get('/api/bootstrap')).examUsage,baselineExam,'discard restores whole-exam draws and completion');
  assert.equal((await fetch(BASE+audio)).status,404,'recording deleted');
  assert.equal(await page.evaluate(()=>localStorage.getItem('speaking-active')),null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('speaking-discard-pending')),null);
  const late=await fetch(BASE+'/api/session',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':boot.token},body:JSON.stringify(manualSnapshot)});
  assert.equal(late.status,400,'a delayed save cannot recreate the discarded exam');
  const cached=await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('speaking-audio-backup',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return new Promise(resolve=>{const r=db.transaction('segments').objectStore('segments').getAll();r.onsuccess=()=>resolve(r.result.map(v=>v.sid));});});
  assert.equal(cached.includes(manualId),false,'browser audio backups cleared');
  console.log('Manual exam never auto-advances; discard removes history, audio, counts and browser backup');
  // Save remains available for an interrupted manual exam.
  await page.locator('#start-full').click();await page.locator('#select-manual').click();await page.locator('#text-start').click();
  await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  const savedId=await page.evaluate(()=>JSON.parse(localStorage.getItem('speaking-active')).id);
  await page.locator('#end-exam').click();await page.locator('#confirm-end').click();await page.waitForSelector('#export-session');
  const saved=(await get('/api/history')).find(s=>s.id===savedId);assert.equal(saved.status,'interrupted');assert.equal(saved.type,'practice');assert.equal(saved.mode,'full');
  assert.match(await page.locator('#modal-content').innerText(),/模拟考试 · 手动下一题/);
  await page.locator('#modal-close').click();await page.locator('[data-nav="home"]').click();
  // The other home entry opens a selectable question bank.
  await page.locator('#start-practice').click();await page.locator('[data-part="2"]').click();
  await page.locator('.topic-card').first().click();await page.locator('#practice-topic').click();
  assert.equal(await page.locator('#select-timed').count(),0,'topic practice uses manual advancement');
  await page.locator('#text-start').click();
  await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  const topicId=await page.evaluate(()=>JSON.parse(localStorage.getItem('speaking-active')).id);
  await page.clock.fastForward(600000);
  assert.match(await page.locator('#stage-badge').innerText(),/PREPARATION/);
  assert.match(await page.locator('#next').innerText(),/开始回答/);
  await page.locator('#next').click();await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  assert.match(await page.locator('#stage-badge').innerText(),/LONG TURN/);
  await page.clock.fastForward(900000);
  assert.match(await page.locator('#stage-badge').innerText(),/LONG TURN/);
  await page.locator('#next').click();await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  assert.match(await page.locator('#stage-badge').innerText(),/ROUND-OFF/);
  await page.locator('#next').click();await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  assert.equal(await page.locator('#stage-badge').innerText(),'PART 3');
  const p3=await page.locator('#question').innerText();await page.clock.fastForward(600000);
  assert.equal(await page.locator('#question').innerText(),p3);
  for(let i=0;i<10;i++){
    if(await page.locator('#export-session').count())break;
    await page.waitForFunction(()=>!document.querySelector('#next').disabled||document.querySelector('#export-session'));
    if(await page.locator('#export-session').count())break;
    await page.locator('#next').click();
  }
  await page.waitForSelector('#export-session');
  const topic=(await get('/api/history')).find(s=>s.id===topicId);
  assert.equal(topic.status,'completed');assert.equal(topic.mode,'topic');
  assert.equal((await get('/api/history')).length,baselineHistory.length+2,'discarded session absent while saved sessions remain');
  assert.deepEqual(errors,[]);
  await page.locator('#modal-close').click();await page.locator('[data-nav="home"]').click();
  await page.setViewportSize({width:540,height:960});await page.screenshot({path:path.join(OUT,'modes-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  fs.writeFileSync(path.join(OUT,'modes-result.json'),JSON.stringify({passed:true,manualExamNoAutoAdvance:true,topicPracticeAllStagesManual:true,discardClearsAudioHistoryUsage:true,lateSaveRejected:true,saveAndContinueWorking:true,consoleErrors:errors},null,2));
  console.log('Topic preparation, speech and Part 3 all advance only manually; saving and small-screen UI passed');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
