let monitorVoice=null,monitorEnabled=true;
function stopMonitor() {
  const v=monitorVoice;monitorVoice=null;if(!v)return;
  fadeVoice(v.audio);
}
function fadeVoice(audio) {
  if(!audio)return;
  const now=context.currentTime;
  audio.env.gain.cancelScheduledValues(now);audio.env.gain.setTargetAtTime(0,now,.004);
  try{audio.src.stop(now+.022);}catch{}
}
function monitorNote(t,n) {
  stopMonitor();if(!monitorEnabled)return;
  const v={track:t,n,held:true,audio:null};monitorVoice=v;
  context??=new AudioContext();
  context.resume().then(()=>renderMonitor(v)).catch(e=>{if(monitorVoice===v){stopMonitor();status(e.message,true);}});
}
async function renderMonitor(v) {
  if(v!==monitorVoice)return;
  const t=v.track,n={...v.n},rate=t.rate;
  try {
    // Work on at most a syllable at a time, even for long sustained notes.
    const start=Math.round(n.s*rate),duration=Math.min(.85,n.e-n.s);
    const stretch=clamp((n.e-n.s+n.length)/(n.e-n.s),.1,8);
    const size=Math.max(1,Math.round(duration*rate)),outSize=Math.max(1,Math.round(size*stretch));
    const channels=t.channels.map(ch=>{const a=new Float32Array(Math.max(size,outSize));a.set(ch.subarray(start,start+size));return a;});
    const frame=Math.floor(n.s/HOP),frames=t.frames.slice(frame,frame+Math.ceil(duration/HOP)+1);
    const local={...n,s:0,e:size/rate,offset:0,length:(outSize-size)/rate};
    const samples=await dsp('render',channels,rate,frames,[local]);
    if(v!==monitorVoice)return;
    const buf=context.createBuffer(samples.length,outSize,rate);
    samples.forEach((ch,i)=>{
      const data=ch.subarray(0,outSize);
      const edge=Math.min(Math.floor(outSize/3),Math.round(rate*.006));
      for(let j=0;j<edge;j++){data[j]*=j/edge;data[outSize-1-j]*=j/edge;}
      buf.copyToChannel(data,i);
    });
    // Loop a stable interior vowel, excluding the onset and release. Align
    // the wrap to a pitch period and blend its tail into the preceding cycle.
    const period=Math.max(2,Math.round(rate/midiHz(n.p+n.pitch)));
    const waveform=buf.getChannelData(0), width=Math.max(2,Math.floor(outSize*.24));
    let startLoop=Math.floor(outSize*.22),best=-Infinity;
    for(let k=startLoop;k<outSize*.62;k+=Math.max(1,period)){
      let energy=0,variation=0,previous=0;
      for(let j=0;j<width;j+=8){
        const level=Math.abs(waveform[k+j]||0);
        energy+=level;variation+=Math.abs(level-previous);previous=level;
      }
      const score=energy-.35*variation;
      if(score>best){best=score;startLoop=k;}
    }
    const loopLength=Math.min(width,Math.max(period,Math.round(width/period)*period));
    const endLoop=Math.min(outSize-1,startLoop+loopLength);
    const blend=Math.min(period*2,startLoop,Math.floor((endLoop-startLoop)/3));
    for(let c=0;c<buf.numberOfChannels;c++){
      const data=buf.getChannelData(c);
      for(let j=0;j<blend;j++){
        const mix=(j+1)/blend;
        data[endLoop-blend+j]=data[endLoop-blend+j]*(1-mix)+data[startLoop-blend+j]*mix;
      }
    }
    const src=context.createBufferSource(),env=context.createGain(),level=context.createGain(),panner=context.createStereoPanner();
    src.buffer=buf;src.loopStart=startLoop/rate;src.loopEnd=endLoop/rate;src.loop=v.held;src.detune.value=(v.n.pitch-n.pitch)*100;
    src.connect(env).connect(level).connect(panner).connect(context.destination);
    v.audio={src,env,level,panner,pitch:n.pitch};applyMix(t,true);
    const now=context.currentTime;env.gain.setValueAtTime(0,now);env.gain.linearRampToValueAtTime(1,now+.006);
    src.onended=()=>{src.disconnect();env.disconnect();level.disconnect();panner.disconnect();if(v.audio?.src===src&&!v.held&&monitorVoice===v)monitorVoice=null;};
    src.start();
  }catch(e){if(v===monitorVoice){stopMonitor();status('Note preview: '+e.message,true);}}
}
function updateMonitor(){
  const v=monitorVoice;if(!v?.held||!v.audio)return;
  v.audio.src.detune.setTargetAtTime((v.n.pitch-v.audio.pitch)*100,context.currentTime,.012);
}
function releaseMonitor(dragged){
  const v=monitorVoice;if(!v)return;
  if(dragged){stopMonitor();return;}
  v.held=false;if(v.audio)v.audio.src.loop=false;
}
$('monitor').onclick=()=>{
  monitorEnabled=!monitorEnabled;if(!monitorEnabled)stopMonitor();
  $('monitor').setAttribute('aria-pressed',monitorEnabled);$('monitor').textContent=monitorEnabled?'Monitor on':'Monitor off';
};
window.addEventListener('blur',stopMonitor);
