// Short renders use the same vocal processor as playback. During a pitch drag,
// detune the active preview immediately while the next render is being prepared.
let monitorVoice=null,monitorEnabled=true;
function stopMonitor() {
  const v=monitorVoice;monitorVoice=null;if(!v)return;
  clearTimeout(v.timer);fadeVoice(v.audio);
}
function fadeVoice(audio) {
  if(!audio)return;
  const now=context.currentTime;
  audio.env.gain.cancelScheduledValues(now);audio.env.gain.setTargetAtTime(0,now,.004);
  try{audio.src.stop(now+.022);}catch{}
}
function monitorNote(t,n) {
  stopMonitor();if(!monitorEnabled)return;
  const v={track:t,n,held:true,revision:0,pending:false,audio:null};monitorVoice=v;
  context??=new AudioContext();
  context.resume().then(()=>renderMonitor(v)).catch(e=>{if(monitorVoice===v){stopMonitor();status(e.message,true);}});
}
async function renderMonitor(v) {
  if(v!==monitorVoice||v.pending)return;
  v.pending=true;
  const version=v.revision,t=v.track,n={...v.n},rate=t.rate;
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
    const src=context.createBufferSource(),env=context.createGain(),level=context.createGain(),panner=context.createStereoPanner();
    src.buffer=buf;src.loop=v.held;src.detune.value=(v.n.pitch-n.pitch)*100;
    src.connect(env).connect(level).connect(panner).connect(context.destination);
    const previous=v.audio;
    v.audio={src,env,level,panner,pitch:n.pitch};applyMix(t,true);
    const now=context.currentTime;env.gain.setValueAtTime(0,now);env.gain.linearRampToValueAtTime(1,now+.006);
    src.onended=()=>{src.disconnect();env.disconnect();level.disconnect();panner.disconnect();if(v.audio?.src===src&&!v.held&&monitorVoice===v)monitorVoice=null;};
    src.start();fadeVoice(previous);
  }catch(e){if(v===monitorVoice){stopMonitor();status('Note preview: '+e.message,true);}}
  finally{v.pending=false;if(v===monitorVoice&&v.held&&v.revision!==version)scheduleMonitor(v);}
}
function scheduleMonitor(v){
  clearTimeout(v.timer);v.timer=setTimeout(()=>renderMonitor(v),70);
}
function updateMonitor(){
  const v=monitorVoice;if(!v||!v.held)return;
  if(v.audio)v.audio.src.detune.setTargetAtTime((v.n.pitch-v.audio.pitch)*100,context.currentTime,.008);
  v.revision++;if(!v.pending)scheduleMonitor(v);
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
