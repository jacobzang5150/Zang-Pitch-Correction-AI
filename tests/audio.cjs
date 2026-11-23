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
