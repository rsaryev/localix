import { type RefObject, useEffect } from 'react';

/** Brings each `.reveal` under `root` in once, as it scrolls into view. Only what is under the
 *  window's edge when the page starts is made to wait, so nothing in view ever blinks, and with
 *  no script or with reduced motion the page simply stands. */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const waiting = [...(root.current?.querySelectorAll<HTMLElement>('.reveal') ?? [])].filter(
      (target) => target.getBoundingClientRect().top > window.innerHeight,
    );
    const seen = new IntersectionObserver(
      (entries) => {
        // What enters together arrives in turn, 50 ms apart, six steps at most.
        let order = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          target.style.setProperty('--stagger', `${Math.min(order++, 6) * 50}ms`);
          target.removeAttribute('data-waits');
          seen.unobserve(target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    for (const target of waiting) {
      target.setAttribute('data-waits', '');
      seen.observe(target);
    }
    return () => seen.disconnect();
  }, [root]);
}
