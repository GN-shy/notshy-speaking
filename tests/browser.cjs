const {chromium,browserExecutable}=require('./browser-runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BASE='http://127.0.0.1:8766';
const OUT=path.resolve(__dirname,'../test-results');
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:browserExecutable,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1040},permissions:['microphone']});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE);await page.locator('.stat').first().waitFor();
  await page.screenshot({path:path.join(OUT,'home.png'),fullPage:true});
  console.log('Home loaded');
  assert.equal(await page.locator('.stat').count(),4);
  await page.locator('[data-nav="bank"]').click();assert.equal(await page.locator('.topic-card').count(),33);
  await page.locator('[data-part="2"]').click();assert.equal(await page.locator('.topic-card').count(),57);
  await page.locator('#bank-search').fill('有创造力的朋友');assert.equal(await page.locator('.topic-card').count(),1);
  await page.locator('.topic-card').click();assert.match(await page.locator('#modal-content').innerText(),/Does creativity come from nature or nurture/);
  await page.locator('#modal-close').click();await page.locator('#bank-search').fill('');
  await page.screenshot({path:path.join(OUT,'bank.png'),fullPage:true});
  await page.locator('[data-nav="settings"]').click();await page.screenshot({path:path.join(OUT,'settings.png'),fullPage:true});
  await page.locator('input[name="autoNext"]').uncheck();await page.locator('#settings-form button[type="submit"]').click();
  // Real local SAPI rendering, not a mocked speech response.
  const boot=await (await fetch(BASE+'/api/bootstrap')).json();
  const tts=await fetch(BASE+'/api/tts',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':boot.token},body:JSON.stringify({text:"Good morning. My name is Alex. What's your full name, please?",rate:0})});
  assert.equal(tts.status,200);const wav=Buffer.from(await tts.arrayBuffer());assert.equal(wav.subarray(0,4).toString(),'RIFF');assert.ok(wav.length>20000);
  fs.writeFileSync(path.join(OUT,'examiner-sample.wav'),wav);
  console.log('Local SAPI voice passed');
  await page.locator('[data-nav="home"]').click();await page.locator('#start-full').click();await page.locator('#confirm-start').click();
  await page.waitForFunction(()=>document.querySelector('#examiner-state').textContent.includes('Your turn'),{},{timeout:45000});
  assert.match(await page.locator('#question').innerText(),/full name/);
  await page.screenshot({path:path.join(OUT,'exam.png'),fullPage:true});
  await page.locator('#answer').fill('My name is Kevin.');
  const recordedId=await page.evaluate(()=>JSON.parse(localStorage.getItem('speaking-active')).id);
  await page.waitForTimeout(2300);await page.locator('#next').click();
  await page.waitForFunction(()=>document.querySelector('#question').textContent.includes('call you'));
  await page.locator('#end-exam').click();await page.locator('#confirm-end').click();
  await page.waitForSelector('#export-session',{timeout:45000});
  const histories=await(await fetch(BASE+'/api/history')).json();const recorded=histories.find(s=>s.id===recordedId);
  assert.equal(recorded.status,'interrupted');assert.ok(recorded.events.some(e=>e.audio),'audio persisted');
  const audio=recorded.events.find(e=>e.audio).audio;const audioResponse=await fetch(BASE+audio);assert.equal(audioResponse.status,200);assert.ok((await audioResponse.arrayBuffer()).byteLength>1000);
  await page.screenshot({path:path.join(OUT,'review.png'),fullPage:true});await page.locator('#modal-close').click();
  // Settings persist after a reload, and the expanded bank is actually available.
  await page.locator('[data-nav="settings"]').click();await page.locator('select[name="voice"]').selectOption('off');await page.locator('select[name="region"]').selectOption('all');await page.locator('#settings-form button[type="submit"]').click();
  await page.reload();await page.locator('.stat').first().waitFor();await page.locator('[data-nav="bank"]').click();assert.equal(await page.locator('.topic-card').count(),39);
  await page.locator('[data-nav="settings"]').click();assert.equal(await page.locator('select[name="voice"]').inputValue(),'off');
  await page.locator('select[name="region"]').selectOption('mainland');await page.locator('#settings-form button[type="submit"]').click();
  await page.clock.install();
  await page.locator('[data-nav="home"]').click();await page.locator('#start-full').click();await page.locator('#text-start').click();
  await page.waitForSelector('#exam:not(.hidden)');await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  const fullId=await page.evaluate(()=>JSON.parse(localStorage.getItem('speaking-active')).id);
  // Advance a real browser clock through the production state machine.
  for(let i=0;i<310;i++){
    await page.clock.fastForward(1000);
    if((await page.locator('#stage-badge').textContent()).includes('PREPARATION'))break;
  }
  await page.waitForFunction(()=>document.querySelector('#stage-badge').textContent.includes('PREPARATION'));
  await page.waitForFunction(()=>document.querySelector('#phase-clock').textContent!=='读题中');
  assert.match(await page.locator('#phase-clock').innerText(),/^(01:00|00:5\d)$/);
  await page.screenshot({path:path.join(OUT,'part2.png'),fullPage:true});
  console.log('Part 1 and full preparation timer passed');
  await page.clock.fastForward(60000);await page.waitForFunction(()=>document.querySelector('#stage-badge').textContent.includes('LONG TURN'));
  await page.waitForFunction(()=>document.querySelector('#phase-clock').textContent!=='读题中');
  assert.equal(await page.locator('#next').isDisabled(),true);
  await page.clock.fastForward(120000);await page.waitForFunction(()=>document.querySelector('#stage-badge').textContent.includes('ROUND-OFF'));
  await page.clock.fastForward(30000);await page.waitForFunction(()=>document.querySelector('#stage-badge').textContent==='PART 3');
  for(let i=0;i<270;i++)await page.clock.fastForward(1000);
  await page.waitForSelector('#export-session',{timeout:15000});
  const latest=(await(await fetch(BASE+'/api/history')).json()).find(s=>s.id===fullId);
  assert.equal(latest.status,'completed');assert.ok(latest.elapsed>=660&&latest.elapsed<=840);
  const card=latest.events.find(e=>e.kind==='card');assert.ok(latest.events.filter(e=>e.stage==='part3'&&e.kind==='bank').every(e=>e.topicId===card.topicId));
  assert.ok(new Set(latest.events.filter(e=>e.stage==='part1').map(e=>e.topicId)).size>=3);
  assert.equal(errors.length,0,JSON.stringify(errors));
  await page.locator('#modal-close').click();await page.locator('[data-nav="home"]').click();await page.setViewportSize({width:540,height:960});
  await page.screenshot({path:path.join(OUT,'mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
  fs.writeFileSync(path.join(OUT,'browser-result.json'),JSON.stringify({passed:true,consoleErrors:errors,ttsBytes:wav.length,recordedAudio:true,fullExamSeconds:latest.elapsed,part1Topics:new Set(latest.events.filter(e=>e.stage==='part1').map(e=>e.topicId)).size},null,2));
  console.log(JSON.stringify({passed:true,ttsBytes:wav.length,recordedAudio:true,fullExamSeconds:latest.elapsed,consoleErrors:errors}));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
