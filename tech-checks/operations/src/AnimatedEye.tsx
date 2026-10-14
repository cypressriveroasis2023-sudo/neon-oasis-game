import { useEffect, useRef } from 'react';
import { posterArtwork } from './eyeArtwork';
import { mountRobotEye } from './robotEyeRuntime';
import './animatedEye.css';

/** The approved robotic eye, shared by every Operations branding slot. */
export default function AnimatedEye({ variant = 'header' }: { variant?: 'header' | 'brand' | 'hero' | 'avatar' }) {
  const ref = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && canvasRef.current) return mountRobotEye(ref.current, canvasRef.current);
  }, []);
  return (
    <svg ref={ref}
      className={`company-eye cos-eye-${variant}${variant === 'header' ? ' company-brand-mark' : ''}`}
      data-cos-eye='approved' data-motion-paused='true'
      viewBox='0 0 720 720' width='38' height='38'
      role='img' aria-label='Cameras Onsite'
    >
      <image className='company-eye-housing cos-eye-poster' href={posterArtwork} width='720' height='720' />
      <foreignObject className='cos-eye-live' width='720' height='720' aria-hidden='true'>
        <canvas ref={canvasRef} width='144' height='144' />
      </foreignObject>
    </svg>
  );
}
