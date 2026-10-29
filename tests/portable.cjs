const {chromium,browserExecutable}=require('./browser-runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const folder=process.env.NOTSHY_PORTABLE_DIR;
if(!folder)throw Error('Set NOTSHY_PORTABLE_DIR to a freshly extracted release folder.');
const exe=path.join(folder,'NotShy.exe'),BASE='http://127.0.0.1:8781';
const env={...process.env,PATH:process.env.SystemRoot+'/System32;'+process.env.SystemRoot,PYTHONPATH:'',PYTHONHOME:'',VIRTUAL_ENV:''};
const launch=()=>spawn(exe,['--no-open','--port','8781'],{cwd:folder,env,windowsHide:true,stdio:'ignore'});
async function healthy(){for(let i=0;i<120;i++){try{const r=await fetch(BASE+'/api/health');if(r.ok)return r.json();}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Packaged executable did not start');}
async function exited(child){if(child.exitCode!==null)return;await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error('EXE did not exit cleanly')),15000))]);}
async function main(){
 assert.ok(fs.existsSync(exe));assert.equal(fs.existsSync(path.join(folder,'NotShyData')),false,'release starts without private data');
 let child=launch(),browser;
 try{
  const health=await healthy();assert.equal(health.version,'1.4.0');assert.equal(health.product,'NotShy');
  console.log('EXE started without Python on PATH');
  const boot=await(await fetch(BASE+'/api/bootstrap')).json();assert.equal(boot.desktop,true);assert.equal((await(await fetch(BASE+'/api/history')).json()).length,0);
  assert.equal(boot.bank.topics.length,102);
  const bankById=new Map(boot.bank.topics.map(t=>[t.id,t]));
  const voice=await fetch(BASE+'/api/tts',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':boot.token},body:JSON.stringify({text:"Hello. Welcome to NotShy. What's your full name, please?",rate:0})});
  assert.equal(voice.status,200);const wav=Buffer.from(await voice.arrayBuffer());assert.equal(wav.subarray(0,4).toString(),'RIFF');
  console.log('Bundled resources and local English voice passed');
  browser=await chromium.launch({headless:true,executablePath:browserExecutable,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext({viewport:{width:1440,height:1040},permissions:['microphone']});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE);await page.locator('.stat').first().waitFor();
  assert.match(await page.title(),/NotShy/);assert.equal(await page.locator('#quit-app').isVisible(),true);
  await page.screenshot({path:path.resolve(__dirname,'../test-results/portable-home.png'),fullPage:true});
  await page.locator('[data-nav="settings"]').click();await page.locator('select[name="voice"]').selectOption('off');await page.locator('#settings-form button[type="submit"]').click();
  await page.locator('[data-nav="home"]').click();await page.locator('#start-full').click();await page.locator('#select-manual').click();
  const planned=page.waitForResponse(r=>r.url()===BASE+'/api/plan'&&r.request().method()==='POST');
  await page.locator('#confirm-start').click();const plan=await(await planned).json();
  for(const topic of plan.part1){
    const expected=bankById.get(topic.id).questions.filter(q=>!q.branch||q.branch==='student');
    assert.deepEqual(topic.questions.map(q=>q.id),expected.map(q=>q.id),'EXE keeps every eligible question in bank order');
  }
  await page.waitForFunction(()=>!document.querySelector('#next').disabled);await page.locator('#answer').fill('This is a packaged executable test.');
  const sid=await page.evaluate(()=>JSON.parse(localStorage.getItem('speaking-active')).id);await page.waitForTimeout(1800);await page.locator('#next').click();
  for(let i=1;i<4;i++){await page.waitForFunction(()=>!document.querySelector('#next').disabled);await page.locator('#next').click();}
  for(const topic of plan.part1.slice(0,3)){
    for(const question of topic.questions){
      await page.waitForFunction(()=>!document.querySelector('#next').disabled);
      const current=await page.evaluate(()=>JSON.parse(localStorage.getItem('speaking-active')).events.at(-1));
      assert.equal(current.stage,'part1');assert.equal(current.topicId,topic.id);assert.equal(current.questionId,question.id);
      await page.locator('#next').click();
    }
  }
  await page.waitForFunction(()=>!document.querySelector('#next').disabled);await page.locator('#end-exam').click();await page.locator('#confirm-end').click();await page.waitForSelector('#export-session');
  const history=await(await fetch(BASE+'/api/history')).json();const saved=history.find(s=>s.id===sid);assert.equal(saved.status,'interrupted');assert.ok(saved.events.some(e=>e.audio));
  assert.deepEqual(saved.events.filter(e=>e.stage==='part1').map(e=>e.questionId),plan.part1.slice(0,3).flatMap(t=>t.questions.map(q=>q.id)));
  console.log('EXE Part 1 verified: all questions in each topic asked consecutively');
  assert.ok(fs.existsSync(path.join(folder,'NotShyData','practice.sqlite3')));assert.ok(fs.readdirSync(path.join(folder,'NotShyData','recordings',sid)).length>0);
  console.log('Packaged microphone recording and persistence passed');
  const sprint=spawnSync(process.execPath,[path.join(__dirname,'sprint-browser.cjs')],{env:{...process.env,NOTSHY_TEST_BASE:BASE},stdio:'inherit',windowsHide:true,timeout:90000});
  assert.equal(sprint.status,0,'daily sprint passes against the real packaged EXE');
  await page.locator('#modal-close').click();await page.locator('#quit-app').click();await page.waitForSelector('h1:has-text("NotShy 已退出")');await exited(child);
  console.log('First EXE exited cleanly');
  // A separate launch must reuse persistent data, without any Python executable on PATH.
  child=launch();await healthy();const second=await(await fetch(BASE+'/api/bootstrap')).json();assert.ok((await(await fetch(BASE+'/api/history')).json()).some(s=>s.id===sid));
  console.log('Restart preserved history');
  const duplicate=launch();await exited(duplicate);assert.equal(duplicate.exitCode,0,'second launch reuses existing profile');
  console.log('Duplicate launch reused the existing service');
  await fetch(BASE+'/api/quit',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':second.token},body:'{}'});await exited(child);
  assert.deepEqual(errors,[]);
  const result={passed:true,version:health.version,executableRanWithoutPythonPath:true,emptyInitialHistory:true,questionTopics:boot.bank.topics.length,part1CompleteTopics:true,part1QuestionCounts:plan.part1.slice(0,3).map(t=>t.questions.length),sprintVerified:true,localVoiceBytes:wav.length,microphoneRecordingSaved:true,restartPreservedHistory:true,trayAndUiExitClean:true,consoleErrors:errors};
  fs.writeFileSync(path.resolve(__dirname,'../test-results/portable-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(browser)await browser.close();try{const b=await(await fetch(BASE+'/api/bootstrap')).json();await fetch(BASE+'/api/quit',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':b.token},body:'{}'});}catch{}if(child.exitCode===null)child.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
