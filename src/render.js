function timeMap(notes,duration) {
  const points=[];
  function add(src,dst) {
    if(points.length && src<=points.at(-1)[0]+.00001)return;
    points.push([src,Math.max(points.length?points.at(-1)[1]+.000001:0,dst)]);
  }
  for(const n of notes) {
    const start=n.s+n.offset, len=Math.max(.001,n.e-n.s+n.length);
    if(!points.length && n.s>.0001)add(0,0);
    add(n.s,start);
    add(n.s+(n.e-n.s)*.2,start+len*clamp(.2+n.attack,.04,.40));
    add((n.s+n.e)/2,start+len*clamp(.5+n.handle,.42,.85));
    add(n.e,start+len);
  }
  if(!points.length)add(0,0);
  add(duration,duration);
  return points;
}
function interpolateMap(map,value,axis) {
  const other=1-axis;
  if(value<=map[0][axis])return map[0][other]+value-map[0][axis];
  let lo=0,hi=map.length-1;
  if(value>=map[hi][axis])return map[hi][other]+value-map[hi][axis];
  while(hi-lo>1) {const mid=(lo+hi)>>1;if(map[mid][axis]<=value)lo=mid;else hi=mid;}
  const a=map[lo],b=map[hi],f=(value-a[axis])/(b[axis]-a[axis]);
  return a[other]+f*(b[other]-a[other]);
}
function pitchMarks(mono,rate,frames) {
  // A one-frame octave error should not double or halve the grain clock.
  const pitches=frames.map((f,i)=>{
    const before=frames[i-1]?.p,after=frames[i+1]?.p;
    if(f.p&&before&&after&&Math.abs(before-after)<1&&Math.abs(f.p-before)>7)return (before+after)/2;
    return f.p;
  });
  const positions=[],pitchAt=x=>pitches[clamp(Math.floor(x/rate/HOP),0,pitches.length-1)];
  let cursor=0;
  while(cursor<mono.length) {
    const pitch=pitchAt(cursor),period=rate/(pitch?midiHz(pitch):125);
    let best=Math.round(cursor);
    if(pitch) {
      const radius=Math.round(period*.25);
      const previous=positions.at(-1),track=previous!==undefined&&pitchAt(previous);
      const half=Math.max(3,Math.round(period*.32)),step=Math.max(1,Math.floor(half/8));
      let peak=-Infinity;
      for(let k=Math.max(0,best-radius,(previous??-1)+1);k<Math.min(mono.length,cursor+radius);k++) {
        let score=mono[k];
        if(track){
          let dot=0,energy=0,ref=0;
          for(let j=-half;j<=half;j+=step){
            const a=mono[previous+j]||0,b=mono[k+j]||0;
            dot+=a*b;energy+=b*b;ref+=a*a;
          }
          score=dot/Math.sqrt(ref*energy+1e-18)-.08*((k-cursor)/radius)**2;
        }
        if(score>peak){peak=score;best=k;}
      }
    }
    if(best>=mono.length)break;
    positions.push(best);
    cursor=best+Math.max(5,period);
  }
  return positions;
}
function edited(n) {
  return Math.abs(n.pitch)+Math.abs(n.offset)+Math.abs(n.length)+Math.abs(n.mod-1)+Math.abs(n.drift-1)+
    Math.abs(n.formant)+Math.abs(n.gain)+Math.abs(n.sibilant)+n.fadeIn+n.fadeOut+Math.abs(n.attack)+Math.abs(n.handle)+Math.abs(n.transition)>1e-7;
}
function slowContour(frames) {
  return frames.map((f,i)=>{
    let sum=0,count=0;
    for(let j=Math.max(0,i-9);j<=Math.min(frames.length-1,i+9);j++) {
      if(Math.abs(frames[j].p-f.p)<2.2 && frames[j].p) {sum+=frames[j].p;count++;}
    }
    return count?sum/count:f.p;
  });
}

function connectedNotes(n,next){
  return !!next&&!n.hard&&next.s-n.e<.06&&next.s+next.offset-(n.e+n.offset+n.length)<.06;
}
function pitchAdjustment(n,next,pitch,slowPitch,sec,previous) {
  const fraction=clamp((sec-n.s)/(n.e-n.s),0,1);
  const linkedBefore=previous&&connectedNotes(previous,n)&&Math.abs(n.s-previous.e)<HOP/2;
  const linkedAfter=connectedNotes(n,next)&&Math.abs(next.s-n.e)<HOP/2;
  const start=clamp((sec-n.s)/.012,0,1),end=clamp((n.e-sec)/.012,0,1);
  const edge=n.hard?1:Math.min(linkedBefore?1:start,linkedAfter?1:end);
  let center=n.pitch;
  if(linkedBefore)center+=(previous.pitch-n.pitch)*(1-start)*.5;
  if(linkedAfter)center+=(next.pitch-n.pitch)*(1-end)*.5;
  let shift=edge*(center+(n.drift-1)*(slowPitch-n.p)+(n.mod-1)*(pitch-slowPitch));
  if(n.transition && connectedNotes(n,next))
    shift+=n.transition*(next.p+next.pitch-n.p-n.pitch)*clamp((fraction-.72)/.28,0,1);
  return shift;
}

// Measure whether adjacent vocal cycles actually repeat. A pitch estimate alone
// can persist across a breath, a consonant or a brief tracking error.
function periodicityWeights(samples,marks){
  const weights=new Float32Array(marks.length);
  for(let i=0;i+2<marks.length;i++){
    const a=marks[i],b=marks[i+1],c=marks[i+2];
    let dot=0,aa=0,bb=0;
    for(let j=0;j<32;j++){
      const x=samples[a+Math.floor(j*(b-a)/32)],y=samples[b+Math.floor(j*(c-b)/32)];
      dot+=x*y;aa+=x*x;bb+=y*y;
    }
    const correlation=dot/Math.sqrt(aa*bb+1e-18);
    const w=clamp((correlation-.60)/.30,0,1);
    weights[i]=w*w*(3-2*w);
  }
  return weights;
}

// For pitch-only edits, fit the synthesis cycles between two actual source
// marks. Both ends then meet the dry signal at the same waveform phase.
function renderPitchOnly(channels,rate,frames,notes,marks){
  const out=channels.map(ch=>ch.slice()),slow=slowContour(frames);
  const cycles=new Float64Array(marks.length);
  const voiced=periodicityWeights(vocalChannel(channels),marks);
  let noteIndex=0;
  for(let i=0;i+1<marks.length;i++){
    const t=(marks[i]+marks[i+1])/(2*rate);
    while(noteIndex+1<notes.length&&notes[noteIndex].e<t)noteIndex++;
    const n=notes[noteIndex],k=clamp(Math.round(t/HOP),0,frames.length-1),f=frames[k];
    const shift=f.p&&t>=n.s&&t<=n.e?pitchAdjustment(n,notes[noteIndex+1],f.p,slow[k],t,notes[noteIndex-1]):0;
    cycles[i]=2**(shift*voiced[i]/12);
  }
  let first=0;
  while(first+1<marks.length){
    if(Math.abs(cycles[first]-1)<1e-7){first++;continue;}
    let end=first,total=0;
    while(end+1<marks.length&&Math.abs(cycles[end]-1)>=1e-7)total+=cycles[end++];
    const count=Math.max(1,Math.round(total)),left=marks[first],right=marks[end];
    if(count!==end-first||end-first>2){
      const weights=new Float32Array(right-left);
      const sums=channels.map(()=>new Float32Array(right-left));
      let source=first,accum=0;
      for(let k=0;k<=count;k++){
        const targetPhase=k*total/count;
        while(source+1<end&&accum+cycles[source]<targetPhase){accum+=cycles[source++];}
        const u=clamp((targetPhase-accum)/cycles[source],0,1);
        const target=marks[source]+u*(marks[source+1]-marks[source]);
        const period=marks[source+1]-marks[source];
        const blend=u*u*(3-2*u);
        const radius=Math.max(period,period*total/(count*cycles[source]))*1.25;
        for(let j=Math.max(left,Math.ceil(target-radius));j<Math.min(right,target+radius);j++){
          const d=j-target,position=clamp(marks[source]+d,0,out[0].length-1);
          const other=clamp(marks[source+1]+d,0,out[0].length-1);
          const c=Math.floor(other),e=Math.min(c+1,out[0].length-1);
          const a=Math.floor(position),b=Math.min(a+1,out[0].length-1),mix=position-a;
          const weight=.5+.5*Math.cos(Math.PI*d/radius);
          weights[j-left]+=weight;
          for(let ch=0;ch<out.length;ch++){
            const input=channels[ch];
            const early=input[a]+mix*(input[b]-input[a]);
            const late=input[c]+(other-c)*(input[e]-input[c]);
            sums[ch][j-left]+=weight*(early+blend*(late-early));
          }
        }
      }
      for(let j=left;j<right;j++){
        const w=weights[j-left];
        if(w>0)for(let ch=0;ch<out.length;ch++)out[ch][j]=sums[ch][j-left]/w;
      }
    }
    first=end;
  }
  return out;
}

function renderTrack(channels,rate,frames,notes) {
  if(!notes.some(edited))return channels;
  const duration=channels[0].length/rate, map=timeMap(notes,duration);
  const mono=vocalChannel(channels), marks=pitchMarks(mono,rate,frames), size=mono.length;
  if(notes.every(n=>!n.offset&&!n.length&&!n.handle&&!n.attack&&!n.formant&&!n.sibilant&&!n.gain&&!n.fadeIn&&!n.fadeOut))
    return renderPitchOnly(channels,rate,frames,notes,marks);
  const out=channels.map(()=>new Float32Array(size)), weight=new Float32Array(size);
  const gains=new Float32Array(size), dry=new Float32Array(size);
  const params=notes.map((n,i)=>{
    const [left,right]=noteBounds(notes,i,duration);
    return {n,left:Math.max(left,n.s-.055),right:Math.min(right,n.e+.075),
      needPitch:Math.abs(n.pitch)+Math.abs(1-n.mod)+Math.abs(1-n.drift)+Math.abs(n.formant)+Math.abs(n.transition)>1e-6};
  });
  const slow=slowContour(frames),reliability=periodicityWeights(mono,marks);
  let target=marks[0]||0,idx=0,phase=0,markInterval=0;
  while(target<size+rate*.02) {
    const time=target/rate, src=interpolateMap(map,time,1), source=src*rate;
    while(idx+1<params.length && src>params[idx].right)idx++;
    const param=params[idx], n=param.n, active=src>=param.left && src<=param.right;
    const k=clamp(Math.round(src/HOP),0,frames.length-1),f=frames[k];
    const voiced=f.p && src>=n.s && src<=n.e;

    // Advance through measured source cycles. At unity shift this clock
    // lands on the next actual analysis mark instead of accumulating phase error.
    while(markInterval+1<marks.length-1&&marks[markInterval+1]<=source)markInterval++;
    const period=marks[markInterval+1]-marks[markInterval]||rate/(f.p?midiHz(f.p):125);
    const shift=active&&voiced?reliability[markInterval]*pitchAdjustment(n,notes[idx+1],f.p,slow[k],src,notes[idx-1]):0;
    const cycles=2**(-shift/12);
    const fraction=(source-marks[markInterval])/period+cycles;
    const cycleIndex=clamp(markInterval+Math.floor(fraction),0,Math.max(0,marks.length-2));
    const nextPeriod=marks[cycleIndex+1]-marks[cycleIndex]||period;
    const nextSource=(marks[cycleIndex]??0)+(fraction+markInterval-cycleIndex)*nextPeriod;
    const hop=clamp(nextSource-source,rate/1800,rate/60);
    while(phase+1<marks.length && Math.abs(marks[phase+1]-source)<Math.abs(marks[phase]-source))phase++;
    const center=marks[phase]||0, formRatio=active&&voiced?2**(n.formant/12):1;
    const radius=Math.ceil(Math.max(hop,period/formRatio)*1.25);
    const left=Math.max(0,Math.ceil(target-radius)),right=Math.min(size,Math.ceil(target+radius));
    const moving=Math.abs(time-src)>.00003, process=moving || (active && voiced && param.needPitch && (Math.abs(shift)>.0001 || Math.abs(n.formant)>.0001));
    // Preserve the original samples through untouched passages, including consonants.
    const useDry=process?0:1;
    const distance=Math.max(0,n.s-src,src-n.e);
    const blend=active?clamp(1-distance/.035,0,1):0;
    const ess=f.p?0:clamp((f.h-.15)*2,0,1);
    let gain=10**((n.gain+n.sibilant*ess)*blend/20);
    if(active && src>=n.s && src<=n.e) {
      if(n.fadeIn)gain*=clamp((src-n.s)/n.fadeIn,0,1);
      if(n.fadeOut)gain*=clamp((n.e-src)/n.fadeOut,0,1);
    }
    for(let j=left;j<right;j++) {
      const off=j-target, w=.5+.5*Math.cos(Math.PI*off/radius);
      weight[j]+=w; gains[j]+=w*gain; dry[j]+=w*useDry;
      if(!process)continue;
      const pos=center+off*formRatio, a=Math.floor(pos),frac=pos-a;
      if(a<0 || a+1>=size || source<0 || source>=size)continue;
      for(let ch=0;ch<out.length;ch++) out[ch][j]+=w*((1-frac)*channels[ch][a]+frac*channels[ch][a+1]);
    }
    target+=hop;
  }
  for(let i=0;i<size;i++) {
    const w=weight[i]||1;
    for(let ch=0;ch<out.length;ch++)out[ch][i]=(out[ch][i]+channels[ch][i]*dry[i])/w*gains[i]/w;
  }
  return out;
}
