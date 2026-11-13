import { useRef } from 'react';
import { useReveal } from '@/shared/lib/reveal';
import { Closing } from '@/widgets/closing';
import { Footer } from '@/widgets/footer';
import { Hero } from '@/widgets/hero';
import { Loop } from '@/widgets/loop';
import { Nav } from '@/widgets/nav';
import { Releases } from '@/widgets/releases';
import { Roster } from '@/widgets/roster';

/** The landing: the hero, the cards as a stack, the docs as an index, the releases, and how to
 *  start. What is under the window's edge comes in as it is reached. */
export function LandingPage() {
  const main = useRef<HTMLElement>(null);
  useReveal(main);
  return (
    <>
      <Nav />
      <main id="main" ref={main}>
        <Hero />
        <Loop />
        <Roster />
        <Releases />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
