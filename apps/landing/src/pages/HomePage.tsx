import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { DownloadChooser } from '@/components/DownloadChooser'
import { AfterFirstPaint } from '@/components/home/AfterFirstPaint'
import { HeroBird } from '@/components/home/HeroBird'
import { HomeMotion } from '@/components/home/motion'
import { Section } from '@/components/home/Reveal'
import { RevealHeading } from '@/components/home/RevealHeading'
import { DemoFilm } from '@/components/home/DemoFilm'
import { Features } from '@/components/home/Features'
import '../components/home/films.css'

/** The page's two actions. */
function HomeActions({ className }: { className?: string }) {
  return (
    <div className={className}>
      <DownloadChooser className="w-auto" />
      <Button asChild variant="ghost" size="xl" className="min-h-11 gap-2 px-3 text-text-soft">
        <Link to="/docs" className="group/cue">
          <span className="font-heading font-medium">Read the docs</span>
          <ArrowRight aria-hidden className="arrow-cue" />
        </Link>
      </Button>
    </div>
  )
}

export function HomePage() {
  return (
    <HomeMotion>
      <Section
        id="intro"
        reveal={false}
        snap={false}
        className="relative pb-16 pt-8 md:pb-24 md:pt-16"
      >
        <div className="hero-layout relative">
          <div className="hero-copy min-w-0">
            <RevealHeading
              text="The Agentic Development Environment"
              breakAfter={2}
              className="display text-[2.5rem] sm:text-[3.25rem] lg:text-[4rem] xl:text-[4.75rem]"
            />
            <p className="lede hero-rise text-lg">
              A team of AI agents works with you in one desktop app: your editor, terminals and
              browser. Any model, or run one on your own computer.
            </p>
            <HomeActions className="hero-actions hero-rise" />
          </div>
          <div
            className="hero-bird-slot relative flex min-w-0 items-center justify-center"
            aria-hidden="true"
          >
            <AfterFirstPaint>
              <HeroBird />
            </AfterFirstPaint>
          </div>
        </div>
        <DemoFilm />
      </Section>
      <Features />
    </HomeMotion>
  )
}
