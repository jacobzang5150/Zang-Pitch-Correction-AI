// Local chord recognition. Analyze spectral peaks in each stereo channel before
// combining pitch classes so panned or phase-inverted instruments remain audible.
const CHORD_HOP = .125;
const chordShapes = [
  {suffix:'', tones:[0,4,7]}, {suffix:'m', tones:[0,3,7]},
  {suffix:'dim', tones:[0,3,6]}
];

function magnitudeSpectrum(signal, offset, window, real, imag, magnitude) {
  const n=window.length;
  for(let i=0,j=0;i<n;i++) {
    real[j]=(signal[offset+i]||0)*window[i];
    imag[j]=0;
    let bit=n>>1;
    while(bit && (j&bit)){j^=bit;bit>>=1;}
    j^=bit;
  }
  for(let size=2;size<=n;size*=2) {
    const half=size/2, angle=-2*Math.PI/size, cos=Math.cos(angle), sin=Math.sin(angle);
    for(let block=0;block<n;block+=size) {
      let cr=1,ci=0;
      for(let k=block;k<block+half;k++) {
        const j=k+half, r=real[j]*cr-imag[j]*ci, im=real[j]*ci+imag[j]*cr;
        real[j]=real[k]-r;imag[j]=imag[k]-im;
        real[k]+=r;imag[k]+=im;
        const next=cr*cos-ci*sin;ci=ci*cos+cr*sin;cr=next;
      }
    }
  }
  for(let k=0;k<magnitude.length;k++)magnitude[k]=Math.hypot(real[k],imag[k]);
}

function identifyChord(chroma) {
  const total=chroma.reduce((a,b)=>a+b,0);
  if(total<.05)return null;
  let best=null,second=0;
  for(let root=0;root<12;root++)for(const shape of chordShapes) {
    const tones=shape.tones.map(interval=>(root+interval)%12);
    const weights=tones.map(pc=>chroma[pc]/total);
    // A strong fifth by itself cannot distinguish major and minor.
    const score=weights.reduce((a,b)=>a+b,0)+.35*Math.min(...weights);
    if(!best||score>best.score) {
      second=best?.score||0;best={root,suffix:shape.suffix,tones,score,weakest:Math.min(...weights)};
    }else second=Math.max(second,score);
  }
  if(best.score<.66 || best.weakest<.075 || best.score-second<.065)return null;
  const confidence=clamp((best.score-second)/.23,0,1);
  return {root:best.root,suffix:best.suffix,tones:best.tones,confidence};
}

function backingHarmony(channels, rate) {
  const n=2048,stride=Math.max(1,Math.round(rate/8000)),sr=rate/stride;
  const down=channels.map(channel=>{
    const low=new Float32Array(Math.ceil(channel.length/stride));
    for(let i=0;i<channel.length;i++)low[Math.floor(i/stride)]+=channel[i]/stride;
    return low;
  });
  const duration=channels[0].length/rate,window=Float64Array.from({length:n},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(n-1)));
  const real=new Float64Array(n),imag=new Float64Array(n),mag=new Float64Array(n/2);
  const frames=[],salience=[];
  for(let frame=0;frame*CHORD_HOP<duration;frame++) {
    const offset=Math.round((frame+.5)*CHORD_HOP*sr)-n/2,chroma=new Float64Array(12);
    for(const signal of down) {
      magnitudeSpectrum(signal,offset,window,real,imag,mag);
      let peak=0;
      const end=Math.min(mag.length-1,Math.ceil(2300*n/sr));
      for(let k=2;k<end;k++)peak=Math.max(peak,mag[k]);
      if(peak<.06)continue;
      for(let k=Math.max(2,Math.floor(60*n/sr));k<end;k++){
        const l=mag[k-1],m=mag[k],r=mag[k+1];
        if(m<l||m<=r||m<peak*.065)continue;
        const delta=clamp(.5*(l-r)/(l+r-2*m||1),-.5,.5);
        const hz=(k+delta)*sr/n,p=69+12*Math.log2(hz/440),key=Math.round(p);
        const closeness=1-Math.min(1,Math.abs(p-key)*1.6);
        chroma[(key+120)%12]+=m*closeness/Math.max(1,hz/800);
      }
    }
    const total=chroma.reduce((sum,value)=>sum+value,0);
    salience.push(total>.05?Array.from(chroma,value=>value/total):null);
    frames.push(identifyChord(chroma));
  }
  // Drop isolated estimates, including ones straddling an actual chord change.
  const same=(a,b)=>a&&b&&a.root===b.root&&a.suffix===b.suffix;
  const stable=frames.map((c,i)=>same(c,frames[i-1])||same(c,frames[i+1])?c:null);
  return {frames:stable,salience,duration};
}

function harmonyForNote(guide,n) {
  const start=n.s+n.offset,end=n.e+n.offset+n.length, votes=new Map();
  for(let i=Math.max(0,Math.floor(start/CHORD_HOP));i<guide.frames.length&&i*CHORD_HOP<end;i++){
    const chord=guide.frames[i];
    if(!chord)continue;
    const overlap=Math.min(end,(i+1)*CHORD_HOP,guide.duration)-Math.max(start,i*CHORD_HOP);
    const key=chord.root+chord.suffix, vote=votes.get(key)||{chord,weight:0,coverage:0};
    vote.weight+=overlap*chord.confidence;vote.coverage+=overlap;votes.set(key,vote);
  }
  let best=null;
  for(const v of votes.values())if(!best||v.weight>best.weight)best=v;
  if(!best||best.coverage<(end-start)*.58||best.weight<(end-start)*.42)return null;
  return {...best.chord,confidence:best.weight/(end-start)};
}

function backingTonesForNote(guide,n){
  if(!guide.salience)return null;
  const start=n.s+n.offset,end=n.e+n.offset+n.length;
  const weights=new Float64Array(12);
  let coverage=0;
  for(let i=Math.max(0,Math.floor(start/CHORD_HOP));i<guide.salience.length&&i*CHORD_HOP<end;i++){
    const frame=guide.salience[i];if(!frame)continue;
    const overlap=Math.min(end,(i+1)*CHORD_HOP,guide.duration)-Math.max(start,i*CHORD_HOP);
    coverage+=overlap;
    for(let pc=0;pc<12;pc++)weights[pc]+=frame[pc]*overlap;
  }
  if(coverage<(end-start)*.45)return null;
  const peak=Math.max(...weights)/coverage;
  if(peak<.15)return null;
  return Array.from(weights,value=>value/(peak*coverage));
}
