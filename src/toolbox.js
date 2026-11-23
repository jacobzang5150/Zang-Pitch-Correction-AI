const toolFamilies=[
  {name:'Main',symbol:'↖',tools:[['main','Main tool'],['scroll','Scroll'],['zoom','Zoom']]},
  {name:'Pitch',symbol:'↕',tools:[['pitch','Pitch'],['mod','Pitch modulation'],['drift','Pitch drift'],['transition','Pitch transition']]},
  {name:'Formant',symbol:'ƒ',tools:[['formant','Formant']]},
  {name:'Amplitude',symbol:'◁',tools:[['gain','Amplitude'],['fadeIn','Fade in'],['fadeOut','Fade out'],['sibilant','Sibilant balance']]},
  {name:'Time',symbol:'↔',tools:[['offset','Time'],['length','Note length'],['handle','Time handle'],['attack','Attack speed']]},
  {name:'Separation',symbol:'┆',tools:[['split','Split note'],['merge','Merge with next'],['hard','Separation type']]}
];
let activeTool='main',paletteOrigin=null;
const palette=$('toolPalette');
function closePalette(restoreFocus=false) {
  palette.hidden=true;
  $('toolButton').setAttribute('aria-expanded','false');
  if(restoreFocus)paletteOrigin?.focus({preventScroll:true});
}
function chooseTool(id,label){
  activeTool=id;$('toolButton').textContent=label+' ▾';
  closePalette(true);
}
function openPalette(x,y,origin,hasNote) {
  if(busy)return;
  paletteOrigin=origin;
  const groups=document.createElement('div'),tools=document.createElement('div'),actions=document.createElement('div');
  groups.className='toolGroups';tools.className='subtools';actions.className='noteActions';
  const button=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.onclick=fn;return b;};
  function show(group){
    for(const b of groups.children)b.setAttribute('aria-pressed',b.dataset.family===group.name);
    tools.replaceChildren();
    for(const [id,label] of group.tools){
      const b=button(label,()=>chooseTool(id,label));b.dataset.tool=id;b.setAttribute('aria-pressed',id===activeTool);tools.append(b);
    }
  }
  for(const group of toolFamilies){
    const b=button(group.symbol+' '+group.name,()=>show(group));b.dataset.family=group.name;b.setAttribute('aria-label',group.name+' tools');
    b.onpointerenter=()=>show(group);b.onfocus=()=>show(group);groups.append(b);
  }
  palette.replaceChildren(groups,tools);
  if(hasNote){
    for(const [label,fn] of [['Keep original pitch',keepPitch],['Reset note',resetNote]]){
      actions.append(button(label,()=>{closePalette(true);fn();}));
    }
    palette.append(actions);
  }
  const group=toolFamilies.find(f=>f.tools.some(([id])=>id===activeTool));
  show(group);palette.hidden=false;$('toolButton').setAttribute('aria-expanded','true');
  palette.style.left=clamp(x,6,innerWidth-palette.offsetWidth-6)+'px';
  // Reserve room for the largest group when opening near the bottom edge.
  palette.style.top=clamp(y,6,innerHeight-Math.max(palette.offsetHeight,190)-6)+'px';
  groups.querySelector('[aria-pressed="true"]').focus({preventScroll:true});
}
$('toolButton').onclick=()=>{
  if(!palette.hidden){closePalette();return;}
  const r=$('toolButton').getBoundingClientRect();openPalette(r.left,r.bottom+4,$('toolButton'),!!note());
};
document.addEventListener('pointerdown',e=>{if(!palette.contains(e.target)&&e.target!==$('toolButton'))closePalette();});
document.addEventListener('keydown',e=>{
  if(palette.hidden)return;
  if(e.key==='Escape'){e.preventDefault();closePalette(true);return;}
  const buttons=[...palette.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);
  if(e.key.startsWith('Arrow')){
    e.preventDefault();
    if(e.key==='ArrowDown'&&document.activeElement?.dataset.family){palette.querySelector('.subtools button')?.focus();return;}
    const direction=['ArrowRight','ArrowDown'].includes(e.key)?1:-1;
    buttons[(i+direction+buttons.length)%buttons.length].focus();
  }
});
palette.addEventListener('focusout',e=>{if(e.relatedTarget&&!palette.contains(e.relatedTarget))closePalette();});
window.addEventListener('resize',()=>closePalette());

function mixerKnob(track,key) {
  const isPan=key==='pan',label=isPan?'Pan':'Volume',min=isPan?-100:-60,max=isPan?100:12;
  const control=document.createElement('div'),wrap=document.createElement('label'),value=document.createElement('span');
  control.className='dial';control.tabIndex=0;control.setAttribute('role','slider');
  control.setAttribute('aria-label',label+' '+track.name);control.setAttribute('aria-valuemin',min);control.setAttribute('aria-valuemax',max);
  const read=()=>isPan?Math.round(track.pan*100):track.volume;
  function display(){
    const v=read(),angle=-135+270*(v-min)/(max-min);
    control.style.setProperty('--angle',angle+'deg');
    const text=isPan?(v===0?'C':(v<0?'L':'R')+Math.abs(v)):(v<=-60?'−∞':(v>0?'+':'')+v)+' dB';
    control.setAttribute('aria-valuenow',v);control.setAttribute('aria-valuetext',text);
    value.textContent=text;control.title=label+' '+text+' · Drag up or down · Double-click to reset';
  }
  function set(v){v=clamp(Math.round(v),min,max);track[key]=isPan?v/100:v;applyMix(track);dirty=true;display();}
  let start;
  control.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();control.focus();start={y:e.clientY,value:read()};control.setPointerCapture(e.pointerId);};
  control.onpointermove=e=>{if(start)set(start.value+(start.y-e.clientY)*(isPan?1.4:.55));};
  control.onlostpointercapture=control.onpointercancel=control.onpointerup=()=>{start=null;};
  control.ondblclick=()=>set(0);
  control.onkeydown=e=>{
    const step=e.shiftKey?10:1,values={ArrowUp:read()+step,ArrowRight:read()+step,ArrowDown:read()-step,ArrowLeft:read()-step,Home:min,End:max};
    if(e.key in values){e.preventDefault();set(values[e.key]);}
  };
  wrap.className='knob';wrap.append(control,document.createTextNode(label+' '),value);display();return wrap;
}
