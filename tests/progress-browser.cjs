const {chromium,browserExecutable}=require('./browser-runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BASE='http://127.0.0.1:8766';
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:browserExecutable});
 try{
  const boot=await(await fetch(BASE+'/api/bootstrap')).json();
  const post=async(route,body)=>{const r=await fetch(BASE+route,{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':boot.token},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
  const topic=boot.bank.topics.find(t=>t.part===1&&t.region==='mainland'&&!boot.usage[t.questions[0].id]&&!boot.examTopics[t.id]);
  assert.ok(topic,'fresh topic available for isolated progress verification');
  const card=boot.bank.topics.find(t=>t.part===2&&t.region==='mainland'&&!boot.examTopics[t.id]);
  const qid=topic.questions[0].id,exid=crypto.randomUUID(),singleId=crypto.randomUUID();
  const full={id:exid,mode:'full',type:'exam',status:'in_progress',started:Date.now()/1000,selection:[qid,card.id],events:[{id:crypto.randomUUID(),questionId:qid,topicId:topic.id,text:topic.questions[0].text,topic:topic.title,stage:'part1',kind:'bank',answered:true,askedAt:Date.now()/1000,answer:'A test answer.',duration:12}]};
  await post('/api/session',full);
  let state=await(await fetch(BASE+'/api/bootstrap')).json();
  assert.equal(state.usage[qid],undefined);assert.equal(state.examUsage[qid].drawn,1);assert.equal(state.examUsage[qid].completed,0);
  const next=await post('/api/plan',{mode:'full',region:'mainland'});
  assert.equal(next.part1.slice(0,3).some(t=>t.id===topic.id),false,'a drawn topic rotates out of the next selection');
  assert.notEqual(next.part2.id,card.id);
  const page=await browser.newPage({viewport:{width:1440,height:1040}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE);await page.locator('.stat').first().waitFor();await page.locator('[data-nav="bank"]').click();
  const row=page.locator(`[data-topic="${topic.id}"]`);
  assert.match(await row.innerText(),/单题未练/);assert.match(await row.innerText(),/整套：抽到 1 次 · 完成 0 次/);
  full.status='completed';await post('/api/session',full);
  state=await(await fetch(BASE+'/api/bootstrap')).json();assert.equal(state.usage[qid],undefined);assert.equal(state.examUsage[qid].completed,1);assert.equal(state.examUsage[card.id].completed,0);
  await page.reload();await page.locator('.stat').first().waitFor();await page.locator('[data-nav="bank"]').click();
  assert.match(await row.innerText(),/单题未练/);assert.match(await row.innerText(),/整套：抽到 1 次 · 完成 1 次/);
  const priorExam=state.examUsage;
  await post('/api/session',{id:singleId,mode:'topic',type:'practice',status:'completed',started:Date.now()/1000,events:full.events});
  state=await(await fetch(BASE+'/api/bootstrap')).json();assert.equal(state.usage[qid].count,1);assert.deepEqual(state.examUsage,priorExam,'single practice does not change exam exposure or completion');
  await page.reload();await page.locator('.stat').first().waitFor();await page.locator('[data-nav="bank"]').click();
  assert.match(await row.innerText(),/单题已练 1/);assert.match(await row.innerText(),/整套：抽到 1 次 · 完成 1 次/);
  await row.click();assert.match(await page.locator('.progress-explanation').innerText(),/单题已练 1/);
  await page.screenshot({path:path.resolve(__dirname,'../test-results/separate-progress.png'),fullPage:true});
  await post('/api/discard',{id:exid});await post('/api/discard',{id:singleId});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.resolve(__dirname,'../test-results/progress-result.json'),JSON.stringify({passed:true,separateSingleAndFullProgress:true,drawnNotCompleted:true,completedFullDoesNotMarkSingle:true,nextPlanRotates:true,consoleErrors:errors},null,2));
  console.log('Progress verified: separate single/full status, drawn-only versus completed, next-plan rotation, and independent UI labels.');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
