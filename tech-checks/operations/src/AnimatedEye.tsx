import { useEffect, useRef } from 'react';
import { posterArtwork, companyArtwork } from './eyeArtwork';
import { mountRobotEye } from './robotEyeRuntime';
import './animatedEye.css';

/** The approved robotic eye, shared by every Operations branding slot. */
export default function AnimatedEye({ variant = 'header', full = false }: { variant?: 'header' | 'brand' | 'hero' | 'avatar'; full?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && canvasRef.current) return mountRobotEye(ref.current, canvasRef.current);
  }, [full]);
  return (
    <span ref={ref}
      className={`company-eye${full ? ' cos-company-logo' : ''} cos-eye-${variant}${variant === 'header' ? ' company-brand-mark' : ''}`}
      data-company-logo={full ? 'full' : 'eye'} data-cos-eye='approved' data-motion-paused='true'
      role='img' aria-label='Cameras Onsite'
    >
      <img className='company-eye-housing cos-eye-poster' src={full ? companyArtwork : posterArtwork} alt='' aria-hidden='true' />
      <span className='cos-eye-live' aria-hidden='true'>
        <canvas ref={canvasRef} width='144' height='144' />
      </span>
    </span>
  );
}
