import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { DownloadChooser } from '@/components/DownloadChooser'
import { ProductVideo } from '@/components/ProductVideo'
import { SectionNav } from '@/components/SectionNav'
import { AfterFirstPaint } from '@/components/home/AfterFirstPaint'
import { HeroBird } from '@/components/home/HeroBird'
import { HomeMotion } from '@/components/home/motion'
import { Section } from '@/components/home/Reveal'
import { RevealHeading } from '@/components/home/RevealHeading'
import { ChapterFilm } from '@/components/home/ChapterFilm'
import { PlatformBento } from '@/components/home/PlatformBento'
import '../components/home/films.css'
import '../components/home/bento.css'
import '../components/home/cards/chrome.css'
import '../components/home/cards/plugin-scene.css'
import '../components/home/cards/plugin-motion.css'
import '../components/home/cards/browser-scene.css'
import '../components/home/cards/context-scene.css'
import '../components/home/cards/team-scene.css'
import '../components/home/cards/agent-scenes.css'
import '../components/home/cards/space-scene.css'
import '../components/home/cards/island-scene.css'
import '../components/home/cards/tool-scenes.css'
import '../components/home/cards/tool-motion.css'
import '../components/home/cards/board-scene.css'
import '../components/home/cards/board-motion.css'
import '../components/home/cards/ops-scenes.css'
import '../components/home/cards/devops-scene.css'
import '../components/home/cards/ops-motion.css'
import { SECTIONS } from './homeContent'

/** The page's two actions, the same in the hero and at the close. */
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
      <SectionNav sections={SECTIONS} />

      <Section
        id="intro"
        reveal={false}
        snap={false}
        className="relative pb-12 pt-8 md:pb-24 md:pt-16"
      >
        <div className="hero-layout relative">
          <div className="hero-copy min-w-0">
            <RevealHeading
              text="One workspace for you and a team of agents"
              className="display text-[2.5rem] sm:text-[3.25rem] lg:text-[3.75rem] xl:text-[4.25rem]"
            />
            <p className="lede hero-rise text-lg">
              An open source workspace where you and your agents share the editor, terminals,
              preview, and databases.
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
        <ProductVideo className="mt-12 md:mt-16" />
      </Section>

      <Section id="workspace" className="py-16 md:py-28">
        <ChapterFilm />
      </Section>

      <Section id="platform" className="py-16 md:py-28">
        <PlatformBento />
      </Section>

      <Section id="start" className="pb-24 pt-16 md:pb-36 md:pt-28">
        <div className="closing">
          <h2 className="section-heading section-title">
            Try it on your next change.{' '}
            <span className="text-text-faint">
              Localix is open source, and every guide is public.
            </span>
          </h2>
          <HomeActions className="closing-actions" />
        </div>
      </Section>
    </HomeMotion>
  )
}
