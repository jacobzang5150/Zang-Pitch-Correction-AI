// WAV decoding avoids browser resampling and preserves the stem's original timeline.
function decodeWav(buffer) {
  const d=new DataView(buffer), tag=p=>String.fromCharCode(...new Uint8Array(buffer,p,4));
  if(d.byteLength<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw Error('Choose an uncompressed PCM or float WAV file.');
  let fmt, data;
  for(let p=12;p+8<=d.byteLength;) {
    const id=tag(p),n=d.getUint32(p+4,true),at=p+8;
    if(at+n>d.byteLength)throw Error('This WAV appears incomplete.');
    if(id==='fmt ' && n>=16) {
      let type=d.getUint16(at,true);
      if(type===65534 && n>=40)type=d.getUint16(at+24,true);
      fmt={type,ch:d.getUint16(at+2,true),rate:d.getUint32(at+4,true),stride:d.getUint16(at+12,true),bits:d.getUint16(at+14,true)};
    }
    if(id==='data')data=[at,n];
    p=at+n+(n%2);
  }
  if(!fmt||!data)throw Error('Missing WAV format or audio data.');
  const {type,ch,rate,stride,bits}=fmt;
  if(ch<1||ch>2||rate<8000||rate>192000||((type!==1||![8,16,24,32].includes(bits))&&(type!==3||![32,64].includes(bits)))||stride<ch*bits/8)throw Error('Use a mono or stereo PCM/float WAV at 8–192 kHz.');
  const count=Math.floor(data[1]/stride);
  if(!count)throw Error('This stem contains no samples.');
  const channels=Array.from({length:ch},()=>new Float32Array(count));
  for(let i=0;i<count;i++)for(let c=0;c<ch;c++) {
    const p=data[0]+i*stride+c*bits/8;
    let x;
    if(type===3)x=bits===32?d.getFloat32(p,true):d.getFloat64(p,true);
    else if(bits===8)x=(d.getUint8(p)-128)/128;
    else if(bits===16)x=d.getInt16(p,true)/32768;
    else if(bits===24)x=((d.getUint16(p,true)|(d.getInt8(p+2)<<16)))/8388608;
    else x=d.getInt32(p,true)/2147483648;
    channels[c][i]=Number.isFinite(x)?x:0;
  }
  return {channels,rate};
}
function wavBytes(channels,rate) {
  const stride=channels.length*3, size=channels[0].length*stride, bytes=new Uint8Array(44+size+(size%2)), d=new DataView(bytes.buffer);
  const tag=(p,s)=>[...s].forEach((c,i)=>d.setUint8(p+i,c.charCodeAt(0)));
  tag(0,'RIFF');d.setUint32(4,bytes.length-8,true);tag(8,'WAVE');tag(12,'fmt ');d.setUint32(16,16,true);
  d.setUint16(20,1,true);d.setUint16(22,channels.length,true);d.setUint32(24,rate,true);
  d.setUint32(28,rate*stride,true);d.setUint16(32,stride,true);d.setUint16(34,24,true);
  tag(36,'data');d.setUint32(40,size,true);
  let p=44;
  for(let i=0;i<channels[0].length;i++)for(const ch of channels){
    const v=clamp(Math.round(ch[i]*8388608),-8388608,8388607);
    bytes[p++]=v;bytes[p++]=v>>8;bytes[p++]=v>>16;
  }
  return bytes;
}
const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,i)=>{
  let v=i;for(let j=0;j<8;j++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v;
});
function zipStems(files) {
  const entries=[],central=[];let offset=0,dirSize=0;
  for(const {name,bytes} of files) {
    const n=encoder.encode(name);
    let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);crc^=0xffffffff;
    function head(isCentral) {
      const h=new Uint8Array((isCentral?46:30)+n.length),d=new DataView(h.buffer),s=isCentral?2:0;
      d.setUint32(0,isCentral?0x02014b50:0x04034b50,true);
      if(isCentral)d.setUint16(4,20,true);
      d.setUint16(4+s,20,true);d.setUint16(6+s,0x800,true);
      d.setUint32(14+s,crc,true);d.setUint32(18+s,bytes.length,true);d.setUint32(22+s,bytes.length,true);
      d.setUint16(26+s,n.length,true);if(isCentral)d.setUint32(42,offset,true);
      h.set(n,h.length-n.length);return h;
    }
    const local=head(false),dir=head(true);
    entries.push(local,bytes);central.push(dir);dirSize+=dir.length;offset+=local.length+bytes.length;
    if(offset+dirSize>=0xffffffff)throw Error('Export individual stems for projects over 4 GB.');
  }
  const tail=new Uint8Array(22),d=new DataView(tail.buffer);
  d.setUint32(0,0x06054b50,true);d.setUint16(8,files.length,true);d.setUint16(10,files.length,true);
  d.setUint32(12,dirSize,true);d.setUint32(16,offset,true);
  return new Blob([...entries,...central,tail],{type:'application/zip'});
}
function projectBlob(tracks,settings) {
  const metadata={format:'ZangPitchProject',version:1,settings,tracks:tracks.map(t=>({
    name:t.name,rate:t.rate,n:t.channels[0].length,ch:t.channels.length,notes:t.notes,
    volume:t.volume,pan:t.pan,mute:t.mute,solo:t.solo,selected:t.selected,visible:t.visible,tight:t.tight,role:t.role
  }))};
  const json=encoder.encode(JSON.stringify(metadata)),size=new Uint8Array(4);
  new DataView(size.buffer).setUint32(0,json.length,true);
  return new Blob([size,json,...tracks.flatMap(t=>t.channels)],{type:'application/octet-stream'});
}
function readProject(buf) {
  const d=new DataView(buf),len=d.getUint32(0,true), meta=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,4,len)));
  if(meta.format!=='ZangPitchProject'||meta.version!==1||!Array.isArray(meta.tracks))throw Error('Unsupported project.');
  let pos=4+len;
  const tracks=meta.tracks.map(t=>{
    if(!Number.isInteger(t.n)||t.n<1||![1,2].includes(t.ch)||!Number.isInteger(t.rate)||t.rate<8000||t.rate>192000||pos+4*t.n*t.ch>buf.byteLength||!Array.isArray(t.notes))throw Error('Invalid track data.');
    const channels=Array.from({length:t.ch},()=>{const a=new Float32Array(buf.slice(pos,pos+4*t.n));pos+=4*t.n;return a;});
    let prevEnd=0;
    const notes=t.notes.map(n=>{
      const def=defaultNote(n.s,n.e,n.p,n.confidence);
      for(const k of Object.keys(def))if(k!=='hard'&&!Number.isFinite(n[k]))throw Error('Invalid note parameter.');
      if(n.s<prevEnd-.0001||n.e<=n.s||n.e>t.n/t.rate+.001||n.p<0||n.p>150)throw Error('Invalid note boundary.');
      prevEnd=n.e;return {...def,...n};
    });
    return {...t,name:String(t.name),channels,notes};
  });
  if(pos!==buf.byteLength)throw Error('Unexpected project data.');
  return {tracks,settings:meta.settings||{}};
}
function demoTracks() {
  const rate=24000, pitches=[60,64,67,65,64,62,60,62,64,67,69,67],starts=[.4,.88,1.35,2.15,2.65,3.12,3.85,4.38,4.9,5.65,6.15,6.8];
  return ['Lead vocal','High harmony','Harmony double'].map((name,v)=>{
    const samples=new Float32Array(rate*8);
    for(let k=0;k<starts.length;k++) {
      let phase=0; const start=starts[k]+(v?(.07*Math.sin(k*2+v)+.035):0), len=Math.min(.62,(starts[k+1]??7.6)-starts[k]-.07);
      for(let j=0;j<len*rate;j++) {
        const t=j/rate, env=Math.min(1,t/.045,(len-t)/.065);
        const pitch=pitches[k]+(v?[4,3,3,4,3,3][k%6]:0)+.23*Math.sin(2*k+v)+.12*Math.sin(36*t)-.45*Math.exp(-30*t);
        phase+=2*Math.PI*midiHz(pitch)/rate;
        let y=0;
        for(let h=1;h<=12;h++)y+=Math.sin(phase*h)*(1+.55*Math.cos(h+k))/h;
        samples[Math.floor(start*rate)+j]=y*.16*env;
      }
    }
    return {name,channels:[samples],rate};
  });
}
