import {SpeechTurn} from './turns.js';
// Deterministic exam flow. Clock injection lets tests exercise every boundary.
export const OFFICIAL = {part1Min:240,part1Max:300,prep:60,talk:120,part2Min:180,part2Max:240,part3Min:240,part3Max:300,totalMax:840};
export const STAGES = {intro:'开场介绍',part1:'日常话题',prep:'准备时间',talk:'个人陈述',roundup:'简短追问',part3:'深入讨论',done:'考试结束'};
const INTRO = [
  "Good morning. My name is Alex. What's your full name, please?",
  "What can I call you?",
  "Do you work or are you a student?",
  "Which city do you live in?"
];
const STOP = new Set('a an the i me my we our you your they their he she his her it is are was were do does did have has had and but or to of in on at for from with that this these those about because very really think know like people can could would should will just some more when where what why how not so as be been being then than also many much there which who time thing things'.split(' '));
export function tokens(text){return (String(text).toLowerCase().match(/[a-z]{3,}/g)||[]).filter(w=>!STOP.has(w));}
export function rankPart3(questions, answer, usage={}){
  const words=new Set(tokens(answer));
  return [...questions].sort((a,b)=>{
    const ca=usage[a.id]?.count||0,cb=usage[b.id]?.count||0;
    if(ca!==cb)return ca-cb;
    const relevance=q=>tokens(q.text).filter(w=>words.has(w)).length;
    return relevance(b)-relevance(a);
  });
}

export class ExamEngine {
  constructor(plan, options={}, clock=()=>Date.now()){
    this.plan=plan;this.options=options;this.clock=clock;this.startedAt=0;this.stage='idle';this.events=[];
    this.current=null;this.onchange=()=>{};this.group=0;this.q=0;this.introIndex=0;this.discussion=[];
    this.supplementIndex=0;this.questionSequence=0;this.completedGroups=0;this.reason='';this.busy=false;
  }
  get elapsed(){return this.startedAt?(this.clock()-this.startedAt)/1000:0;}
  get stageElapsed(){return (this.clock()-this.stageAt)/1000;}
  get remaining(){return Math.max(0,this.deadline-this.elapsed);}
  get questionElapsed(){return this.current?(this.clock()-this.current._askedMs)/1000:0;}
  get isPractice(){return (this.plan.type||this.options.type||(this.plan.mode==='topic'?'practice':'exam'))==='practice';}
  start(){
    this.startedAt=this.clock();
    if(this.plan.mode==='topic'){
      if(this.plan.part1.length)this.enter('part1',Infinity);else this.beginPart2();
    }else this.enter('intro',45);
  }
  enter(stage,duration){
    if(this.isPractice)duration=Infinity;
    this.stage=stage;this.stageAt=this.clock();this.deadline=this.elapsed+duration;
    this.waitingForVoice=stage==='prep'||stage==='talk';
    if(this.waitingForVoice)this.deadline=Infinity;
    if(stage==='intro')this.askIntro();
    if(stage==='part1')this.askPart1();
    if(stage==='prep')this.ask({id:this.plan.part2.id,text:this.plan.part2.prompt,bullets:this.plan.part2.bullets,page:this.plan.part2.page},this.plan.part2,'card');
    if(stage==='talk')this.ask({id:'talk',text:this.isPractice?"All right. Please begin when you are ready. Click 'I'm done' when you finish.":"All right. Now, please begin. You have up to two minutes."},this.plan.part2,'instruction');
    if(stage==='roundup')this.ask({id:'roundup',text:'Is there anything else you would like to add about this topic?'},this.plan.part2,'supplement');
    if(stage==='part3'){
      const talk=this.events.find(e=>e.stage==='talk')?.answer||'';
      this.discussion=rankPart3(this.plan.part2.part3,this.options.adaptive?talk:'',this.options.usage||{});
      this.askPart3();
    }
  }
  ask(q,topic=null,kind='bank'){
    this.turn=null;this.answerReadyAt=null;this.microphoneReady=false;
    this.current={id:crypto.randomUUID(),questionId:q.id,text:q.text,bullets:q.bullets||[],page:q.page||topic?.page||null,
      stage:this.stage,topicId:topic?.id||null,topic:topic?.title||'Introduction',kind,
      askedAt:this.clock()/1000,elapsed:this.elapsed,answer:'',duration:0,_askedMs:this.clock(),answered:false};
    this.events.push(this.current);this.questionSequence++;this.onchange(this.current);
  }
  askIntro(){this.ask({id:'intro-'+this.introIndex,text:INTRO[this.introIndex]},null,'intro');}
  askPart1(){
    const group=this.plan.part1[this.group];
    if(!group)return this.plan.mode==='topic'?this.finish('completed'):this.beginPart2();
    this.ask(group.questions[this.q],group);
  }
  askPart3(){
    if(this.discussion.length){
      const answer=this.events.filter(e=>e.stage==='talk'||e.stage==='part3').map(e=>e.answer).join(' ');
      if(this.options.adaptive)this.discussion=rankPart3(this.discussion,answer,this.options.usage||{});
      this.ask(this.discussion.shift(),this.plan.part2);return;
    }
    const questions=['Why do you think that is the case?','Can you give an example to support that view?',
      'Do you think this will change in the future? Why?', 'Are there different views on this issue in your country?',
      'What are the possible effects on society?', 'How might younger and older people feel differently about this?'];
    const index=this.supplementIndex++;
    this.ask({id:'followup-'+index,text:questions[index%questions.length]},this.plan.part2,'supplement');
  }
  closeCurrent(answer){
    if(!this.current||this.current.answered)return;
    if(answer!==undefined)this.current.answer=answer;
    this.current.duration=Math.max(0,this.questionElapsed);this.current.answered=true;
  }
  beginPart2(){this.part2At=this.elapsed;this.enter('prep',60);}
  ready(){
    if(!this.waitingForVoice)return;
    this.waitingForVoice=false;this.stageAt=this.clock();
    this.deadline=this.isPractice?Infinity:this.elapsed+(this.stage==='prep'?60:120);
  }
  beginAnswer(microphoneReady=false){
    this.answerReadyAt=this.clock();this.microphoneReady=microphoneReady;
    const nominal=this.questionLimit();
    const softLimit=this.stage==='intro'?8:this.stage==='part1'?Math.max(18,nominal):this.stage==='part3'?48:25;
    this.turn=microphoneReady?new SpeechTurn(this.clock,softLimit):null;
  }
  receiveLevel(rms){this.turn?.feed(rms);}
  markAdvance(reason){
    if(!this.current)return;
    this.current.advanceReason=reason;
    this.current.interrupted=reason==='examiner-interruption'||(reason==='stage-time'&&!!this.turn?.heardSpeech&&this.turn.silence<.9);
  }
  next(answer,automatic=false,reason=null){
    if(['idle','done'].includes(this.stage)||this.waitingForVoice)return;
    if(this.isPractice&&automatic)return;
    if(this.stage==='prep'&&!this.isPractice)return;
    if(!this.isPractice&&this.stage==='talk'&&this.stageElapsed<60)return;
    if(!this.isPractice&&this.stage==='roundup'&&this.elapsed-this.part2At<180)return;
    this.markAdvance(reason||(automatic?'timed-next':'manual'));
    if(this.stage==='part3'&&this.discussion.length===0&&(this.isPractice||this.stageElapsed>=240)){this.closeCurrent(answer);return this.finish('completed');}
    this.closeCurrent(answer);
    if(this.stage==='intro'){
      this.introIndex++;
      if(this.introIndex>=INTRO.length)this.enter('part1',300-this.elapsed);else this.askIntro();
    }else if(this.stage==='part1'){
      const group=this.plan.part1[this.group];this.q++;
      if(this.q>=group.questions.length){
        this.q=0;this.group++;this.completedGroups++;
        if(this.plan.mode==='full'&&this.completedGroups>=3&&(this.isPractice||this.elapsed>=240))return this.beginPart2();
      }
      this.askPart1();
    }else if(this.stage==='prep')this.enter('talk',120);
    else if(this.stage==='talk'){
      const duration=Math.max(30,180-(this.elapsed-this.part2At));this.enter('roundup',duration);
    }else if(this.stage==='roundup')this.enter('part3',270);
    else if(this.stage==='part3')this.askPart3();
  }
  questionLimit(){
    if(this.isPractice)return Infinity;
    if(this.stage==='intro')return 12;
    if(this.stage==='part1'){
      if(this.plan.mode==='topic')return 35;
      // Reserve enough time for three complete topic groups under normal pacing.
      const remainingQs=this.plan.part1.slice(this.group,3).reduce((n,t)=>n+t.questions.length,0)-this.q;
      return Math.max(10,Math.min(25,(300-this.elapsed)/Math.max(remainingQs,1)));
    }
    if(this.stage==='part3')return this.current?.kind==='supplement'?35:48;
    return Infinity;
  }
  tick(){
    if(['idle','done'].includes(this.stage))return;
    if(this.isPractice)return;
    if(this.plan.mode==='full'&&this.elapsed>=840)return this.finish('completed');
    if(['prep','talk','roundup'].includes(this.stage)&&this.elapsed-this.part2At>=240){
      this.markAdvance('stage-time');
      this.closeCurrent();return this.enter('part3',270);
    }
    if(this.elapsed>=this.deadline){
      this.markAdvance('stage-time');
      this.closeCurrent();
      if(this.stage==='intro')return this.enter('part1',300-this.elapsed);
      if(this.stage==='part1')return this.beginPart2();
      if(this.stage==='prep')return this.enter('talk',120);
      if(this.stage==='talk')return this.enter('roundup',30);
      if(this.stage==='roundup')return this.enter('part3',270);
      if(this.stage==='part3')return this.finish('completed');
    }
    if(this.options.speechDriven){
      // Do not spend a candidate's answer allowance while the examiner is reading.
      if(this.answerReadyAt===null)return;
      if(this.microphoneReady&&this.turn){
        const reason=this.turn.decision(this.stage,this.stageElapsed);
        if(reason&&(reason==='examiner-interruption'||this.options.autoNext!==false))this.next(undefined,true,reason);
        return;
      }
    }
    if(this.questionElapsed>=this.questionLimit())this.next(undefined,true,'timed-next');
  }
  finish(reason='interrupted'){
    if(this.stage==='done')return;
    if(!this.current?.advanceReason)this.markAdvance(reason==='completed'?'stage-time':'manual-end');
    this.closeCurrent();this.reason=reason;this.finishedElapsed=this.elapsed;this.stage='done';this.onchange(null);
  }
  snapshot(){
    return this.events.map(({_askedMs,...event})=>({...event,answer:event.answer||''}));
  }
}
