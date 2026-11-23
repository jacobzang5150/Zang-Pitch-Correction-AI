// Run from the repository root with node tests/audio.cjs.
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const engine=['boundary-model','analysis','render','files'].map(f=>fs.readFileSync('src/'+f+'.js','utf8')).join('\n');
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
  const silence=analyze(new Float32Array(24000),rate);assert.equal(silence.notes.length,0);
  const beat=analyze(original,rate);quantize(beat.notes,2,120,8,.6);assert.ok(beat.notes[0].offset<0);
  for(const n of target.notes)assert.ok(n.e+n.offset+n.length>n.s+n.offset);
  console.log('PASS: note detection, untouched audio, measured pitch correction, aligned onset, preserved harmony, repeatability, stereo WAV and project round-trip, silence, grid correction.');
})().catch(e=>{console.error(e);process.exitCode=1;});`,{console,assert,Blob,TextEncoder,TextDecoder,structuredClone,process});
