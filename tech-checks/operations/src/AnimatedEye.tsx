import { useEffect, useId, useRef } from 'react';
import { housingArtwork, lensArtwork } from './eyeArtwork';
import './animatedEye.css';

/** Presentation only: the approved fixed housing and subtle horizontal glance. */
export default function AnimatedEye({ variant = 'header' }: { variant?: 'header' | 'brand' | 'hero' | 'avatar' }) {
  const ref = useRef<SVGSVGElement>(null);
  const apertureId = `cos-eye-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let intersecting = false;
    const sync = () => {
      element.dataset.motionPaused = String(document.hidden || !intersecting);
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      sync();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return (
    <svg
      ref={ref}
      className={`company-eye cos-eye-${variant}${variant === 'header' ? ' company-brand-mark' : ''}`}
      data-cos-eye='approved'
      viewBox='0 0 1254 1254'
      width='38'
      height='38'
      role='img'
      aria-label='Cameras Onsite'
      data-motion-paused='true'
    >
      <defs>
        <clipPath id={apertureId}>
          <path d='M 279 585 C 386 463 501 404 625 404 C 750 404 869 470 975 584 C 869 697 744 758 627 758 C 503 758 381 690 279 585 Z' />
        </clipPath>
      </defs>
      <image className='company-eye-housing' href={housingArtwork} width='1254' height='1254' />
      <g clipPath={`url(#${apertureId})`}>
        <g className='company-eye-gaze'>
          <image href={lensArtwork} x='422' y='375' width='410' height='410' />
        </g>
      </g>
    </svg>
  );
}
