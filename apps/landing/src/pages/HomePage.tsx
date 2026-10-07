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
        <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
          <div className="relative z-10 min-w-0">
            <h1 className="display text-[2.5rem] sm:text-[3.25rem] lg:text-[3.75rem] xl:text-[4.25rem]">
              One workspace for you and a team of agents
            </h1>
            <p className="lede mt-6 text-lg">
              An open source workspace where you and your agents share the editor, terminals,
              preview, and databases.
            </p>
            <DownloadChooser className="mt-8" />
          </div>
          <div className="relative z-0 hidden min-w-0 items-center justify-center lg:flex">
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
