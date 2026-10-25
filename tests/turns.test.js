import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechTurn} from '../web/turns.js';
import {ExamEngine} from '../web/engine.js';

function turnHarness(softLimit=25){
  let now=100000;const turn=new SpeechTurn(()=>now,softLimit);
  return {turn,feed(seconds,rms){for(let i=0;i<Math.round(seconds*20);i++){now+=50;turn.feed(rms);}}};
}
test('short thinking pauses are preserved and a completed answer advances after silence',()=>{
  const h=turnHarness();h.feed(5,.05);h.feed(2,.001);
  assert.equal(h.turn.decision('part1'),null);
  h.feed(1.3,.001);assert.equal(h.turn.decision('part1'),'answer-finished');
});
test('ongoing speech passes the old question timer, then a long answer has a firm limit',()=>{
  const h=turnHarness();h.feed(30,.05);
  assert.equal(h.turn.decision('part1'),null,'do not interrupt at the old 20–25 second limit');
  h.feed(7,.05);assert.equal(h.turn.decision('part1'),'examiner-interruption');
});
test('an overlong answer is interrupted at a short pause when available',()=>{
  const h=turnHarness();h.feed(27,.05);h.feed(1,.001);
  assert.equal(h.turn.decision('part1'),'examiner-interruption');
});
test('a brief noise spike is not treated as a spoken answer',()=>{
  const h=turnHarness();h.feed(.1,.04);h.feed(5,.001);
  assert.equal(h.turn.heardSpeech,false);assert.equal(h.turn.decision('part1'),null);
  h.feed(25,.001);assert.equal(h.turn.decision('part1'),'no-response');
});
test('Part 2 preserves pauses before one minute and accepts completion after one minute',()=>{
  const h=turnHarness();h.feed(35,.05);h.feed(6,.001);
  assert.equal(h.turn.decision('talk',41),null);
  assert.equal(h.turn.decision('talk',60),'answer-finished');
});

const plan=()=>({mode:'full',type:'exam',part1:Array.from({length:33},(_,i)=>({id:'t'+i,title:'Topic '+i,questions:Array.from({length:4},(_,j)=>({id:`q${i}-${j}`,text:'A familiar topic question?'}))})),part2:{id:'card',title:'A park',prompt:'Describe a park.',bullets:['Who','Where','When','Why'],part3:Array.from({length:6},(_,i)=>({id:'p3-'+i,text:'A discussion question?'}))}});

test('recorded Part 1 does not use the fixed per-question timeout',()=>{
  let now=100000;const exam=new ExamEngine(plan(),{speechDriven:true,autoNext:true},()=>now);
  exam.start();exam.enter('part1',300);exam.beginAnswer(true);
  const current=exam.current;
  for(let i=0;i<600;i++){now+=50;exam.receiveLevel(.05);exam.tick();}
  assert.equal(exam.current,current);
  for(let i=0;i<20;i++){now+=50;exam.receiveLevel(.001);exam.tick();}
  assert.notEqual(exam.current,current);assert.equal(current.interrupted,true);
});

for(const style of ['continuous','natural','silent']){
  test(`recording with ${style} speech respects every official hard phase limit`,()=>{
    let now=100000;const exam=new ExamEngine(plan(),{speechDriven:true,autoNext:true},()=>now);
    const phases=[];let phase='',id='',readUntil=0,startedAnswer=false;
    exam.onchange=()=>{if(exam.stage!==phase){phases.push({stage:exam.stage,time:exam.elapsed});phase=exam.stage;}};
    exam.start();
    for(let i=0;i<5000&&exam.stage!=='done';i++){
      if(exam.current.id!==id){id=exam.current.id;readUntil=now+6000;startedAnswer=false;}
      if(now>=readUntil){
        exam.ready();
        if(exam.stage!=='prep'&&!startedAnswer){exam.beginAnswer(true);startedAnswer=true;}
        const answerAge=exam.turn?.elapsed||0;
        const level=style==='silent'?.001:style==='natural'&&answerAge>12?.001:.05;
        exam.receiveLevel(level);
      }
      now+=200;exam.tick();
    }
    assert.equal(exam.stage,'done');
    const at=s=>phases.find(p=>p.stage===s).time;
    const p1=at('prep'),p2=at('part3')-at('prep'),p3=at('done')-at('part3');
    assert.ok(p1>=240&&p1<=300.2,`P1 ${p1}`);
    assert.ok(p2>=180&&p2<=240.2,`P2 ${p2}`);
    assert.ok(p3>=240&&p3<=300.2,`P3 ${p3}`);
    assert.ok(exam.finishedElapsed>=660&&exam.finishedElapsed<=840.2);
    const talk=exam.events.find(e=>e.stage==='talk');
    assert.ok(talk.duration<=126.2,'two-minute response plus examiner reading time');
    if(style==='continuous')assert.ok(exam.events.some(e=>e.interrupted),'long answers are interrupted');
  });
}

test('Part 2 two-minute limit interrupts continuing speech',()=>{
  let now=100000;const exam=new ExamEngine(plan(),{speechDriven:true,autoNext:true},()=>now);
  exam.start();exam.beginPart2();exam.ready();now+=60000;exam.tick();exam.ready();exam.beginAnswer(true);
  const talk=exam.current;
  for(let i=0;i<600;i++){now+=200;exam.receiveLevel(.06);exam.tick();}
  assert.equal(exam.stage,'roundup');assert.equal(talk.duration,120);assert.equal(talk.interrupted,true);
});

test('disabling silence advancement does not disable interruption of an overlong answer',()=>{
  let now=100000;const exam=new ExamEngine(plan(),{speechDriven:true,autoNext:false},()=>now);
  exam.start();exam.enter('part1',300);exam.beginAnswer(true);const first=exam.current;
  for(let i=0;i<10;i++){now+=100;exam.receiveLevel(.06);exam.tick();}
  for(let i=0;i<40;i++){now+=100;exam.receiveLevel(.001);exam.tick();}
  assert.equal(exam.current,first,'silence advancement is disabled');
  for(let i=0;i<380&&exam.current===first;i++){now+=100;exam.receiveLevel(.06);exam.tick();}
  assert.notEqual(exam.current,first);assert.equal(first.interrupted,true);
});
