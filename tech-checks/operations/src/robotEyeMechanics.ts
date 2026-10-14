export function drawMechanicalSocket(c: CanvasRenderingContext2D, p: { x: number; y: number }, time: number) {
 const cx=359,cy=357;
 c.save();c.beginPath();c.ellipse(cx,cy,222,155,0,0,Math.PI*2);c.clip();
 const base=c.createRadialGradient(cx,cy,40,cx,cy,235);base.addColorStop(0,'#070809');base.addColorStop(.7,'#242628');base.addColorStop(1,'#060708');c.fillStyle=base;c.fillRect(cx-250,cy-180,500,360);
 // A recessed gimbal moves a few pixels behind the scanning lens.
 c.save();c.translate(cx+p.x*.11,cy+p.y*.08);c.scale(1,.86);
 const turn=p.x/88*.04+p.y/42*.024+Math.sin(time*.85)*.012;
 c.rotate(turn);
 const aperture=93+Math.sin(time*.7)*3;
 // Overlapping machined shutter blades, with curved seams and brushed edges.
 for(let i=0;i<14;i++){
  const a=i*Math.PI*2/14,o=246,mid=170,b=a+.44;
  const x0=Math.cos(a)*o,y0=Math.sin(a)*o;
  const x1=Math.cos(b)*o,y1=Math.sin(b)*o;
  const x2=Math.cos(a+1.1)*aperture,y2=Math.sin(a+1.1)*aperture;
  const x3=Math.cos(a+.68)*(aperture+10),y3=Math.sin(a+.68)*(aperture+10);
  const metal=c.createLinearGradient(x0,y0,x2,y2);metal.addColorStop(0,'#111213');metal.addColorStop(.28,'#434648');metal.addColorStop(.43,'#252729');metal.addColorStop(.75,'#17191b');metal.addColorStop(1,'#070809');
  c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.quadraticCurveTo(Math.cos(a+.88)*mid,Math.sin(a+.88)*mid,x2,y2);c.lineTo(x3,y3);c.quadraticCurveTo(Math.cos(a+.3)*mid,Math.sin(a+.3)*mid,x0,y0);c.closePath();c.fillStyle=metal;c.fill();c.strokeStyle='#08090a';c.lineWidth=3;c.stroke();
  c.beginPath();c.moveTo(x0,y0);c.quadraticCurveTo(Math.cos(a+.3)*mid,Math.sin(a+.3)*mid,x3,y3);c.strokeStyle='rgba(157,160,162,.38)';c.lineWidth=1;c.stroke();
  // Short parallel machining lines follow each blade.
  for(let j=0;j<3;j++){const r=179+j*5;c.beginPath();c.arc(0,0,r,a+.07,a+.24);c.strokeStyle='rgba(122,124,126,.16)';c.lineWidth=.8;c.stroke();}
 }
 // Concentric bearing races and the fine teeth of the actuator ring.
 for(const r of [213,204,181,174,123]){
  c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.strokeStyle='#08090a';c.lineWidth=5;c.stroke();
  c.beginPath();c.arc(0,0,r-1.8,0,Math.PI*2);c.strokeStyle=r>190?'rgba(158,160,161,.46)':'rgba(109,112,114,.35)';c.lineWidth=1;c.stroke();
 }
 c.save();c.rotate(-turn*.65);
 for(let i=0;i<60;i++){
  const a=i*Math.PI/30;c.beginPath();c.moveTo(Math.cos(a)*190,Math.sin(a)*190);c.lineTo(Math.cos(a)*199,Math.sin(a)*199);c.strokeStyle=i%5===0?'#77797b':'#353739';c.lineWidth=i%5===0?2:1;c.stroke();
 }
 c.restore();
 // Small red electrical tracks stay recessed behind the eye.
 for(let i=0;i<8;i++){
  const a=i*Math.PI/4+.12;
  c.beginPath();c.arc(0,0,168,a,a+.12);c.lineTo(Math.cos(a+.12)*148,Math.sin(a+.12)*148);c.strokeStyle='#ff1515';c.lineWidth=1.5;c.shadowColor='#ff0000';c.shadowBlur=5;c.stroke();c.shadowBlur=0;
  c.beginPath();c.arc(Math.cos(a)*217,Math.sin(a)*217,3,0,Math.PI*2);c.fillStyle='#08090a';c.fill();c.strokeStyle='#77797a';c.lineWidth=1;c.stroke();
 }
 // Red light sweeps along the bearing as the optical assembly turns.
 const lightDirection=Math.atan2(p.y*.65,p.x||.01);
 c.beginPath();c.arc(0,0,183,lightDirection-.36,lightDirection+.36);c.strokeStyle='#ff2020';c.lineWidth=2;c.shadowColor='#ff0000';c.shadowBlur=11;c.stroke();c.shadowBlur=0;
 c.restore();
 // Glass reflections move with the lens across the dark metal, without hiding its seams.
 const reflection=c.createRadialGradient(cx+p.x*.75,cy+p.y*.7,28,cx+p.x*.75,cy+p.y*.7,220);reflection.addColorStop(0,'rgba(255,20,15,.03)');reflection.addColorStop(.52,'rgba(255,8,5,.14)');reflection.addColorStop(1,'rgba(255,0,0,0)');
 c.globalCompositeOperation='screen';c.fillStyle=reflection;c.fillRect(cx-250,cy-180,500,360);c.restore();
}
