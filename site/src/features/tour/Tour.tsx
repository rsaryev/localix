import { useEffect, useRef, useState } from 'react';
import type { Tour as TourContent } from '@/shared/config';
import { Chapters } from '@/shared/ui';
import './Tour.css';

/** How long a scene stands before the next takes its place. */
const STAY = 5000;

/**
 * The product in a few stills of one size, one over another in one frame. The scenes follow each
 * other while the frame is in view; a scene's name under it shows that scene and stops the
 * turning, and Play starts it again. With reduced motion nothing turns by itself. Only the first
 * still is in the page as it is built: the rest are added once it runs, so none holds up the
 * first paint.
 */
export function Tour({ tour }: { tour: TourContent }) {
  const { scenes, width, height, label } = tour;
  const frame = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [alive, setAlive] = useState(false);
  const [turning, setTurning] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    setAlive(true);
    setTurning(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const node = frame.current;
    if (!node) return;
    const watch = new IntersectionObserver(([entry]) => setSeen(Boolean(entry?.isIntersecting)), { threshold: 0.4 });
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    if (!turning || !seen || scenes.length < 2) return;
    const timer = window.setTimeout(() => setShown((at) => (at + 1) % scenes.length), STAY);
    return () => window.clearTimeout(timer);
  }, [turning, seen, shown, scenes.length]);

  return (
    <>
      <div ref={frame} className="tour" role="group" aria-label={label} style={{ aspectRatio: `${width} / ${height}` }}>
        {scenes.map(
          (scene, at) =>
            (alive || at === 0) && (
              <img
                key={scene.src}
                src={scene.src}
                alt={scene.alt}
                width={width}
                height={height}
                decoding="async"
                fetchPriority={at === 0 ? 'high' : 'low'}
                aria-hidden={at === shown ? undefined : true}
                data-shown={at === shown ? '' : undefined}
              />
            ),
        )}
      </div>
      {scenes.length > 1 && (
        <Chapters
          labels={scenes.map((scene) => scene.label)}
          current={shown}
          onPick={(at) => {
            setShown(at);
            setTurning(false);
          }}
          toggle={{ label: turning ? 'Pause' : 'Play', disabled: !alive, onPress: () => setTurning((now) => !now) }}
        />
      )}
    </>
  );
}
