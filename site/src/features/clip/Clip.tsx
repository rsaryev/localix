import { useEffect, useRef } from 'react';
import type { Clip as ClipContent } from '@/shared/config';
import './Clip.css';

/** A silent clip that plays only while it is seen, and not at all with reduced motion (its
 *  poster, or its first frame, stands instead; the controls are there to play it by hand). Its
 *  size is given, so its room is held before it loads. In the hero in place of the stills or the
 *  recording, and beside a card's words. */
export function Clip({ clip }: { clip: ClipContent }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void element.play().catch(() => {});
        else element.pause();
      },
      { threshold: 0.4 },
    );
    seen.observe(element);
    return () => seen.disconnect();
  }, []);
  return (
    <video
      ref={video}
      className="clip"
      src={clip.src || undefined}
      poster={clip.poster}
      width={clip.width}
      height={clip.height}
      aria-label={clip.label}
      muted
      loop
      playsInline
      controls
      preload="metadata"
    />
  );
}
