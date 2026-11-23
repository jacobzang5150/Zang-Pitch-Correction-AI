function vocalFixture() {
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
