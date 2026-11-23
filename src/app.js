'use strict';
const $=id=>document.getElementById(id);
const colors=['#ff6474','#a7a1f5','#77b9db','#eca487','#ddb1d7','#87bbb5'];
const names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const noteName=p=>names[((Math.round(p)%12)+12)%12]+(Math.floor(Math.round(p)/12)-1);
const seconds=t=>Math.floor(t/60)+':'+(t%60).toFixed(2).padStart(5,'0');
const opt=(name,value)=>new Option(name,value);
const tracks=[],undoStack=[],redoStack=[];
let chordSource=-1,active=0, selected=-1, position=0, original=false,busy=false,dirty=false, projectTitle='Untitled project';
let context, playing=false,startClock=0,sources=[],playToken=0, jobSeq=0;
const workers=new Map();
const mixerNodes=new Map();
const workerCode=$('dsp-source').textContent+`
onmessage=e=>{
  const {id,kind,args}=e.data;
  try {
    let result;
    if(kind==='analyze')result=analyze(...args);
    if(kind==='harmony')result=backingHarmony(...args);
    if(kind==='render')result=renderTrack(...args);
    if(kind==='align')result=align(...args)||args[1].notes;
    postMessage({id,result},kind==='render'?result.map(ch=>ch.buffer):[]);
  } catch(err){postMessage({id,error:err.message});}
};`;
const processor=new Worker(URL.createObjectURL(new Blob([workerCode],{type:'text/javascript'})));
processor.onmessage=({data})=>{
  const job=workers.get(data.id);if(!job)return;
  workers.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data.result);
};
processor.onerror=e=>{for(const job of workers.values())job.reject(Error(e.message||'Audio worker failed.'));workers.clear();};
function dsp(kind,...args) {
  return new Promise((resolve,reject)=>{const id=++jobSeq;workers.set(id,{resolve,reject});processor.postMessage({id,kind,args});});
}
const duration=()=>Math.max(0,...tracks.map(t=>t.channels[0].length/t.rate));
const current=()=>tracks[active];
const note=()=>current()?.notes[selected];
function status(s,err=false){$('status').textContent=s;$('status').className=err?'error':'';}
function title(s){projectTitle=s;$('projectTitle').textContent=s;}
async function run(fn) {
  if(busy)return;busy=true;document.body.classList.add('working');
  try{await fn();}catch(e){status(e.message,true);}finally{busy=false;document.body.classList.remove('working');refresh();}
}
function invalidate(t){t.cache=null;dirty=true;}
function remember(whileEditing=false) {
  if(!whileEditing)stop();
  undoStack.push(tracks.map(t=>structuredClone(t.notes)));if(undoStack.length>40)undoStack.shift();redoStack.length=0;dirty=true;
}
function history(from,to) {
  if(!from.length)return;stop();to.push(tracks.map(t=>structuredClone(t.notes)));
  const snapshot=from.pop();
  tracks.forEach((t,i)=>{t.notes=snapshot[i];invalidate(t);});
  selected=-1;refresh();
}
async function prepare(raw,idx) {
  const t={role:'vocal',mute:false,solo:false,selected:true,visible:true,tight:1,...raw,cache:null};
  t.volume=Number.isFinite(t.volume)?clamp(t.volume,-60,12):0;
  t.pan=Number.isFinite(t.pan)?clamp(t.pan,-1,1):0;
  status('Analyzing '+t.name+'…');
  t.pitchAnalyzed=t.role==='vocal'||Boolean(raw.notes?.length);
  const x=await dsp('analyze',vocalChannel(t.channels),t.rate,t.pitchAnalyzed);
  t.frames=x.frames;t.slow=slowContour(t.frames);t.notes=raw.notes?.length?raw.notes:x.notes;t.color=colors[idx%colors.length];
  return t;
}
async function addFiles(rawTracks,replace=false) {
  if(!rawTracks.length)return;stop();
  const list=[];
  for(const raw of rawTracks)list.push(await prepare(raw,(replace?0:tracks.length)+list.length));
  if(replace){resetViewport();tracks.length=0;position=0;active=0;}
  tracks.push(...list);
  if(current()?.role==='reference'){
    const vocal=list.find(t=>t.role==='vocal');if(vocal){active=tracks.indexOf(vocal);if(tracks.filter(t=>t.role==='vocal').length===list.filter(t=>t.role==='vocal').length)$('guide').dataset.pending=String(active);}
  }
  selected=-1;dirty=true;undoStack.length=0;redoStack.length=0;
  if(tracks.length===list.length){title(list[0].name.replace(/\.(wav|wave)$/i,'')+' · Vocals');$('guide').dataset.pending='0';}
  status('Ready · '+list.length+' track'+(list.length===1?'':'s')+' loaded.');
}
async function rendered(t) {
  if(t.role==='reference'||!t.notes.some(edited))return t.channels;
  if(!t.cache)t.cache=await dsp('render',t.channels,t.rate,t.frames,t.notes);
  return t.cache;
}
function stop() {
  stopMonitor();
  playing=false;playToken++;
  for(const s of sources){try{s.stop();}catch{}s.disconnect();}
  for(const {level,panner} of mixerNodes.values()){level.disconnect();panner.disconnect();}
  mixerNodes.clear();sources=[];$('play').textContent='▶ Play';draw();
}
function liveTime(){return playing?Math.max(0,context.currentTime-startClock):position;}
function applyMix(t,initial=false) {
  const outputs=[mixerNodes.get(t),monitorVoice?.track===t?monitorVoice.audio:null].filter(Boolean);
  if(!outputs.length)return;
  const muted=t.mute || (tracks.some(track=>track.solo)&&!t.solo);
  const volume=muted||t.volume<=-60?0:10**(t.volume/20);
  const now=context.currentTime;
  for(const nodes of outputs)for(const [param,value] of [[nodes.level.gain,volume],[nodes.panner.pan,t.pan]]){
    if(initial)param.setValueAtTime(value,now);
    else param.setTargetAtTime(value,now,.008);
  }
}
async function play(from=position) {
  if(!tracks.length)return;stopMonitor();if(playing){stop();return;}
  context??=new AudioContext();await context.resume();
  const token=++playToken, batch=[];

  for(const t of tracks){
    status('Preparing playback…');
    const ch=original?t.channels:await rendered(t);if(token!==playToken)return;
    if(from>=ch[0].length/t.rate)continue;
    const buf=context.createBuffer(ch.length,ch[0].length,t.rate);
    ch.forEach((x,i)=>buf.copyToChannel(x,i));
    const src=context.createBufferSource();src.buffer=buf;
    const level=context.createGain(),panner=context.createStereoPanner();
    mixerNodes.set(t,{level,panner});applyMix(t,true);
    src.connect(level).connect(panner).connect(context.destination);batch.push(src);
  }
  if(!batch.length){status('No audible tracks at the cursor.');return;}
  const when=context.currentTime+.04;startClock=when-from;sources=batch;playing=true;
  for(const src of sources)src.start(when,from);
  $('play').textContent='■ Stop';status(original?'Playing original stems':'Playing edited stems');
  function frame(){if(!playing||token!==playToken)return;if(liveTime()>=duration()){stop();return;}draw();requestAnimationFrame(frame);}
  frame();
}
function download(blob,filename) {
  const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download=filename;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);
}
function safeName(s){return s.replace(/[\\/:*?"<>|\x00-\x1F]/g,'_').replace(/\.wav$/i,'').trim()||'Vocal';}
function targets(){const a=tracks.filter(t=>t.selected&&t.role==='vocal');if(!a.length)throw Error('Check at least one vocal track.');return a;}
async function useChordGuide(index) {
  const t=tracks[index];
  if(t?.role!=='reference'){chordSource=-1;return;}
  if(!t.harmony){
    status('Listening to chords in '+t.name+'…');
    t.harmony=await dsp('harmony',t.channels,t.rate);
  }
  chordSource=index;
  status(t.harmony.frames.some(Boolean)?'Chord guide ready · '+t.name:'Backing track ready · using local backing tones where available.');
}
function chordGuide(){return tracks[chordSource]?.harmony||null;}
$('chordGuide').onchange=e=>run(async()=>{stop();await useChordGuide(+e.target.value);dirty=true;});
$('importBacking').onclick=()=>$('backingFile').click();
$('backingFile').onchange=e=>run(async()=>{
  try{
    const file=e.target.files[0];if(!file)return;
    await addFiles([{name:file.name,role:'reference',selected:false,...decodeWav(await file.arrayBuffer())}]);
    await useChordGuide(tracks.length-1);
  }finally{e.target.value='';}
});
function settings(){return Object.fromEntries(['root','scale','strength','timing','bpm','grid','guide','view','chordGuide'].map(id=>[id,$(id).value]));}
async function importWavs(files) {
  const list=[];
  for(const file of files)list.push({name:file.name,...decodeWav(await file.arrayBuffer())});
  await addFiles(list);
}
function mayReplace(){return !dirty||!tracks.length||confirm('Replace this project? Save it first to keep your current edits.');}
$('audioFiles').onchange=e=>run(async()=>{try{await importWavs(e.target.files);}finally{e.target.value='';}});
$('projectFile').onchange=e=>run(async()=>{
  try{
    const f=e.target.files[0];if(!f||!mayReplace())return;
    const obj=readProject(await f.arrayBuffer());await addFiles(obj.tracks,true);await useChordGuide(Number(obj.settings.chordGuide??-1));refresh();
    for(const [id,v] of Object.entries(obj.settings))if(['root','scale','strength','timing','bpm','grid','guide','view'].includes(id))$(id).value=v;
    title(f.name.replace(/\.zpitch$/i,''));dirty=false;status('Project restored with original audio and editable notes.');
  }finally{e.target.value='';}
});
$('newProject').onclick=()=>{
  if(!mayReplace())return;stop();resetViewport();tracks.length=0;chordSource=-1;active=0;selected=-1;position=0;
  undoStack.length=redoStack.length=0;dirty=false;title('Untitled project');refresh();status('Ready to import stems.');
};
$('openProject').onclick=()=>$('projectFile').click();
$('import').onclick=()=>$('audioFiles').click();
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',e=>{e.preventDefault();if(e.dataTransfer.files.length)run(()=>importWavs(e.dataTransfer.files));});
$('save').onclick=()=>{if(!tracks.length)return;download(projectBlob(tracks,settings()),safeName(projectTitle)+'.zpitch');dirty=false;status('Project download requested.');};
$('export').onclick=()=>run(async()=>{
  if(!tracks.length)return;
  const files=[];
  for(const [i,t] of tracks.entries()){
    status('Rendering '+t.name+'…');
    files.push({name:String(i+1).padStart(2,'0')+' '+safeName(t.name)+'.wav',bytes:wavBytes(await rendered(t),t.rate)});
  }
  download(zipStems(files),safeName(projectTitle)+' - stems.zip');status('Exported '+files.length+' time-aligned, 24-bit WAV stems.');
});
$('stem').onclick=()=>run(async()=>{const t=current();if(t){download(new Blob([wavBytes(await rendered(t),t.rate)],{type:'audio/wav'}),safeName(t.name)+' - edited.wav');status('Active stem exported.');}});
function tuneTracks(a){
  const guide=chordGuide();
  let changed=0,held=0,count=0;
  for(const t of a){
    const before=t.notes.map(n=>n.pitch);
    tuneNotes(t.notes,+$('root').value,$('scale').value,+$('strength').value/100,guide);
    t.notes.forEach((n,i)=>{
      count++;if(n.pitchLocked||n.pitchReview?.reason)held++;
      if(Math.abs(n.pitch-before[i])>.0001)changed++;
    });
    invalidate(t);
  }
  if(a.some(t=>t.notes.some(n=>Math.abs(n.pitch)>.0001))){original=false;$('ab').textContent='Listen: Edited';$('ab').setAttribute('aria-pressed','false');}
  if(!count)return 'No pitched notes detected in the checked vocals.';
  const reference=guide?tracks[chordSource].name:'key and scale';
  return changed+' of '+count+' notes changed against '+reference+' · '+held+' held for review or manually locked.';
}
$('tune').onclick=()=>run(()=>{const a=targets();remember();status(tuneTracks(a));});
$('quant').onclick=()=>run(()=>{const a=targets(),bpm=+$('bpm').value;if(bpm<20||bpm>400)throw Error('Set a tempo between 20 and 400 BPM.');remember();for(const t of a){quantize(t.notes,t.channels[0].length/t.rate,bpm,+$('grid').value,+$('timing').value/100);invalidate(t);}status('Timing pass applied.');});
$('firstpass').onclick=()=>run(()=>{
  const a=targets(),bpm=+$('bpm').value;
  if(bpm<20||bpm>400)throw Error('Set a tempo between 20 and 400 BPM.');
  remember();
  for(const t of a){
    quantize(t.notes,t.channels[0].length/t.rate,bpm,+$('grid').value,+$('timing').value/100);
  }
  status('Timing applied. '+tuneTracks(a));
});
$('align').onclick=()=>run(async()=>{
  const guide=tracks[+$('guide').value],a=targets().filter(t=>t!==guide);
  if(!guide||!a.length)throw Error('Choose a guide and check at least one other vocal.');
  const results=[];
  for(const t of a){
    status('Aligning '+t.name+' to '+guide.name+'…');
    results.push(await dsp('align',{frames:guide.frames,notes:guide.role==='reference'?[]:guide.notes},{frames:t.frames,notes:t.notes},t.channels[0].length/t.rate,t.tight*+$('timing').value/100));
  }
  remember();a.forEach((t,i)=>{t.notes=results[i];invalidate(t);});status('Aligned '+a.length+' vocal track(s) to '+guide.name+'.');
});
$('play').onclick=()=>run(play);$('rewind').onclick=()=>{stop();position=0;draw();};
$('ab').onclick=()=>run(async()=>{const resume=playing,at=liveTime();stop();original=!original;$('ab').textContent='Listen: '+(original?'Original':'Edited');$('ab').setAttribute('aria-pressed',original);if(resume)await play(at);});
$('undo').onclick=()=>history(undoStack,redoStack);$('redo').onclick=()=>history(redoStack,undoStack);
$('zoom').oninput=$('pan').oninput=()=>{timeOverhang=0;draw();};
$('view').onchange=()=>{dirty=true;draw();};
for(const id of ['root','scale','strength','timing','bpm','grid','guide'])$(id).onchange=()=>{dirty=true;};
for(const [inp,out] of [['strength','strengthOut'],['timing','timeOut']])$(inp).oninput=()=>$(out).textContent=$(inp).value+'%';
names.forEach((n,i)=>$('root').add(opt(n,i)));
window.onbeforeunload=e=>{if(dirty&&tracks.length){e.preventDefault();e.returnValue='';}};
window.addEventListener('keydown',e=>{
  if(busy||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  if(e.target.closest('#toolPalette,[role=slider],button,summary'))return;
  if(e.code==='Space'){e.preventDefault();run(play);}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?history(redoStack,undoStack):history(undoStack,redoStack);}
});
