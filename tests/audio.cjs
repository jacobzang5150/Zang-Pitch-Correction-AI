// Run from the repository root with node tests/audio.cjs.
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const engine=['boundary-model','analysis','harmony','render','files'].map(f=>fs.readFileSync('src/'+f+'.js','utf8')).join('\n');
vm.runInNewContext(engine+`(async()=>{
  const rate=24000,make=(midi,offset=.35)=>{
    const audio=new Float32Array(rate*2);
    for(const [start,duration] of [[offset,.4],[offset+.75,.48]]) {
      for(let j=0;j<duration*rate;j++){
        const phase=2*Math.PI*midiHz(midi)*j/rate;
        audio[Math.floor(start*rate)+j]=(.5*Math.sin(phase)+.15*Math.sin(phase*2))*Math.min(1,j/(rate*.012),(duration*rate-j)/(rate*.015));
      }
    }
    return audio;
  };
  let phase=0;
  const sung=Float32Array.from({length:rate},(_,i)=>{
    const t=i/rate,p=t<.16?57.3+3*t/.16:t<.50?60.3:t<.72?62.3:64.3;
    phase+=2*Math.PI*midiHz(p+.15*Math.sin(30*t))/rate;
    return .4*Math.sin(phase);
  });
  const run=analyze(sung,rate);
  assert.equal(run.notes.length,4);assert.ok(run.notes[0].scoop);
  const band=backingHarmony([Float32Array.from({length:rate},(_,i)=>
    [48,52,55].reduce((sum,p)=>sum+.18*Math.sin(2*Math.PI*midiHz(p)*i/rate),0))],rate);
  tuneNotes(run.notes,0,'major',1,band);
  assert.deepEqual(run.notes.slice(1).map(n=>n.pitchReview.target),[60,62,64]);
  assert.equal(run.notes[0].pitch,run.notes[1].pitch);
  const playback=analyze(renderTrack([sung],rate,run.frames,run.notes)[0],rate).frames;
  for(const [i,p] of [[32,60],[61,62],[83,64]])assert.ok(Math.abs(playback[i].p-p)<.22);
  const wobble=Array.from({length:80},(_,i)=>({p:60+.32*Math.sin(i*.36)+(i===42?3:0),c:.97,e:.2}));
  assert.equal(segment(wobble,.8).length,1,'vibrato and a brief overshoot stay together');
  {

let phase=0;
const samples=Float32Array.from({length:rate*2},(_,i)=>{
 const t=i/rate;phase+=2*Math.PI*midiHz(60+.42*Math.sin(t*32)+.65*t)/rate;
 return .3*Math.sin(phase)+.23*Math.sin(phase*2+t*8)+.11*Math.sin(phase*3);
});
const frames=analyze(samples,rate).frames;
const notes=Array.from({length:8},(_,i)=>({...defaultNote(i/4,(i+1)/4,60,.99),pitch:.75}));
const out=renderTrack([samples],rate,frames,notes)[0];
const differences=[];for(let i=1200;i<out.length-1200;i+=120){
 let dry=0,wet=0;for(let j=i;j<i+240;j++){wet+=out[j]**2;dry+=samples[j]**2;}
 differences.push(Math.abs(10*Math.log10(wet/dry)));
}
    assert.ok(Math.max(...differences)<1.5,'Unexpected short level dip on a continuous edited vowel');
    const corrupted=frames.map(f=>({...f}));corrupted[37].p+=12;
    const cleanMarks=pitchMarks(samples,rate,frames),repaired=pitchMarks(samples,rate,corrupted);
    assert.ok(Math.abs(cleanMarks.length-repaired.length)<=1);
    assert.ok(Math.abs(pitchAdjustment(notes[1],notes[2],60,60,.25,notes[0])-.75)<.001);
  }
  // A continuous vowel moves back and forth between dry and pitch-corrected
  // blobs. Measure the exported samples across each edit, including at 96 kHz.
  for(const sampleRate of [44100,48000,96000]){
    let oscillator=0;
    const signal=Float32Array.from({length:sampleRate*2},(_,i)=>{
      const sec=i/sampleRate;
      oscillator+=2*Math.PI*midiHz(54+.28*Math.sin(31*sec))/sampleRate;
      return .42*Math.sin(oscillator)+.16*Math.sin(2*oscillator+.5)+.08*Math.sin(3*oscillator);
    });
    const edits=[.39,0,-.45,0,.08,0,.72,0].map((shift,i)=>({
      ...defaultNote(i/4,(i+1)/4,54,1),pitch:shift
    }));
    const analysis=analyze(signal,sampleRate);
    const rendered=renderTrack([signal],sampleRate,analysis.frames,edits);
    const exported=decodeWav(wavBytes(rendered,sampleRate).buffer).channels[0];
    const worst=[];
    for(const note of edits.slice(1)){
      let loss=0;
      for(let ms=-10;ms<=10;ms++){
        const start=Math.round((note.s+ms/1000)*sampleRate);
        let dry=0,wet=0;
        for(let j=start;j<start+Math.round(.010*sampleRate);j++){
          dry+=signal[j]**2;wet+=exported[j]**2;
        }
        loss=Math.max(loss,10*Math.log10(dry/wet));
      }
      worst.push(loss);
    }
    assert.ok(Math.max(...worst)<1,'Boundary dropout at '+sampleRate+' Hz: '+Math.max(...worst).toFixed(2)+' dB');
  }
  // A pitch detector can hold its last note into a noisy consonant.
  // The exporter must preserve the consonant even when those frames say voiced.
  {
    let noiseSeed=27;
    const testVowel=Float32Array.from({length:rate},(_,i)=>{
      if(i<rate*.4 || i>=rate*.6)return .4*Math.sin(2*Math.PI*220*i/rate);
      noiseSeed=(Math.imul(noiseSeed,1664525)+1013904223)>>>0;
      return .12*(2*noiseSeed/4294967296-1);
    });
    const held=Array.from({length:100},()=>({p:57,c:.99,e:.2,h:0}));
    const edit={...defaultNote(0,1,57,.99),pitch:.8};
    const result=renderTrack([testVowel],rate,held,[edit])[0];
    assert.deepEqual(result.slice(rate*.43,rate*.57),testVowel.slice(rate*.43,rate*.57));
    assert.ok(Math.abs(analyze(result,rate).frames[20].p-57.8)<.18);
  }
  const original=make(60.31), {frames,notes}=analyze(original,rate);
  assert.equal(notes.length,2);assert.ok(Math.abs(notes[0].p-60.31)<.09);
  assert.equal(renderTrack([original],rate,frames,notes)[0],original);
  tuneNotes(notes,0,'chromatic',1);
  const tuned=renderTrack([original],rate,frames,notes)[0];
  const re=analyze(tuned,rate);
  assert.ok(Math.abs(re.notes[0].p-60)<.1,'rendered pitch '+re.notes[0].p);
  const guide=analyze(make(65,.25),rate);
  const target=analyze(original,rate);
  align(guide,target,2,1);
  assert.ok(target.notes[0].offset<-.05 && target.notes[0].offset>-.14,'BGV offset '+target.notes[0].offset);
  const moved=analyze(renderTrack([original],rate,target.frames,target.notes)[0],rate);
  assert.ok(Math.abs(moved.notes[0].s-guide.notes[0].s)<.035);
  assert.ok(Math.abs(moved.notes[0].p-60.31)<.15);
  const alignedAgain=structuredClone(target.notes);
  align(guide,target,2,1);assert.equal(JSON.stringify(target.notes),JSON.stringify(alignedAgain));
  const wav=wavBytes([original,original],rate), decoded=decodeWav(wav.buffer);
  assert.equal(decoded.rate,rate);assert.equal(decoded.channels.length,2);assert.equal(decoded.channels[0].length,original.length);
  const track={name:'BGV',rate,notes,channels:[original],role:'vocal',tight:.8};
  const loaded=readProject(await projectBlob([track],{bpm:'117'}).arrayBuffer());
  assert.deepEqual(loaded.tracks[0].channels[0],original);assert.deepEqual(loaded.tracks[0].notes,notes);
  // Same detuned lead twice, over C major and A major (borrowed C-sharp in C major).
  const backing=Float32Array.from({length:rate*2},(_,i)=>{
    const chord=i<rate?[48,52,55]:[45,49,52];
    return chord.reduce((v,p)=>v+.16*Math.sin(2*Math.PI*midiHz(p)*i/rate),0);
  });
  const harmony=backingHarmony([backing,backing.map(x=>-x)],rate);
  assert.equal(harmony.frames[3].root,0);assert.equal(harmony.frames[11].root,9);
  const ambiguous=make(60.48),lead=analyze(ambiguous,rate);
  tuneNotes(lead.notes,0,'major',1,harmony);
  assert.deepEqual(lead.notes.map(n=>n.pitchReview.target),[60,61]);
  const result=analyze(renderTrack([ambiguous],rate,lead.frames,lead.notes)[0],rate);
  assert.ok(Math.abs(result.notes[0].p-60)<.1 && Math.abs(result.notes[1].p-61)<.1);
  const passing=defaultNote(.2,.55,62.06,.96);
  tuneNotes([passing],0,'major',1,harmony);assert.equal(passing.pitch,0);
  const muted=backingHarmony([new Float32Array(rate)],rate);
  assert.ok(muted.frames.every(c=>c===null));
  const unpitched=defaultNote(.2,.5,60.48,.3);
  tuneNotes([unpitched],0,'major',1,harmony);assert.equal(unpitched.pitchReview.reason,'Review by ear');
  const noise=new Float32Array(rate);let seed=123;
  for(let i=0;i<rate;i++){seed=(1664525*seed+1013904223)>>>0;noise[i]=.2*(seed/2147483648-1);}
  assert.ok(backingHarmony([noise],rate).frames.every(c=>c===null));
  const minor=Float32Array.from({length:rate},(_,i)=>[50,53,57].reduce((v,p)=>v+.1*Math.sin(2*Math.PI*midiHz(p)*i/rate),0));
  const minorChord=backingHarmony([minor],rate).frames[3];assert.equal(minorChord.root,2);assert.equal(minorChord.suffix,'m');
  const single=make(60);assert.ok(backingHarmony([single],rate).frames.every(c=>c===null));
  // With no identifiable triad, a two-note accompaniment still resolves a detuned vocal.
  const interval=Float32Array.from({length:rate*2},(_,i)=>{
    const tones=i<rate?[48,55]:[49,56];
    return tones.reduce((sum,p)=>sum+.22*Math.sin(2*Math.PI*midiHz(p)*i/rate),0);
  });
  const intervalGuide=backingHarmony([interval],rate);
  assert.ok(intervalGuide.frames.every(c=>c===null));
  const rightOnly=[new Float32Array(ambiguous.length),ambiguous];
  const intervalLead=analyze(vocalChannel(rightOnly),rate);
  tuneNotes(intervalLead.notes,0,'chromatic',1,intervalGuide);
  assert.deepEqual(intervalLead.notes.map(n=>n.pitchReview.target),[60,61]);
  const corrected=analyze(renderTrack(rightOnly,rate,intervalLead.frames,intervalLead.notes)[1],rate);
  assert.ok(Math.abs(corrected.notes[0].p-60)<.1 && Math.abs(corrected.notes[1].p-61)<.1);
  const phrase=Float32Array.from({length:rate},(_,i)=>.4*Math.sin(2*Math.PI*midiHz(i<rate/2?60:64)*i/rate));
  const legato=[defaultNote(0,.5,60,1),defaultNote(.5,1,64,1)];
  legato[0].transition=1;
  const curve=analyze(renderTrack([phrase],rate,analyze(phrase,rate).frames,legato)[0],rate).frames;
  assert.ok(curve[46].p>62 && curve[46].p<64 && Math.abs(curve[20].p-60)<.1,'Audible glide near boundary');
  legato[0].hard=true;assert.equal(pitchAdjustment(...legato,60,60,.48),0);
  const locked=lead.notes[0];locked.pitchLocked=true;locked.pitch=.19;
  tuneNotes(lead.notes,0,'major',1,harmony);assert.equal(locked.pitch,.19);
  const pastEnd=defaultNote(2.2,2.8,60.48,.95);
  tuneNotes([pastEnd],0,'major',1,harmony);assert.equal(pastEnd.pitch,0);
  console.log('PASS: backing-chord recognition, chord-dependent rendered lead pitches, passing notes, manual overrides, quiet and ambiguous references.');
  const silence=analyze(new Float32Array(24000),rate);assert.equal(silence.notes.length,0);
  const beat=analyze(original,rate);quantize(beat.notes,2,120,8,.6);assert.ok(beat.notes[0].offset<0);
  for(const n of target.notes)assert.ok(n.e+n.offset+n.length>n.s+n.offset);
  console.log('PASS: note detection, untouched audio, measured pitch correction, aligned onset, preserved harmony, repeatability, stereo WAV and project round-trip, silence, grid correction.');
})().catch(e=>{console.error(e);process.exitCode=1;});`,{console,assert,Blob,TextEncoder,TextDecoder,structuredClone,process});
