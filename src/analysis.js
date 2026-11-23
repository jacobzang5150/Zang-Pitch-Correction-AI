const HOP = .01;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const midiHz = m => 440 * 2 ** ((m - 69) / 12);
const mean = a => a.reduce((s,n)=>s+n,0) / Math.max(1,a.length);
function median(a) {
  if (!a.length) return 0;
  const sorted = [...a].sort((x,y)=>x-y);
  return (sorted[Math.floor((a.length-1)/2)] + sorted[Math.ceil((a.length-1)/2)])*.5;
}
function spread(a) {
  const m=mean(a);
  return Math.sqrt(mean(a.map(v=>(v-m)**2)));
}
function estimatePitch(signal, start, rate) {
  const n=Math.round(rate*.026), maxLag=Math.ceil(rate/64);
  const curve=new Float64Array(maxLag+1);
  let sum=0;
  for (let lag=1;lag<=maxLag;lag++) {
    let diff=0;
    for(let i=0;i<n;i+=2) {
      const d=signal[start+i]-signal[start+i+lag]; diff+=d*d;
    }
    sum+=diff;
    curve[lag]=sum>1e-10 ? diff*lag/sum : 1;
  }
  let best=0;
  for(let lag=Math.max(2, Math.floor(rate/1100));lag<maxLag;lag++) {
    if(curve[lag] < .17 && curve[lag]<=curve[lag+1] && curve[lag]<=curve[lag-1]) { best=lag; break; }
    if(!best || curve[lag]<curve[best]) best=lag;
  }
  if(!best || curve[best]>.27) return [0,0];
  const lo=curve[best-1], center=curve[best], hi=curve[best+1];
  const correction=clamp(.5*(lo-hi)/(lo+hi-2*center || 1),-.5,.5);
  return [69+12*Math.log2(rate/(best+correction)/440),1-center];
}
function vocalChannel(channels){
  if(channels.length===1)return channels[0];
  // Pick a recorded channel without cancelling a phase-inverted stereo stem.
  const energy=channels.map(channel=>{
    let sum=0;
    for(let i=0;i<channel.length;i+=17)sum+=channel[i]*channel[i];
    return sum;
  });
  return channels[energy.indexOf(Math.max(...energy))];
}
function analyze(samples, rate, detectPitch=true) {
  const stride=Math.max(1,Math.round(rate/8000)), sr=rate/stride, pad=Math.ceil(sr*.023);
  const low=new Float32Array(Math.ceil(samples.length/stride)+2*pad+8);
  for(let i=0;i<samples.length;i++) low[pad+Math.floor(i/stride)]+=samples[i]/stride;
  const count=Math.max(1,Math.ceil(samples.length/rate/HOP));
  const frames=[];
  for(let k=0;k<count;k++) {
    const p=Math.floor(k*rate*HOP), end=Math.min(samples.length,p+Math.ceil(rate*HOP));
    let energy=0, high=0;
    for(let i=p;i<end;i++) {
      energy+=samples[i]**2;
      high+=(samples[i]-(samples[i-1]||0))**2;
    }
    const rms=Math.sqrt(energy/Math.max(1,end-p));
    const [pitch,conf]=detectPitch && rms>.001 ? estimatePitch(low,Math.round(k*sr*HOP),sr):[0,0];
    frames.push({p:pitch,c:conf,e:rms,h:Math.sqrt(high/(energy+1e-9))});
  }
  // A short dropout inside a stable voiced span should not split a sustained note.
  for(let i=1;i<frames.length-1;i++) {
    if(!frames[i].p && frames[i-1].p && Math.abs(frames[i-1].p-frames[i+1].p)<.7) frames[i].p=(frames[i-1].p+frames[i+1].p)/2;
  }
  return {frames,notes:segment(frames,samples.length/rate)};
}
function defaultNote(start,end,pitch,confidence) {
  return {s:start,e:end,p:pitch,confidence,pitch:0,drift:1,mod:1,formant:0,
    gain:0,sibilant:0,fadeIn:0,fadeOut:0,offset:0,length:0,handle:0,attack:0,
    transition:0,hard:false};
}
function boundaryScore(frames,i) {
  const slice=frames.slice(i-6,i+7), left=slice.slice(0,5).map(f=>f.p), right=slice.slice(-5).map(f=>f.p);
  const energy=slice.map(f=>f.e);
  const dip=clamp(1-Math.min(...energy.slice(4,9))/Math.max(.0001,(mean(energy.slice(0,4))+mean(energy.slice(-4)))/2),0,1);
  const x=[Math.abs(median(right)-median(left)),dip,
    Math.abs(mean(slice.slice(7,9).map(f=>f.p))-mean(slice.slice(4,6).map(f=>f.p))),spread(left)+spread(right)];
  return x.reduce((v,x,j)=>v+x*BOUNDARY_MODEL.weights[j],BOUNDARY_MODEL.bias);
}
function segment(frames,duration) {
  const notes=[];
  function addRun(first,end){
    if(end-first<5)return;
    const framesInRun=frames.slice(first,end);
    const contour=framesInRun.map((f,i)=>median(framesInRun.slice(Math.max(0,i-2),i+3).map(v=>v.p)));
    // Compare sustained pitch centers. Vibrato and brief overshoots should not
    // turn into a chain of short notes.
    const plateaus=[];
    let anchor=null;
    for(let i=0;i+8<=contour.length;i++){
      const window=contour.slice(i,i+8),center=median(window);
      if(Math.max(...window)-Math.min(...window)>.86)continue;
      if(!anchor||Math.abs(center-anchor.pitch)>.72){
        if(anchor&&i<anchor.end)continue;
        anchor={start:i,end:i+8,pitch:center};plateaus.push(anchor);
      }else anchor.end=i+8;
    }
    const cuts=[0];
    const landing=plateaus[0];
    let scoop=false;
    if(landing&&landing.start>=6&&landing.start<=35){
      const origin=median(contour.slice(0,3)),distance=landing.pitch-origin;
      const progress=contour.slice(0,landing.start+1).map(p=>(p-origin)*Math.sign(distance));
      const backwards=progress.slice(1).reduce((sum,v,i)=>sum+Math.max(0,progress[i]-v),0);
      if(Math.abs(distance)>1.15&&backwards<Math.abs(distance)*.35){
        cuts.push(landing.start);scoop=true;
      }
    }
    for(let i=1;i<plateaus.length;i++){
      const left=plateaus[i-1],right=plateaus[i],middle=(left.pitch+right.pitch)/2;
      let cut=left.end;
      while(cut<right.start&&(contour[cut]-middle)*(right.pitch-left.pitch)<0)cut++;
      if(cut-cuts.at(-1)>=5)cuts.push(cut);
    }
    // Retain a same-pitch rearticulation when there is an actual energy dip.
    for(let i=7;i+7<contour.length;i++){
      const energy=frames[first+i].e;
      if(energy>.55*Math.min(frames[first+i-4].e,frames[first+i+4].e))continue;
      if(boundaryScore(frames,first+i)>1.8&&cuts.every(c=>Math.abs(c-i)>=7))cuts.push(i);
    }
    cuts.sort((a,b)=>a-b);cuts.push(contour.length);
    for(let i=0;i+1<cuts.length;i++){
      const a=cuts[i],b=cuts[i+1],span=framesInRun.slice(a,b);
      const settled=contour.slice(a,b).filter((_,j)=>j>=Math.floor((b-a)*.15)&&j<(b-a)*.9);
      const n=defaultNote((first+a)*HOP,Math.min(duration,(first+b)*HOP),median(settled),mean(span.map(f=>f.c)));
      n.contourVersion=2;
      if(scoop&&i===0)n.scoop=true;
      notes.push(n);
    }
  }
  let i=0;
  while(i<frames.length){
    if(!frames[i].p){i++;continue;}
    const first=i;
    while(i<frames.length&&frames[i].p)i++;
    addRun(first,i);
  }
  return notes;
}
function tuneNotes(notes,root,mode,strength,guide=null) {
  const modes={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],chromatic:[0,1,2,3,4,5,6,7,8,9,10,11]};
  const allowed=modes[mode]||modes.chromatic;
  // Dynamic programming balances measured pitch and melodic movement across adjacent notes.
  const states=notes.map(n=>{
    const targets=[];
    const chord=guide?harmonyForNote(guide,n):null;
    const tones=guide&&!chord?backingTonesForNote(guide,n):null;
    if(n.pitchLocked || (guide && ((!chord&&!tones)||n.confidence<.65))) {
      if(!n.pitchLocked)n.pitchReview={reason:'Review by ear'};
      return [{p:n.p+n.pitch,cost:0,prev:0,hold:true}];
    }
    for(let p=Math.floor(n.p)-2;p<=Math.ceil(n.p)+2;p++) {
      const inScale=allowed.includes(((p-root)%12+12)%12);
      const inChord=chord?.tones.includes((p+120)%12);
      // Keep a clearly sung extension or passing note eligible, including borrowed tones.
      const distance=Math.abs(p-n.p);
      if(guide ? distance<=1.05 : inScale) {
        const harmonicCost=chord ? (inChord?0:.58*chord.confidence)+(inScale||inChord?0:.55*chord.confidence) : tones ? .55*(1-tones[(p+120)%12])+(inScale?0:.035) : 0;
        targets.push({p,cost:0,prev:0,harmonicCost,chord});
      }
    }
    return targets;
  });
  for(let i=0;i<states.length;i++) for(const s of states[i]) {
    const local=(s.p-notes[i].p)**2+(s.harmonicCost||0);
    s.cost=local;
    if(!i) continue;
    const choices=states[i-1].map(t=>t.cost+.16*Math.abs((s.p-t.p)-(notes[i].p-notes[i-1].p)));
    const min=Math.min(...choices);
    s.cost+=min;s.prev=choices.indexOf(min);
  }
  if(!notes.length)return;
  let last=states.at(-1),j=last.indexOf(last.reduce((a,b)=>a.cost<b.cost?a:b));
  for(let i=notes.length-1;i>=0;i--) {
    const s=states[i][j],n=notes[i];
    if(!s.hold) {
      const delta=s.p-n.p;
      n.pitch=guide&&Math.abs(delta)<.08?0:delta*strength;
      if(guide)n.pitchReview=s.chord?{root:s.chord.root,suffix:s.chord.suffix,target:s.p}:{source:'backing tones',target:s.p};
      else {delete n.pitchReview;delete n.pitchLocked;}
    }
    if(n.scoop&&!n.pitchLocked&&!notes[i+1]?.pitchReview?.reason&&notes[i+1]&&Math.abs(n.e-notes[i+1].s)<.001){
      n.pitch=notes[i+1].pitch;
      n.pitchReview={reason:'Scoop follows landing'};
    }
    j=s.prev;
  }
}
function noteBounds(notes,i,duration) {
  const n=notes[i];
  return [i?(notes[i-1].e+n.s)/2:0,i+1<notes.length?(n.e+notes[i+1].s)/2:duration];
}
function applyTiming(notes,duration,changes) {
  // Fit neighboring suggestions together even when a user-edited note crosses its neighbor.
  let last=0;
  for(let i=0;i<notes.length;i++) {
    const n=notes[i], [s,e]=changes(n,i);
    const remaining=2*(notes.length-i-1)*.001;
    const start=clamp(s,last,Math.max(last,duration-remaining-.002));
    const end=clamp(e,start+.001,Math.max(start+.001,duration-remaining));
    n.offset=start-n.s;n.length=(end-start)-(n.e-n.s);last=end;
  }
}
function correctDrift(note,frames,slow,strength){
  if(note.driftLocked||note.scoop||note.hard||note.confidence<.78||note.e-note.s<.32)return false;
  if(note.drift!==1&&note.drift!==note.autoDrift)return false;
  const values=[];
  const length=note.e-note.s;
  for(let i=Math.ceil((note.s+.12*length)/HOP);i*HOP<note.e-.12*length;i++){
    if(frames[i]?.p&&frames[i].c>.75)values.push(slow[i]);
  }
  if(values.length<.55*length/HOP)return false;
  const third=Math.floor(values.length/3);
  const a=median(values.slice(0,third)),b=median(values.slice(third,-third)),c=median(values.slice(-third));
  const drift=Math.abs(c-a);
  if(drift<.20||drift>1.4||(c-b)*(b-a)<=0)return false;
  const target=1-strength*clamp((drift-.12)/drift,0,.75);
  const changed=Math.abs(target-note.drift)>.0001;
  note.autoDrift=note.drift=target;
  return changed;
}

// Use the front edge of distinct backing attacks as possible timing anchors.
function backingAttacks(frames){
  const attacks=[];
  for(let i=2;i+2<frames.length;i++){
    const low=(frames[i-2].e+frames[i-1].e)/2,high=(frames[i].e+frames[i+1].e)/2;
    if(high<.004||high<low*1.42||high-low<.002)continue;
    attacks.push(i*HOP);i+=5;
  }
  return attacks;
}
function correctOnsets(notes,duration,attacks,grid,strength){
  const phrases=[];
  for(let i=0;i<notes.length;){
    const start=i++;
    while(i<notes.length&&notes[i].s-notes[i-1].e<.035)i++;
    const onset=notes[start].s;
    let anchor=null;
    if(attacks){
      let lo=0,hi=attacks.length;
      while(lo<hi){const mid=(lo+hi)>>1;if(attacks[mid]<onset)lo=mid+1;else hi=mid;}
      const near=attacks.slice(Math.max(0,lo-1),lo+1).filter(t=>Math.abs(t-onset)<=.095);
      if(near.length===1)anchor=near[0];
    }else if(grid>0)anchor=Math.round(onset/grid)*grid;
    phrases.push({start,end:i,onset,error:anchor===null?null:onset-anchor});
  }
  let changed=0;
  for(let i=0;i<phrases.length;i++){
    const group=phrases[i],{start,end,onset,error}=group;
    if(error===null)continue;
    // Learn the singer's local placement from other onsets in the phrase.
    const neighbors=phrases.slice(Math.max(0,i-5),i+6).filter(g=>g!==group&&Math.abs(g.onset-onset)<=8&&g.error!==null);
    if(neighbors.length<3)continue;
    const pocket=median(neighbors.map(g=>g.error));
    if(neighbors.filter(g=>Math.abs(g.error-pocket)<=.022).length<Math.ceil(neighbors.length*.70))continue;
    const miss=pocket-error;
    if(Math.abs(miss)<.032||Math.abs(miss)>.095)continue;
    const members=notes.slice(start,end);
    if(members.some(n=>n.timingLocked||n.length||n.handle||n.attack||(n.offset&&n.offset!==n.autoOffset)))continue;
    const prev=notes[start-1],next=notes[end],last=members.at(-1);
    const left=prev?prev.e+prev.offset+prev.length+.002:0,right=next?next.s+next.offset-.002:duration;
    const offset=clamp(clamp(miss,-.065,.065)*strength,left-onset,right-last.e);
    for(const n of members){
      if(Math.abs(n.offset-offset)>.0001)changed++;
      n.autoOffset=n.offset=offset;
    }
  }
  return changed;
}

function quantize(notes,duration,bpm,division,strength) {
  const step=60/bpm*4/division;
  applyTiming(notes,duration,n=>{
    const d=(Math.round(n.s/step)*step-n.s)*strength;
    return [n.s+d,n.e+d];
  });
}
function alignedTargets(guide,target) {
  // Banded dynamic time warping of loudness, spectral tilt and voicing.
  // Work at 20 ms resolution; normalized features tolerate harmony pitch differences.
  const describe=frames=>{
    const take=frames.filter((_,i)=>i%2===0);
    const peak=Math.max(.001,...Array.from({length:Math.ceil(take.length/4096)},(_,i)=>Math.max(...take.slice(i*4096,(i+1)*4096).map(f=>f.e))));
    return take.map((f,i)=>{
      const env=x=>clamp(Math.log1p(x/peak*100)/4.62,0,1);
      return [env(f.e),clamp(f.h,0,1.4),f.p?1:0,env(f.e)-env((take[i-1]||f).e)];
    });
  };
  const a=describe(target),b=describe(guide), band=35, width=2*band+1;
  const path=new Int8Array(a.length*width);
  let prev=new Float64Array(width).fill(Infinity);
  for(let i=0;i<a.length;i++) {
    const row=new Float64Array(width).fill(Infinity);
    for(let d=0;d<width;d++) {
      const j=i+d-band;
      if(j<0||j>=b.length)continue;
      const cost=Math.abs(a[i][0]-b[j][0])+ .65*Math.abs(a[i][1]-b[j][1])+.3*Math.abs(a[i][2]-b[j][2])+1.8*Math.abs(a[i][3]-b[j][3])+.0009*Math.abs(d-band);
      const diag=i||j?prev[d]:0,up=(prev[d+1]??Infinity)+.075,left=(row[d-1]??Infinity)+.075;
      const best=Math.min(diag,up,left);
      row[d]=cost+best; path[i*width+d]=best===diag?0:best===up?1:2;
    }
    prev=row;
    if(i>=b.length+band-1)break;
  }
  const end=Math.min(a.length,b.length)-1;
  // Only compare shared timeline; unmatched tails retain their original timing.
  if(a.length!==b.length) return alignedTargets(guide.slice(0,(end+1)*2-1),target.slice(0,(end+1)*2-1));
  const mapping=new Float64Array(a.length);
  let i=end,j=end;
  while(i>=0 && j>=0) {
    const v=path[i*width+(j-i+band)];
    mapping[i]=j*.02;
    if(v!==2)i--;
    if(v!==1)j--;
  }
  return mapping;
}
function align(guideTrack,target,duration,strength) {
  const map=alignedTargets(guideTrack.frames,target.frames);
  const guideWarp=timeMap(guideTrack.notes,guideTrack.frames.length*HOP);
  function dest(sec) {
    const i=Math.round(sec/.02);
    if(i>=map.length)return sec;
    const mapped=interpolateMap(guideWarp,map[i],0);
    return sec+strength*clamp(mapped-sec,-.7,.7);
  }
  applyTiming(target.notes,duration,n=>[dest(n.s),dest(n.e)]);
}
