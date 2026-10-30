const {chromium,browserExecutable}=require('./browser-runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const BASE=process.env.NOTSHY_TEST_BASE||'http://127.0.0.1:8782';
const current=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('speaking-active')).events.at(-1));
async function main(){
 const prior=await(await fetch(BASE+'/api/bootstrap')).json();
 if(prior.sprint.sessionId)await fetch(BASE+'/api/discard',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':prior.token},body:JSON.stringify({id:prior.sprint.sessionId})});
 const browser=await chromium.launch({headless:true,executablePath:browserExecutable,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['microphone']});
  await context.addInitScript(()=>localStorage.setItem('speaking-settings',JSON.stringify({voice:'off',identity:'student',region:'mainland',transcribe:false})));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE);await page.locator('.stat').first().waitFor();await page.screenshot({path:'test-results/sprint-home.png',fullPage:true});
  await page.locator('#start-sprint').click();assert.match(await page.locator('.modal-title').innerText(),/今日冲刺/);
  const planned=page.waitForResponse(r=>r.url()===BASE+'/api/sprint'&&r.request().method()==='POST');
  await page.locator('#text-start').click();const daily=await(await planned).json(),plan=daily.plan;
  assert.equal(plan.part1.length,4);assert.equal(plan.cards.length,6);
  const boot=await(await fetch(BASE+'/api/bootstrap')).json();const headers={'Content-Type':'application/json','X-App-Token':boot.token};
  await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  assert.equal(await page.locator('.exam-clock').isVisible(),false);
  assert.equal((await current(page)).questionId,plan.part1[0].questions[0].id);
  const before=await current(page);await page.clock.install();await page.clock.fastForward(3600000);assert.equal((await current(page)).id,before.id);
  for(let i=0;i<2;i++){await page.locator('#answer').fill('A complete practice answer.');await page.locator('#next').click();await page.waitForFunction(()=>!document.querySelector('#next').disabled);}
  const unfinished=await current(page);await page.locator('#end-exam').click();await page.locator('#confirm-end').click();await page.locator('#export-session').waitFor();
  let state=await(await fetch(BASE+'/api/bootstrap')).json();
  for(const q of plan.part1[0].questions.slice(0,2))assert.equal(state.usage[q.id].count,1);
  assert.equal(state.usage[unfinished.questionId],undefined);assert.deepEqual(state.examUsage,prior.examUsage);
  await page.reload();await page.locator('.stat').first().waitFor();assert.match(await page.locator('#start-sprint').innerText(),/继续/);
  await page.locator('#start-sprint').click();await page.locator('#confirm-start').click();await page.locator('#exam').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  assert.equal((await current(page)).id,unfinished.id,'resume same unfinished step');
  await page.screenshot({path:'test-results/sprint-progress.png',fullPage:true});await page.waitForTimeout(1200);
  let guard=0;
  while(!(await page.locator('#export-session').isVisible())){
    await page.waitForFunction(()=>!document.querySelector('#next').disabled||!!document.querySelector('#export-session'));
    if(await page.locator('#export-session').isVisible())break;
    if(await page.locator('#answer').isVisible())await page.locator('#answer').fill('My answer to this question.');await page.locator('#next').click();
    if(++guard>300)throw Error('Daily workload did not end');
  }
  state=await(await fetch(BASE+'/api/bootstrap')).json();assert.equal(state.sprint.session.status,'completed');assert.equal(state.sprint.completedDays,1);
  const saved=state.sprint.session;
  assert.deepEqual(saved.events.filter(e=>e.stage==='part1').map(e=>e.questionId),plan.part1.flatMap(t=>t.questions.map(q=>q.id)));
  assert.equal(saved.events.filter(e=>e.stage==='talk'&&e.answered).length,6);
  for(const topic of plan.cards){
    assert.deepEqual(saved.events.filter(e=>e.stage==='part3'&&e.topicId===topic.id).map(e=>e.questionId),topic.part3.map(q=>q.id));
    for(const qid of [topic.id,...topic.part3.map(q=>q.id)])assert.equal(state.usage[qid].count,1);
  }
  assert.ok(saved.events.some(e=>e.audio),'microphone audio saved');assert.deepEqual(state.examUsage,prior.examUsage);
  assert.match(await page.locator('.modal-title').innerText(),/任务完成/);
  await page.screenshot({path:'test-results/sprint-done.png',fullPage:true});
  await page.locator('#back-home').click();assert.match(await page.locator('#start-sprint').innerText(),/任务完成/);
  await page.locator('#start-sprint').click();assert.match(await page.locator('.modal-title').innerText(),/任务完成/);await page.locator('#modal-close').click();
  await page.locator('[data-nav="bank"]').click();await page.locator(`[data-topic="${plan.part1[0].id}"]`).click();
  assert.match(await page.locator('.question-list li').first().innerText(),/单题已练 1 次/);
  assert.deepEqual(errors,[]);
  // Complete future days on the same date, with independent plans and saved state.
  await page.locator('#modal-close').click();await page.locator('[data-nav="home"]').click();
  await page.locator('#start-sprint').click();await page.locator('#sprint-next').click();
  await page.waitForFunction(()=>document.querySelector('#modal-content .eyebrow')?.textContent.includes('DAY 2'));
  assert.match(await page.locator('.eyebrow').last().innerText(),/DAY 2/);
  await page.locator('#text-start').click();await page.locator('#exam').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  const second=await(await fetch(BASE+'/api/sprint?day=2')).json();
  assert.equal(second.calendarDay,1);assert.notEqual(second.sessionId,daily.sessionId);
  await page.locator('#next').click();await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  const secondCurrent=await current(page);
  await page.locator('#end-exam').click();await page.locator('#confirm-end').click();await page.locator('#export-session').waitFor();
  await page.reload();await page.locator('.stat').first().waitFor();
  assert.equal(await page.locator('[data-sprint-day="2"]').getAttribute('aria-pressed'),'true');
  await page.locator('#start-sprint').click();await page.locator('#text-start').click();
  await page.locator('#exam').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  assert.equal((await current(page)).id,secondCurrent.id);
  let futureGuard=0;
  while(!(await page.locator('#export-session').isVisible())){
    await page.waitForFunction(()=>!document.querySelector('#next').disabled||!!document.querySelector('#export-session'));
    if(await page.locator('#export-session').isVisible())break;
    await page.locator('#next').click();if(++futureGuard>300)throw Error('Future day did not finish');
  }
  const completedFuture=await(await fetch(BASE+'/api/sprint?day=2')).json();
  assert.equal(completedFuture.session.status,'completed');assert.equal(completedFuture.completedDays,2);assert.equal(completedFuture.calendarDay,1);
  await page.locator('#sprint-next').click();await page.waitForFunction(()=>document.querySelector('#modal-content .eyebrow')?.textContent.includes('DAY 3'));assert.match(await page.locator('.eyebrow').last().innerText(),/DAY 3/);
  await page.locator('#modal-close').click();await page.locator('[data-nav="home"]').click();
  await page.locator('[data-sprint-day="10"]').click();await page.waitForFunction(()=>document.querySelector('#modal-content .eyebrow')?.textContent.includes('DAY 10'));assert.match(await page.locator('.eyebrow').last().innerText(),/DAY 10/);
  await page.locator('#modal-close').click();await page.screenshot({path:'test-results/sprint-advance.png',fullPage:true});
  assert.equal((await(await fetch(BASE+'/api/sprint?day=10')).json()).plan,null,'selecting a day does not assemble or mark questions');
  for(const day of [1,2]){
    const task=await(await fetch(BASE+`/api/sprint?day=${day}`)).json();
    await fetch(BASE+'/api/discard',{method:'POST',headers,body:JSON.stringify({id:task.sessionId})});
  }
  // Discarding a daily session reverses its single-question counts and completion.

  const reset=await(await fetch(BASE+'/api/bootstrap')).json();assert.equal(reset.sprint.completedDays,0);assert.deepEqual(reset.usage,{});
  assert.deepEqual(reset.sprint.plan,plan);assert.notEqual(reset.sprint.sessionId,daily.sessionId);
  fs.writeFileSync('test-results/sprint-result.json',JSON.stringify({passed:true,part1Topics:4,pairedCards:6,steps:saved.events.length,manualNoTimeout:true,resumesUnfinished:true,singlePracticeSynced:true,completedDay:true,discardRollback:true,advanceFutureDays:true,selectedDayPersisted:true,microphoneAudio:true,consoleErrors:errors},null,2));
  console.log('Sprint browser passed: exact workload, no timeout, pause/resume, six paired groups, daily completion, single-question labels, audio, discard rollback.');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});



