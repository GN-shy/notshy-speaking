import test from 'node:test';
import assert from 'node:assert/strict';
import {ExamEngine,rankPart3} from '../web/engine.js';

const plan=()=>({mode:'full',part1:Array.from({length:33},(_,i)=>({id:'t'+i,title:'Topic '+i,page:5,questions:Array.from({length:4},(_,j)=>({id:`t${i}q${j}`,text:'What do you think about this?'}))})),part2:{id:'card',title:'A park',prompt:'Describe a park.',bullets:['Where','When','Who','Why'],part3:Array.from({length:6},(_,i)=>({id:'p3-'+i,text:'Why do people visit parks?'}))}});
function run(pace,readDelay=0){
  let now=100000;const exam=new ExamEngine(plan(),{adaptive:true},()=>now);
  const transitions=[];let previous='';
  exam.onchange=()=>{if(exam.stage!==previous){transitions.push({stage:exam.stage,time:exam.elapsed});previous=exam.stage;}};
  exam.start();
  for(let i=0;i<50000&&exam.stage!=='done';i++){
    if(exam.waitingForVoice){now+=readDelay*1000;exam.ready();}
    if(pace&&exam.questionElapsed>=pace&&['intro','part1','part3'].includes(exam.stage))exam.next('I enjoy nature because it helps people relax.');
    if(pace&&exam.stage==='talk'&&exam.stageElapsed>=Math.max(60,pace))exam.next('I visited a park in my city.');
    now+=200;exam.tick();
  }
  return{exam,transitions};
}
for(const pace of [null,4,12,24,45,100]){
  test(`full exam meets all official phase bounds at pace ${pace}`,()=>{
    const {exam,transitions}=run(pace,8);
    const begin=s=>transitions.find(t=>t.stage===s)?.time;
    assert.equal(exam.stage,'done');assert.equal(exam.reason,'completed');
    const p1=begin('prep'),p2=begin('part3')-begin('prep'),p3=begin('done')-begin('part3');
    assert.ok(p1>=240&&p1<=300.3,`P1 ${p1}`);
    assert.ok(p2>=180&&p2<=240.3,`P2 ${p2}`);
    assert.ok(p3>=240&&p3<=300.3,`P3 ${p3}`);
    assert.ok(exam.finishedElapsed>=660&&exam.finishedElapsed<=840.3,`Total ${exam.finishedElapsed}`);
    const seen=exam.events.filter(e=>e.stage==='part1').map(e=>e.topicId);
    assert.ok(new Set(seen).size>=3,'multiple Part 1 topics');
    const groups=seen.filter((x,i)=>i===0||x!==seen[i-1]);assert.equal(new Set(groups).size,groups.length,'topics stay contiguous');
    assert.ok(exam.events.filter(e=>e.stage==='part3'&&e.kind==='bank').every(e=>e.topicId==='card'));
  });
}
test('Part 2 gives exactly sixty seconds after spoken instructions finish',()=>{
  let now=100000;const exam=new ExamEngine(plan(),{},()=>now);exam.start();exam.beginPart2();
  now+=10000;exam.tick();assert.equal(exam.stage,'prep');exam.ready();
  now+=59999;exam.tick();assert.equal(exam.stage,'prep');now+=1;exam.tick();assert.equal(exam.stage,'talk');
  exam.ready();exam.next('too early');assert.equal(exam.stage,'talk');now+=60000;exam.next('ready');assert.equal(exam.stage,'roundup');
});
test('unseen Part 3 questions outrank repeated questions; answer keywords break ties',()=>{
  const qs=[{id:'a',text:'What music is popular?'},{id:'b',text:'How can schools teach science?'},{id:'c',text:'What science technology is useful?'}];
  const result=rankPart3(qs,'science technology',{c:{count:1}});
  assert.deepEqual(result.map(q=>q.id),['b','a','c']);
});
test('topic mode ends after the selected Part 1 group and records only displayed questions',()=>{
  let now=100000;const p=plan();p.mode='topic';p.part1=p.part1.slice(0,1);
  const exam=new ExamEngine(p,{},()=>now);exam.start();assert.equal(exam.events.length,1);
  for(let i=0;i<4;i++){now+=10000;exam.next('A useful answer.');}
  assert.equal(exam.stage,'done');assert.equal(exam.events.length,4);assert.equal(exam.snapshot().some(e=>Object.hasOwn(e,'_askedMs')),false);
});
test('forced total-time limit ends even while voice callback is delayed',()=>{
  let now=100000;const exam=new ExamEngine(plan(),{},()=>now);exam.start();exam.beginPart2();
  now+=841000;exam.tick();assert.equal(exam.stage,'done');
});

for(const type of ['practice','exam']){
  test(`full ${type} asks every question in each selected topic before changing topics`,()=>{
    let now=100000;const p=plan();p.type=type;
    p.part1=p.part1.slice(0,3).map((t,i)=>({...t,questions:Array.from({length:[6,8,11][i]},(_,j)=>({id:`${t.id}q${j}`,text:`Question ${j+1}?`}))}));
    const exam=new ExamEngine(p,{},()=>now);exam.start();
    for(let i=0;i<4;i++){now+=1000;exam.next('Introduction.');}
    for(const topic of p.part1){
      for(const question of topic.questions){
        assert.equal(exam.stage,'part1');
        assert.equal(exam.current.topicId,topic.id);
        assert.equal(exam.current.questionId,question.id);
        now+=9000;exam.next('An answer.');exam.tick();
      }
    }
    assert.equal(exam.stage,'prep');
    assert.deepEqual(exam.events.filter(e=>e.stage==='part1').map(e=>e.questionId),p.part1.flatMap(t=>t.questions.map(q=>q.id)));
  });
}

test('timed exam still enforces the Part 1 deadline for a long topic',()=>{
  let now=100000;const p=plan();p.part1[0].questions=Array.from({length:17},(_,i)=>({id:`long-${i}`,text:'A question?'}));
  const exam=new ExamEngine(p,{},()=>now);exam.start();
  for(let i=0;i<4;i++)exam.next('Introduction.');
  now+=300000;exam.tick();assert.equal(exam.stage,'prep');
  assert.equal(exam.events.find(e=>e.stage==='part1').advanceReason,'stage-time');
});

test('free practice never advances after silence, question limits, or total time',()=>{
  let now=100000;const p=plan();p.type='practice';
  const exam=new ExamEngine(p,{autoNext:true},()=>now);exam.start();
  const wait=()=>{const current=exam.current;now+=3600000;exam.tick();exam.next('automatic attempt',true);assert.equal(exam.current,current);assert.equal(exam.remaining,Infinity);};
  wait();
  for(let i=0;i<4;i++)exam.next('A manual answer.');
  assert.equal(exam.stage,'part1');wait();
  for(let i=0;i<12;i++)exam.next('A manual answer.');
  assert.equal(exam.stage,'prep');exam.ready();wait();
  exam.next();assert.equal(exam.stage,'talk');exam.ready();wait();
  exam.next('No minimum speech time.');assert.equal(exam.stage,'roundup');wait();
  exam.next('A short addition.');assert.equal(exam.stage,'part3');wait();
  for(let i=0;i<6;i++)exam.next('An opinion.');
  assert.equal(exam.stage,'done');assert.equal(exam.reason,'completed');
});

test('practice permits immediate manual preparation and speech completion',()=>{
  let now=100000;const p=plan();p.type='practice';p.mode='topic';p.part1=[];
  const exam=new ExamEngine(p,{},()=>now);exam.start();assert.equal(exam.stage,'prep');
  exam.next();assert.equal(exam.stage,'prep','wait for examiner to finish reading');
  exam.ready();exam.next();assert.equal(exam.stage,'talk');
  exam.ready();exam.next('Done.');assert.equal(exam.stage,'roundup');
  exam.next('Done.');assert.equal(exam.stage,'part3');
});
