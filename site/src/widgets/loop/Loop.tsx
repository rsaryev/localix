import { type CSSProperties, useEffect, useRef } from 'react';
import { type Card, LANDING } from '@/shared/config';
import { rich } from '@/shared/lib/rich';
import { SectionHead } from '@/shared/ui';
import { CardMedia } from './CardMedia';
import './Loop.css';

/** The cards one after another, each held under the bar while the next slides over it; a
 *  terminal's lines come in once it is seen. A card is told its height, so one taller than the
 *  window is held by its end instead and is still read whole. Without script everything stands. */
export function Loop() {
  const root = useRef<HTMLElement>(null);
  const { title, aside, cards } = LANDING.loop;

  useEffect(() => {
    const cards = [...(root.current?.querySelectorAll<HTMLElement>('.loop-card') ?? [])];
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-reveal', 'seen');
          seen.unobserve(entry.target);
        }
      },
      { threshold: 0.35 },
    );
    const sized = new ResizeObserver((entries) => {
      for (const entry of entries) (entry.target as HTMLElement).style.setProperty('--h', `${entry.borderBoxSize[0]?.blockSize ?? 0}px`);
    });
    for (const card of cards) {
      if (card.getBoundingClientRect().top > window.innerHeight) card.setAttribute('data-reveal', 'wait');
      seen.observe(card);
      sized.observe(card);
    }
    root.current?.setAttribute('data-stack', '');
    return () => {
      seen.disconnect();
      sized.disconnect();
    };
  }, []);

  return (
    <section ref={root} className="loop wrap" aria-labelledby="loop-title">
      <SectionHead id="loop-title" title={title} aside={aside && <p className="label">{aside}</p>} />
      <div className="loop-stack">
        {cards.map((card, index) => (
          <LoopCard key={card.title} card={card} index={index} />
        ))}
      </div>
    </section>
  );
}

/** One card: its label, what it says, where to read more, and beside the words what shows it.
 *  `index` is its place in the stack (each sticks a little lower than the one before). */
export function LoopCard({ card, index = 0 }: { card: Card; index?: number }) {
  return (
    <article className={card.media ? 'loop-card' : 'loop-card loop-card-plain'} style={{ '--n': index } as CSSProperties}>
      <div className="loop-text">
        {card.tag && <p className="label">{card.tag}</p>}
        <h3>{card.title}</h3>
        <p>{rich(card.text)}</p>
        {card.links && card.links.length > 0 && (
          <p className="loop-links">
            {card.links.map((link) => (
              <a key={link.href} className="label" href={link.href}>
                {link.label}
              </a>
            ))}
          </p>
        )}
      </div>
      {card.media && (
        <div className="loop-media">
          <CardMedia media={card.media} title={card.title} />
        </div>
      )}
    </article>
  );
}
