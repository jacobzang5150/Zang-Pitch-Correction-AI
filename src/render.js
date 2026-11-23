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
  const positions=[], frameAt=x=>frames[Math.min(frames.length-1,Math.max(0,Math.floor(x/rate/HOP)))];
  let cursor=0;
  while(cursor<mono.length) {
    const f=frameAt(cursor), period=rate/(f.p?midiHz(f.p):125);
    let best=Math.round(cursor);
    if(f.p) {
      const radius=Math.round(period*.25);
      let peak=-Infinity;
      for(let k=Math.max(0,best-radius,(positions.at(-1)??-1)+1);k<Math.min(mono.length,cursor+radius);k++) {
        if(mono[k]>peak){peak=mono[k];best=k;}
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
function pitchAdjustment(n,next,pitch,slowPitch,sec) {
  const fraction=clamp((sec-n.s)/(n.e-n.s),0,1);
  const edge=n.hard?1:clamp(Math.min(sec-n.s,n.e-sec)/.012,0,1);
  let shift=edge*(n.pitch+(n.drift-1)*(slowPitch-n.p)+(n.mod-1)*(pitch-slowPitch));
  if(n.transition && connectedNotes(n,next))
    shift+=n.transition*(next.p+next.pitch-n.p-n.pitch)*clamp((fraction-.72)/.28,0,1);
  return shift;
}

function renderTrack(channels,rate,frames,notes) {
  if(!notes.some(edited))return channels;
  const duration=channels[0].length/rate, map=timeMap(notes,duration);
  const mono=vocalChannel(channels), marks=pitchMarks(mono,rate,frames), size=mono.length;
  const out=channels.map(()=>new Float32Array(size)), weight=new Float32Array(size);
  const gains=new Float32Array(size), dry=new Float32Array(size);
  const params=notes.map((n,i)=>{
    const [left,right]=noteBounds(notes,i,duration);
    return {n,left:Math.max(left,n.s-.055),right:Math.min(right,n.e+.075),
      needPitch:Math.abs(n.pitch)+Math.abs(1-n.mod)+Math.abs(1-n.drift)+Math.abs(n.formant)+Math.abs(n.transition)>1e-6};
  });
  const slow=slowContour(frames);
  let target=0, idx=0, phase=0;
  while(target<size+rate*.02) {
    const time=target/rate, src=interpolateMap(map,time,1), source=src*rate;
    while(idx+1<params.length && src>params[idx].right)idx++;
    const param=params[idx], n=param.n, active=src>=param.left && src<=param.right;
    const k=clamp(Math.round(src/HOP),0,frames.length-1),f=frames[k];
    const voiced=f.p && src>=n.s && src<=n.e;
    const shift=active && voiced ? pitchAdjustment(n,notes[idx+1],f.p,slow[k],src):0;
    const period=rate/(f.p?midiHz(f.p):125);
    const hop=clamp(period/2**(shift/12),rate/1800,rate/60);
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
