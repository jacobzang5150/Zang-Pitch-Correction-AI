const controls=[
  ['pitch','Pitch (st)',-12,12,.01],['drift','Drift (%)',0,200,1,100],
  ['mod','Modulation (%)',0,200,1,100],['transition','Pitch transition (%)',0,100,1,100],
  ['formant','Formant (st)',-7,7,.1],['offset','Position (ms)',-2000,2000,1,1000],
  ['length','Length Δ (ms)',-2000,2000,1,1000],['handle','Time handle (%)',-8,35,1,100],
  ['attack','Attack (%)',-16,20,1,100],['gain','Gain (dB)',-48,18,.1],
  ['sibilant','Sibilants (dB)',-24,12,.1],['fadeIn','Fade in (ms)',0,500,1,1000],['fadeOut','Fade out (ms)',0,500,1,1000]
];
const cvs=$('canvas'),ctx=cvs.getContext('2d');
let hits=[],timelineScale={},gesture=null,viewGesture=null,pitchZoom=1;
function adjust(id,value) {
  const t=current(),n=note();if(!n)return;
  const start=n.s+n.offset,end=n.e+n.offset+n.length;
  const prev=selected?t.notes[selected-1]:null,next=t.notes[selected+1];
  const left=prev?prev.e+prev.offset+prev.length:0,right=next?next.s+next.offset:t.channels[0].length/t.rate;
  if(id==='offset')value=clamp(value,left-n.s,right-(end-start)-n.s);
  if(id==='length')value=clamp(value,.012-(n.e-n.s),right-start-(n.e-n.s));
  n[id]=value;
  if(id==='pitch'){n.pitchLocked=true;delete n.pitchReview;}
  invalidate(t);
}
function splitNote(at) {
  const t=current(),n=note();if(!n)return;
  const len=n.e-n.s+n.length,u=clamp((at-n.s-n.offset)/len,0,1),src=n.s+u*(n.e-n.s);
  if(src-n.s<.025||n.e-src<.025){status('Place the cursor at least 25 ms inside the note.',true);return;}
  remember();
  const left={...n,e:src,length:n.length*u},right={...n,s:src,offset:at-src,length:n.length*(1-u)};
  for(const part of [left,right]){
    const pitches=t.frames.slice(Math.ceil(part.s/HOP),Math.ceil(part.e/HOP)).filter(f=>f.p).map(f=>f.p);
    if(pitches.length)part.p=median(pitches);
  }
  t.notes.splice(selected,1,left,right);invalidate(t);refresh();
}
function mergeNext(){
  const t=current(),n=note(),next=t?.notes[selected+1];if(!n||!next)return;
  remember();const end=next.e+next.offset+next.length;n.e=next.e;n.length=end-n.offset-n.e;
  n.p=median(t.frames.slice(Math.ceil(n.s/HOP),Math.ceil(n.e/HOP)).filter(f=>f.p).map(f=>f.p))||n.p;
  t.notes.splice(selected+1,1);invalidate(t);refresh();
}
function keepPitch(){if(note()){remember();adjust('pitch',0);refresh();}}
function resetNote(){
  const n=note();if(!n)return;remember();
  Object.assign(n,defaultNote(n.s,n.e,n.p,n.confidence));delete n.pitchLocked;delete n.pitchReview;
  applyTiming(current().notes,current().channels[0].length/current().rate,x=>[x.s+x.offset,x.e+x.offset+x.length]);invalidate(current());refresh();
}
function trackList(){
  $('tracks').replaceChildren();
  $('chordGuide').replaceChildren(opt('Key and scale only',-1));
  const guide=$('guide').dataset.pending??$('guide').value;delete $('guide').dataset.pending;$('guide').replaceChildren();
  tracks.forEach((t,i)=>{
    $('guide').add(opt(t.name,i));
    if(t.role==='reference')$('chordGuide').add(opt(t.name,i));
    const row=document.createElement('div');row.className='track'+(active===i?' active':'');row.style.setProperty('--color',t.color);
    const bar=document.createElement('div');bar.className='trackTop';
    const check=document.createElement('input');check.type='checkbox';check.checked=t.selected;check.setAttribute('aria-label','Include '+t.name+' in correction');check.onchange=()=>{t.selected=check.checked;dirty=true;};
    const name=document.createElement('button');name.className='trackName';name.textContent=t.name;name.title=t.name;name.onclick=()=>{active=i;selected=-1;refresh();};
    bar.append(check,name);
    for(const [key,text,label] of [['mute','M','Mute'],['solo','S','Solo']]){
      const b=document.createElement('button');b.className='mini'+(t[key]?' on':'');b.textContent=text;b.title=label+' '+t.name;b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',t[key]);
      b.onclick=()=>{t[key]=!t[key];dirty=true;tracks.forEach(track=>applyMix(track));b.setAttribute('aria-pressed',t[key]);b.classList.toggle('on',t[key]);};bar.append(b);
    }
    const options=document.createElement('details'),summary=document.createElement('summary');
    summary.textContent='Track options';options.append(summary);
    const knobs=document.createElement('div');knobs.className='knobs';knobs.append(mixerKnob(t,'volume'),mixerKnob(t,'pan'));
    row.append(bar,knobs,options);
    const extra=document.createElement('div');extra.className='trackExtra';
    const role=document.createElement('select');role.setAttribute('aria-label','Role for '+t.name);role.add(opt('Vocal','vocal'));role.add(opt('Reference','reference'));role.value=t.role;
    role.onchange=()=>run(async()=>{
      stop();
      if(role.value==='vocal'&&!t.pitchAnalyzed){
        status('Detecting vocal notes in '+t.name+'…');
        const analysis=await dsp('analyze',t.channels[0],t.rate);
        t.frames=analysis.frames;t.notes=analysis.notes;t.slow=slowContour(t.frames);t.pitchAnalyzed=true;
        undoStack.length=redoStack.length=0;
      }
      t.role=role.value;
      if(i===chordSource&&t.role!=='reference')chordSource=-1;
      selected=-1;invalidate(t);
    });extra.append(role);
    const label=document.createElement('label'),range=document.createElement('input');label.textContent='Tightness ';range.type='range';range.min=0;range.max=100;range.value=Math.round(t.tight*100);
    range.title=range.value+'%';range.oninput=()=>{t.tight=+range.value/100;range.title=range.value+'%';dirty=true;};label.append(range);extra.append(label);
    const visibility=document.createElement('label'),visible=document.createElement('input');visible.type='checkbox';visible.checked=t.visible;
    visible.onchange=()=>{t.visible=visible.checked;dirty=true;draw();};visibility.append(visible,'Show in editor');
    options.append(extra,visibility);$('tracks').append(row);
  });
  $('chordGuide').value=String(chordSource);
  if(tracks[+guide])$('guide').value=String(+guide);
}
function noteInfo(){
  const n=note();if(!n)return;
  const review=n.pitchReview;
  let message=noteName(n.p+n.pitch)+' · '+Math.round((n.e-n.s+n.length)*1000)+' ms';
  if(n.pitchLocked)message+=' · Manual pitch';
  else if(review)message+=' · '+(review.reason||'Chord '+names[review.root]+review.suffix+' → '+noteName(review.target));
  status(message);
}
function refresh(){
  const importSlot=tracks.length?$('loadedImports'):$('empty');
  if($('importActions').parentElement!==importSlot)importSlot.append($('importActions'));
  trackList();$('empty').hidden=!!tracks.length;$('trackCount').textContent=tracks.length;
  for(const id of ['save','export','play','rewind','ab','stem','tune','quant','firstpass'])$(id).disabled=!tracks.length;
  $('align').disabled=tracks.length<2;$('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;
  $('strengthOut').textContent=$('strength').value+'%';$('timeOut').textContent=$('timing').value+'%';draw();
}
function draw(){
  const total=duration()||8,width=Math.max(260,$('timeline').clientWidth-2),left=52,top=chordGuide()?51:29;
  const visible=tracks.map((t,i)=>({t,i})).filter(x=>x.t.visible);
  const overlay=$('view').value==='overlay', rows=overlay?1:Math.max(1,visible.length);
  const h=(overlay?360:Math.max(120,Math.min(280,390/rows)))*pitchZoom, height=Math.max(252,top+rows*h);
  const px=window.devicePixelRatio||1;
  if(cvs.width!==Math.round(width*px)||cvs.height!==Math.round(height*px)){cvs.width=Math.round(width*px);cvs.height=Math.round(height*px);cvs.style.width=width+'px';cvs.style.height=height+'px';}
  ctx.setTransform(px,0,0,px,0,0);ctx.fillStyle='#141419';ctx.fillRect(0,0,width,height);
  const span=total/+$('zoom').value,origin=(total-span)*+$('pan').value/1000,scale=(width-left)/span;
  const x=s=>left+(s-origin)*scale;
  timelineScale={left,origin,scale,width,top};hits=[];
  const step=[.025,.05,.1,.25,.5,1,2,5,10,20,30,60,120,300,600].find(s=>s*scale>62)||1200;
  ctx.font='10px monospace';ctx.lineWidth=1;
  for(let t=Math.ceil(origin/step)*step;t<=origin+span+.0001;t+=step){
    ctx.fillStyle='#a4afaa';ctx.fillText(seconds(t),x(t)+3,16);ctx.strokeStyle='#282830';ctx.beginPath();ctx.moveTo(x(t),top);ctx.lineTo(x(t),height);ctx.stroke();
  }
  const harmony=chordGuide();
  if(harmony){
    ctx.fillStyle='#ff838b';ctx.fillText('CHORD',5,38);
    let previous=null, nextLabel=left;
    for(let i=Math.floor(origin/CHORD_HOP);i<harmony.frames.length&&i*CHORD_HOP<origin+span;i++){
      const chord=harmony.frames[i], name=chord?names[chord.root]+chord.suffix:'—';
      const xx=Math.max(left,x(i*CHORD_HOP));
      if(name!==previous && xx>=nextLabel){
        ctx.fillText(name,xx+3,38);nextLabel=xx+ctx.measureText(name).width+7;
      }
      previous=name;
    }
  }
  const pitchRange=members=>{
    let lo=Infinity,hi=-Infinity;
    for(const {t} of members)if(t.role==='vocal')for(const n of t.notes){lo=Math.min(lo,n.p,n.p+n.pitch);hi=Math.max(hi,n.p,n.p+n.pitch);}
    if(!Number.isFinite(lo))return [52,68];
    return [Math.floor(lo)-3,Math.max(Math.floor(lo)+9,Math.ceil(hi)+3)];
  };
  const common=pitchRange(visible);
  visible.forEach(({t,i},index)=>{
    const y0=top+(overlay?0:index*h),[lo,hi]=overlay?common:pitchRange([{t}]),unit=(h-21)/(hi-lo+1);
    const y=p=>y0+h-9-(p-lo)*unit;
    if(!overlay||!index){
      for(let p=lo;p<=hi;p++){
        if((p-lo)%Math.max(1,Math.ceil(10/unit)))continue;
        ctx.strokeStyle=p%12===0?'#48434c':'#26262d';ctx.beginPath();ctx.moveTo(left,y(p));ctx.lineTo(width,y(p));ctx.stroke();
        if(unit>=10||p%3===0){ctx.fillStyle='#98929d';ctx.fillText(noteName(p),6,y(p)+3);}
      }
      ctx.fillStyle='#343039';ctx.fillRect(0,y0,width,1);
    }
    if(!overlay){ctx.fillStyle=t.color;ctx.fillText(t.name.slice(0,48),left+5,y0+13);}
    ctx.save();ctx.beginPath();ctx.rect(left,y0,width-left,h);ctx.clip();
    if(t.role==='reference'){
      ctx.fillStyle=t.color;ctx.globalAlpha=.55;
      for(let col=left;col<width;col++){const f=t.frames[Math.floor((origin+(col-left)/scale)/HOP)];if(f){const amp=clamp(f.e*3,0,.75)*h;ctx.fillRect(col,y0+h/2-amp/2,1,Math.max(1,amp));}}
    }else{
      t.notes.forEach((n,ni)=>{
        const start=n.s+n.offset,end=n.e+n.offset+n.length;
        if(end<origin||start>origin+span)return;
        const cx=x(start),cy=y(n.p+n.pitch),w=Math.max(2,(end-start)*scale),bh=clamp(unit*.82,5,16);
        ctx.fillStyle=t.color;ctx.globalAlpha=overlay&&i!==active?.36:.78;
        ctx.beginPath();ctx.roundRect(cx,cy-bh/2,w,bh,Math.min(3,w/2));ctx.fill();ctx.globalAlpha=1;
        if(i===active&&ni===selected){ctx.strokeStyle='#fff1f3';ctx.lineWidth=2;ctx.stroke();ctx.lineWidth=1;}
        ctx.beginPath();ctx.strokeStyle=i===active?'#e7f6ec':t.color;
        let first=true;
        for(let k=Math.ceil(n.s/HOP);k*HOP<n.e;k+=Math.max(1,Math.floor(1/(scale*HOP)))) {
          const f=t.frames[k];if(!f?.p)continue;
          const u=(k*HOP-n.s)/(n.e-n.s),xx=x(start+u*(end-start)), yy=y(f.p+pitchAdjustment(n,t.notes[ni+1],f.p,t.slow[k],k*HOP));
          if(first){ctx.moveTo(xx,yy);first=false;}else ctx.lineTo(xx,yy);
        }
        ctx.stroke();hits.push({i,ni,x:cx,y:cy,w,bh,unit});
      });
    }
    ctx.restore();
  });
  const pos=liveTime();$('clock').textContent=seconds(pos);$('duration').textContent=tracks.length?seconds(total):'';
  if(x(pos)>=left&&x(pos)<=width){
    ctx.strokeStyle='#ff475d';ctx.beginPath();ctx.moveTo(x(pos),2);ctx.lineTo(x(pos),height);ctx.stroke();
    ctx.fillStyle='#ff475d';ctx.fillRect(x(pos)-3,0,6,5);
  }
}
function point(e){const r=cvs.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];}
function hitAt(x,y){
  const candidates=hits.filter(h=>x>=h.x-2&&x<=h.x+h.w+2&&Math.abs(y-h.y)<Math.max(7,h.bh/2+2));
  return candidates.sort((a,b)=>Number(b.i===active)-Number(a.i===active)||Math.abs(a.y-y)-Math.abs(b.y-y))[0];
}
function setViewport(g,hZoom,vZoom,slide=0){
  const total=duration()||8,z=clamp(hZoom,1,+$('zoom').max),span=total/z;
  $('zoom').value=z;
  const desired=g.anchor-span*g.fraction+slide;
  $('pan').value=span>=total?0:1000*clamp(desired/(total-span),0,1);
  pitchZoom=clamp(vZoom,1,12);draw();
  $('timeline').scrollTop=g.scroll+(g.canvasY-timelineScale.top)*(pitchZoom/g.vZoom-1);
}
function startView(e,x,y,tool){
  const {left,origin,scale,width}=timelineScale;
  const fraction=clamp((x-left)/(width-left),0,1);
  viewGesture={tool,anchor:origin+fraction*(duration()||8)/+$('zoom').value,fraction,
    scale,hZoom:+$('zoom').value,vZoom:pitchZoom,x:e.clientX,y:e.clientY,canvasY:y,scroll:$('timeline').scrollTop,moved:false};
  cvs.setPointerCapture(e.pointerId);
}
$('timeline').addEventListener('wheel',e=>{
  if(!e.shiftKey||e.ctrlKey||e.metaKey)return;
  e.preventDefault();
  const {origin,scale,width,left}=timelineScale,total=duration();
  const travel=total-total/+$('zoom').value;
  if(travel<=0)return;
  const unit=e.deltaMode===1?16:e.deltaMode===2?width-left:1;
  const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
  $('pan').value=1000*clamp((origin+delta*unit/scale)/travel,0,1);
  draw();
},{passive:false});
cvs.oncontextmenu=e=>{
  e.preventDefault();if(busy)return;
  const [x,y]=point(e),hit=hitAt(x,y);
  if(hit){active=hit.i;selected=hit.ni;refresh();noteInfo();}
  openPalette(e.clientX,e.clientY,cvs,!!hit);
};
cvs.onpointerdown=e=>{
  if(busy||e.button!==0||e.ctrlKey)return;
  const [x,y]=point(e),{left,origin,scale}=timelineScale;if(x<left)return;
  const zoomChord=e.metaKey&&e.altKey;
  if(zoomChord||activeTool==='zoom'||activeTool==='scroll'){startView(e,x,y,zoomChord?'zoom':activeTool);return;}
  stop();const clickedTime=clamp(origin+(x-left)/scale,0,duration());
  const hit=hitAt(x,y);if(!hit||y<timelineScale.top){position=clickedTime;draw();return;}
  active=hit.i;selected=hit.ni;refresh();noteInfo();
  if(activeTool==='split'){splitNote(clickedTime);return;}if(activeTool==='merge'){mergeNext();return;}
  if(activeTool==='hard'){remember();note().hard=!note().hard;invalidate(current());status(note().hard?'Hard boundary':'Soft boundary');return;}
  let id=activeTool;
  if(id==='main'&&x>=hit.x+hit.w-Math.min(6,hit.w*.15))id='length';
  if(id==='pitch'&&note()!==current().notes.at(-1)&&x>hit.x+hit.w-Math.min(5,hit.w*.12))id='transition';
  gesture={x,y,hit,id,start:note()[id],changed:false};cvs.setPointerCapture(e.pointerId);monitorNote(current(),note());
};
cvs.onpointermove=e=>{
  if(viewGesture){
    const g=viewGesture,dx=e.clientX-g.x,up=g.y-e.clientY;
    if(Math.abs(dx)+Math.abs(up)<3&&!g.moved)return;g.moved=true;
    if(g.tool==='zoom')setViewport(g,g.hZoom*2**(-dx/110),g.vZoom*2**(-up/120));
    else {setViewport(g,g.hZoom,g.vZoom,-dx/g.scale);$('timeline').scrollTop=g.scroll+up;}
    return;
  }
  if(!gesture)return;
  const [x,y]=point(e),g=gesture,dx=x-g.x,dy=g.y-y;
  if(!g.changed&&Math.abs(dx)+Math.abs(dy)<3)return;
  if(!g.changed){
    if(g.id==='main'){g.id=Math.abs(dy)>=Math.abs(dx)?'pitch':'offset';g.start=note()[g.id];}
    remember(true);g.changed=true;
  }
  const [,,min,max,,factor=1]=controls.find(c=>c[0]===g.id);
  let delta;
  if(g.id==='pitch'||g.id==='formant')delta=dy/g.hit.unit;
  else if(['offset','length','fadeIn','fadeOut'].includes(g.id))delta=dx/timelineScale.scale;
  else if(['gain','sibilant'].includes(g.id))delta=dy*.15;
  else delta=dy*.007;
  const value=clamp(g.start+delta,min/factor,max/factor);
  adjust(g.id,value);updateMonitor();noteInfo();draw();
};
cvs.onpointerup=e=>{
  if(e.button!==0)return;
  if(viewGesture){
    if(!viewGesture.moved&&viewGesture.tool==='zoom')setViewport(viewGesture,viewGesture.hZoom*2,viewGesture.vZoom);
    viewGesture=null;return;
  }
  if(gesture){releaseMonitor(gesture.changed);gesture=null;refresh();}
};
cvs.onpointercancel=cvs.onlostpointercapture=()=>{if(gesture){stopMonitor();gesture=null;}viewGesture=null;};
new ResizeObserver(draw).observe($('timeline'));refresh();
