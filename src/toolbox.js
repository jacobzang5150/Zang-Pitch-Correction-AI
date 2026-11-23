const toolFamilies=[
  {name:'Main',symbol:'↖',tools:[['main','Main tool'],['scroll','Drag view'],['zoom','Zoom']]},
  {name:'Pitch',symbol:'↕',tools:[['pitch','Pitch'],['mod','Pitch modulation'],['drift','Pitch drift']]},
  {name:'Formant',symbol:'ƒ',tools:[['formant','Formant']]},
  {name:'Amplitude',symbol:'◁',tools:[['gain','Amplitude'],['fadeIn','Fade in'],['fadeOut','Fade out'],['sibilant','Sibilant balance']]},
  {name:'Time',symbol:'↔',tools:[['offset','Time'],['length','Note length'],['handle','Time handle'],['attack','Attack speed']]},
  {name:'Separation',symbol:'┆',tools:[['split','Split note'],['merge','Merge with next'],['hard','Separation type']]}
];
let activeTool='main',paletteOrigin=null;
const palette=$('toolPalette');
function closePalette(restoreFocus=false) {
  hideToolTip();
  palette.hidden=true;
  $('toolButton').setAttribute('aria-expanded','false');
  if(restoreFocus)paletteOrigin?.focus({preventScroll:true});
}
function chooseTool(id,label){
  cvs.style.cursor=id==='scroll'?'grab':'';
  activeTool=id;draw();$('toolButton').textContent=label+' ▾';
  closePalette(true);
}
const toolPaths={
  main:'M5 3l13 10-7 1-3 7z',scroll:'M5 12V8m3 4V5m3 7V4m3 8V6m0 4 3-1v6l-3 5H9l-5-6z',
  zoom:'M15 15l6 6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M7 10h6m-3-3v6',
  pitch:'M12 2v20m-4-16 4-4 4 4M8 18l4 4 4-4M4 12h16',
  mod:'M2 12q2-11 4 0t4 0t4 0t4 0t4 0',drift:'M2 17c6 0 7-11 20-11',
  formant:'M3 19V13m4 6V8m4 11V3m4 16V7m4 12v-6',
  gain:'M3 17l17-11v11z',fadeIn:'M3 18c8 0 11-2 17-13M3 21h17',
  fadeOut:'M3 5c7 11 10 13 17 13M3 21h17',sibilant:'M2 13l4-5 3 10 4-15 3 16 3-11 3 5',
  offset:'M2 12h20M7 7l-5 5 5 5m10-10 5 5-5 5',length:'M3 5v14m17-14v14M5 12h13',
  handle:'M2 12h20m-10-7 4 7-4 7-4-7z',attack:'M3 20l5-16 4 10 9 2',
  split:'M11 3v18M3 8h5v8H3m17-8h-5v8h5',merge:'M2 8h5l4 4-4 4H2m20-8h-5l-4 4 4 4h5',
  hard:'M8 4v16m7-16v16',keep:'M3 12l6 6L21 5',reset:'M3 5v6h6M4 10a8 8 0 1 1 1 8'
};
let tipTimer;
const tip=$('toolTip');
function hideToolTip(){
  clearTimeout(tipTimer);tip.hidden=true;
}
function showToolTip(button){
  hideToolTip();
  tipTimer=setTimeout(()=>{
    if(palette.hidden||!button.offsetWidth)return;
    tip.textContent=button.getAttribute('aria-label');tip.hidden=false;
    const r=button.getBoundingClientRect();
    tip.style.left=clamp(r.left+r.width/2-tip.offsetWidth/2,4,innerWidth-tip.offsetWidth-4)+'px';
    tip.style.top=(r.top>tip.offsetHeight+8?r.top-tip.offsetHeight-5:r.bottom+5)+'px';
  },250);
}
function iconButton(id,label,activate){
  const b=document.createElement('button');
  b.setAttribute('aria-label',label);b.addEventListener('pointerenter',()=>showToolTip(b));
  b.addEventListener('focus',()=>showToolTip(b));b.onpointerleave=b.onblur=hideToolTip;b.dataset.tool=id;b.onclick=activate;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  path.setAttribute('d',toolPaths[id]);svg.append(path);b.append(svg);return b;
}
function openPalette(x,y,origin,hasNote) {
  if(busy)return;
  paletteOrigin=origin;
  const groups=document.createElement('div');groups.className='toolGroups';palette.replaceChildren(groups);
  function show(column){for(const col of groups.children)col.lastChild.hidden=col!==column;}
  for(const group of toolFamilies){
    const column=document.createElement('div'),subs=document.createElement('div');subs.className='subtools';
    const [[id,label],...children]=group.tools;
    const primary=iconButton(id,label,()=>chooseTool(id,label));primary.dataset.family=group.name;
    primary.onfocus=column.onpointerenter=()=>show(column);column.append(primary,subs);groups.append(column);
    for(const [child,name] of children)subs.append(iconButton(child,name,()=>chooseTool(child,name)));
  }
  if(hasNote){
    const actions=document.createElement('div');actions.className='noteActions';
    actions.append(iconButton('keep','Keep original pitch',()=>{closePalette(true);keepPitch();}),
      iconButton('reset','Reset note',()=>{closePalette(true);resetNote();}));palette.append(actions);
  }
  const current=palette.querySelector('[data-tool="'+activeTool+'"]')||groups.firstChild.firstChild;
  current.setAttribute('aria-pressed','true');show(current.closest('.toolGroups > div'));
  palette.hidden=false;$('toolButton').setAttribute('aria-expanded','true');
  palette.style.left=clamp(x,6,innerWidth-palette.offsetWidth-6)+'px';
  palette.style.top=clamp(y,6,innerHeight-215)+'px';
  current.focus({preventScroll:true});
}
$('toolButton').onclick=()=>{
  if(!palette.hidden){closePalette();return;}
  const r=$('toolButton').getBoundingClientRect();openPalette(r.left,r.bottom+4,$('toolButton'),!!note());
};
document.addEventListener('pointerdown',e=>{if(!palette.contains(e.target)&&e.target!==$('toolButton'))closePalette();});
document.addEventListener('keydown',e=>{
  if(palette.hidden)return;
  if(e.key==='Escape'){e.preventDefault();closePalette(true);return;}
  const buttons=[...palette.querySelectorAll('button')].filter(b=>b.offsetWidth),i=buttons.indexOf(document.activeElement);
  if(e.key.startsWith('Arrow')){
    e.preventDefault();
    if(e.key==='ArrowDown'&&document.activeElement?.dataset.family){document.activeElement.nextElementSibling?.querySelector('button')?.focus();return;}
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
