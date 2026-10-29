import test from 'node:test';
import assert from 'node:assert/strict';
import {SprintEngine} from '../web/engine.js';
const plan=()=>({mode:'sprint',type:'practice',part1:Array.from({length:4},(_,i)=>({id:`topic${i}`,title:`Topic ${i}`,questions:Array.from({length:5+i},(_,j)=>({id:`p1-${i}-${j}`,text:`Question ${j}?`}))})),cards:Array.from({length:6},(_,i)=>({id:`card${i}`,title:`Card ${i}`,prompt:`Describe topic ${i}.`,bullets:['Where','When'],part3:Array.from({length:4+i%3},(_,j)=>({id:`p3-${i}-${j}`,text:`Discuss ${j}?`}))}))});
function advance(engine){engine.ready();engine.next('A complete answer.');}
test('daily sprint asks exactly four full topics and six paired cards with all Part 3 questions',()=>{
  let now=100000;const p=plan(),e=new SprintEngine(p,{},()=>now);e.start();
  let n=0;
  while(e.stage!=='done'){
    const current=e.current;now+=3600000;e.ready();e.tick();e.next('automatic',true);
    assert.equal(e.current,current,'even an hour never advances automatically');
    advance(e);if(++n>200)throw Error('Workload did not end');
  }
  assert.equal(e.reason,'completed');assert.deepEqual(e.progress(),{part1:4,cards:6,answered:e.steps.length,total:e.steps.length});
  assert.deepEqual(e.events.filter(q=>q.stage==='part1').map(q=>q.questionId),p.part1.flatMap(t=>t.questions.map(q=>q.id)));
  assert.deepEqual(e.events.filter(q=>q.stage==='prep').map(q=>q.questionId),p.cards.map(t=>t.id));
  assert.equal(e.events.filter(q=>q.stage==='talk').length,6);
  for(const t of p.cards)assert.deepEqual(e.events.filter(q=>q.stage==='part3'&&q.topicId===t.id).map(q=>q.questionId),t.part3.map(q=>q.id));
  assert.equal(e.events.some(q=>q.stage==='intro'||q.stage==='roundup'||q.kind==='supplement'),false);
});
test('pausing and resuming repeats the unfinished step without marking it answered',()=>{
  let now=100000;const e=new SprintEngine(plan(),{},()=>now);e.start();
  for(let i=0;i<7;i++)advance(e);
  const id=e.current.id;e.current.answer='Half an answer';e.finish('interrupted');
  assert.equal(e.current.answered,false);
  const saved={events:e.snapshot(),elapsed:e.finishedElapsed};
  const resumed=new SprintEngine(plan(),{},()=>now);resumed.start(saved);
  assert.equal(resumed.position,7);assert.equal(resumed.current.id,id);assert.equal(resumed.current.answer,'Half an answer');
  assert.equal(resumed.events.length,8);assert.equal(resumed.progress().answered,7);
  advance(resumed);assert.equal(resumed.position,8);assert.equal(resumed.events.filter(e=>e.id===id).length,1);
});
test('a Part 2/3 group is complete only after its last Part 3 answer',()=>{
  const e=new SprintEngine(plan());e.start();while(e.stage==='part1')advance(e);
  assert.equal(e.progress().part1,4);assert.equal(e.progress().cards,0);
  advance(e);assert.equal(e.stage,'talk');advance(e);assert.equal(e.stage,'part3');
  for(let i=0;i<3;i++){advance(e);assert.equal(e.progress().cards,0);}
  advance(e);assert.equal(e.progress().cards,1);assert.equal(e.stage,'prep');assert.equal(e.current.topicId,'card1');
});
