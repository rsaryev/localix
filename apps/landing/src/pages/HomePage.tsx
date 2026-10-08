import { DownloadChooser } from '@/components/DownloadChooser'
import { ProductVideo } from '@/components/ProductVideo'
import { SectionNav } from '@/components/SectionNav'
import { AfterFirstPaint } from '@/components/home/AfterFirstPaint'
import { HeroBird } from '@/components/home/HeroBird'
import { Section } from '@/components/home/Reveal'
import { WorkflowCarousel } from '@/components/home/WorkflowCarousel'
import { WorkbenchCarousel } from '@/components/home/WorkbenchCarousel'
import '../components/home/workflow-carousel.css'
import { SECTIONS } from './homeContent'

export function HomePage() {
  return (
    <>
      <SectionNav sections={SECTIONS} />

      <Section
        id="intro"
        reveal={false}
        snap={false}
        className="relative pb-12 pt-8 md:pb-24 md:pt-16"
      >
        <div className="hero-layout relative">
          <div className="hero-copy min-w-0">
            <h1 className="display text-[2.5rem] sm:text-[3.25rem] lg:text-[3.75rem] xl:text-[4.25rem]">
              One workspace for you and a team of agents
            </h1>
            <p className="lede text-lg">
              An open source workspace where you and your agents share the editor, terminals,
              preview, and databases.
            </p>
            <DownloadChooser className="hero-actions" />
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

      <Section id="workflow" className="border-t border-border-subtle py-16 md:py-24">
        <WorkflowCarousel />
      </Section>
      <Section id="workbenches" className="border-t border-border-subtle py-16 md:py-24">
        <p className="mb-6 text-sm text-text-soft">Built into your workspace</p>
        <WorkbenchCarousel />
      </Section>
    </>
  )
}
