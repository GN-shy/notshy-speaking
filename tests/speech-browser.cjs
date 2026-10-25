const {chromium,browserExecutable}=require('./browser-runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BASE='http://127.0.0.1:8766';
const OUT=path.resolve(__dirname,'../test-results');
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:browserExecutable,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1040}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    localStorage.setItem('speaking-settings',JSON.stringify({voice:'off',autoNext:true}));
    // Actual MediaStream/MediaRecorder/Analyser path, driven by synthetic audio.
    navigator.mediaDevices.getUserMedia=async()=>{
      const context=new AudioContext(),source=context.createOscillator(),gain=context.createGain(),dest=context.createMediaStreamDestination();
      source.frequency.value=180;gain.gain.value=0;source.connect(gain);gain.connect(dest);source.start();await context.resume();
      window.testMic={context,gain};return dest.stream;
    };
  });
  await page.goto(BASE);await page.locator('.stat').first().waitFor();
  await page.locator('#start-full').click();await page.locator('#confirm-start').click();
  await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  // Move manually through identity questions, then test a genuine Part 1 turn.
  for(let i=0;i<4;i++){await page.locator('#next').click();await page.waitForFunction(()=>!document.querySelector('#next').disabled);}
  assert.equal(await page.locator('#stage-badge').innerText(),'PART 1');
  await page.clock.install();
  const speak=async gain=>{await page.evaluate(value=>window.testMic.gain.gain.value=value,gain);await page.waitForTimeout(120);};
  const advance=async seconds=>{for(let i=0;i<seconds*5;i++)await page.clock.fastForward(200);};
  const question=await page.locator('#question').innerText();
  await speak(.08);await advance(27);
  assert.equal(await page.locator('#question').innerText(),question,'speaking beyond old per-question timeout is allowed');
  await speak(0);await advance(1.4);
  await page.waitForFunction(text=>document.querySelector('#question').textContent!==text,question);
  const active=await page.evaluate(()=>JSON.parse(localStorage.getItem('speaking-active')));
  const interrupted=active.events.find(e=>e.text===question);
  assert.equal(interrupted.interrupted,true);assert.equal(interrupted.advanceReason,'examiner-interruption');
  await page.waitForFunction(()=>!document.querySelector('#next').disabled);
  const second=await page.locator('#question').innerText();
  await speak(.08);await advance(5);await speak(0);await advance(2);
  assert.equal(await page.locator('#question').innerText(),second,'a short thinking pause does not switch questions');
  await speak(.08);await advance(2);await speak(0);await advance(3.6);
  await page.waitForFunction(text=>document.querySelector('#question').textContent!==text,second);
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('speaking-active')));
  const finished=state.events.find(e=>e.text===second);
  assert.equal(finished.advanceReason,'answer-finished');assert.equal(finished.interrupted,false);
  await page.screenshot({path:path.join(OUT,'speech-turns.png'),fullPage:true});
  const sid=state.id;
  await page.locator('#end-exam').click();await page.locator('#discard-end').click();await page.waitForSelector('#home:not(.hidden)');
  assert.equal((await(await fetch(BASE+'/api/history')).json()).some(s=>s.id===sid),false);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(OUT,'speech-result.json'),JSON.stringify({passed:true,syntheticMediaStream:true,continuousSpeechPreserved:true,longAnswerInterrupted:true,shortPausePreserved:true,finishedAnswerAdvanced:true,consoleErrors:errors},null,2));
  console.log('Synthetic microphone: continued speech preserved, long answers interrupted, short pauses preserved, and completed answers advance.');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
