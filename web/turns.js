// Local voice activity only: no network transcription or semantic completion claim.
export class SpeechTurn {
  constructor(clock=()=>Date.now(),softLimit=25){
    this.clock=clock;this.startedAt=clock();this.lastSampleAt=this.startedAt;
    this.lastVoiceAt=null;this.voicedFor=0;this.heardSpeech=false;this.noiseFloor=.004;
    this.softLimit=softLimit;
  }
  get elapsed(){return Math.max(0,(this.clock()-this.startedAt)/1000);}
  get silence(){return this.lastVoiceAt===null?this.elapsed:Math.max(0,(this.clock()-this.lastVoiceAt)/1000);}
  feed(rms){
    const now=this.clock(),dt=Math.max(0,Math.min(.25,(now-this.lastSampleAt)/1000));
    this.lastSampleAt=now;
    const threshold=Math.max(.012,Math.min(.05,this.noiseFloor*2.8));
    if(Number.isFinite(rms)&&rms>threshold){
      this.lastVoiceAt=now;this.voicedFor+=dt;
      if(this.voicedFor>=.3)this.heardSpeech=true;
    }else if(Number.isFinite(rms)&&rms>=0){
      this.noiseFloor=.985*this.noiseFloor+.015*Math.min(rms,.02);
    }
  }
  decision(stage,stageElapsed=0){
    if(stage==='prep')return null;
    if(stage==='talk'){
      // A thinking pause is not a completed long turn. Never end before one minute.
      return stageElapsed>=60&&this.heardSpeech&&this.silence>=5?'answer-finished':null;
    }
    const endPause=stage==='intro'?2.5:3.2;
    if(this.heardSpeech&&this.elapsed>=4&&this.silence>=endPause)return 'answer-finished';
    const noResponse=stage==='intro'?14:stage==='part3'?40:30;
    if(!this.heardSpeech)return this.elapsed>=noResponse?'no-response':null;
    // Prefer a short pause when a long response needs to be brought to a close.
    if(this.elapsed>=this.softLimit&&this.silence>=.9)return 'examiner-interruption';
    const hardLimit=stage==='intro'?18:stage==='part3'?Math.max(75,this.softLimit+25):Math.max(35,this.softLimit+12);
    return this.elapsed>=hardLimit?'examiner-interruption':null;
  }
}
