import { Link } from 'react-router'
import { DownloadChooser } from '@/components/DownloadChooser'
import { RELEASE_CHANNEL } from '@/components/releaseChannel'
import { ProductVideo } from '@/components/ProductVideo'
import { SectionNav } from '@/components/SectionNav'
import { AfterFirstPaint } from '@/components/home/AfterFirstPaint'
import { HeroBird } from '@/components/home/HeroBird'
import { Section, Stagger } from '@/components/home/Reveal'
import { SectionLede } from '@/components/home/SectionLede'
import { ArrowCue, FeatureLinkCard } from '@/components/home/cards'
import { SECTIONS, PLUGINS, SECTION_GUIDES } from './homeContent'
import { WORKSPACE_LINKS, PLATFORM_OVERVIEW } from './homeOverview'

export function HomePage() {
  return (
    <>
      <SectionNav sections={SECTIONS} />

      <Section
        id="intro"
        reveal={false}
        snap={false}
        className="relative pb-16 pt-16 md:pb-24 md:pt-24"
      >
        <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
          <div className="relative z-10 min-w-0">
            <p className="mb-8 flex items-center gap-3 text-sm font-medium">
              Localix <span className="text-xs font-normal text-text-faint">{RELEASE_CHANNEL}</span>
            </p>
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

      <Section id="conversations" className="border-t border-border-subtle py-16 md:py-24">
        <SectionLede
          title="A team in one conversation"
          guide={SECTION_GUIDES.conversations}
          shot="conversations/participants"
          shotAlt="Several agents sharing one conversation, with their roles and active participant visible"
        >
          Bring agents into the same conversation. Give each a role and model, address them with
          @handle, and follow their work in one shared transcript.
        </SectionLede>
      </Section>

      <Section id="context" className="border-t border-border-subtle py-16 md:py-24">
        <SectionLede
          title="Keep the work in context"
          guide={SECTION_GUIDES.context}
          shot="context/composer-context"
          shotAlt="Files, selections, and terminals attached to the next message in the composer"
        >
          Link files, terminals, and live resources to the conversation. Open an agent&rsquo;s
          result right where the work happens.
        </SectionLede>
        <Stagger className="mt-10 grid gap-x-8 md:mt-12 md:grid-cols-3">
          {WORKSPACE_LINKS.map((feature) => (
            <FeatureLinkCard key={feature.title} {...feature} />
          ))}
        </Stagger>
      </Section>

      <Section id="plugins" className="border-t border-border-subtle py-16 md:py-24">
        <SectionLede
          title="Build the tool you need"
          guide={SECTION_GUIDES.plugins}
          shot="plugins/agent-build"
          shotAlt="A plugin built by an agent, open next to the conversation"
        >
          Describe a tracker, dashboard, or workbench. An agent builds its interface and tools from
          the same kit Localix uses.
        </SectionLede>
        <div className="mt-10 border-t border-border-subtle pt-6 md:mt-12">
          <div className="flex flex-col gap-4 lg:flex-row lg:gap-10">
            <p className="shrink-0 text-sm text-text-soft">Included workbenches</p>
            <ul className="flex flex-wrap gap-x-6 gap-y-3">
              {PLUGINS.map(({ title, slug, anchor }) => (
                <li key={title}>
                  <Link
                    to={`/docs/${slug}#${anchor}`}
                    className="rounded-sm text-sm text-text-soft outline-none transition-colors hover:text-foreground focus-ring"
                  >
                    {title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-6 text-xs leading-relaxed text-text-faint">
            Plugins run unsandboxed in the Localix process, including those built by an agent.
          </p>
        </div>
      </Section>

      <Section id="control" className="border-t border-border-subtle py-16 md:py-24">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
          <div>
            <h2 className="section-title text-3xl md:text-4xl">Your models. Your rules.</h2>
            <p className="lede mt-5 text-lg">
              Choose the model for each workload and decide which tools an agent may use.
            </p>
            <Link
              to={`/docs/${SECTION_GUIDES.control.slug}`}
              className="group/cue mt-6 inline-flex items-center gap-2 rounded-sm text-sm font-medium outline-none focus-ring"
            >
              Models and permissions
              <ArrowCue reveal={false} className="text-text-faint" />
            </Link>
          </div>
          <Stagger className="grid gap-x-8 sm:grid-cols-2">
            {PLATFORM_OVERVIEW.map((feature) => (
              <FeatureLinkCard key={feature.title} {...feature} />
            ))}
          </Stagger>
        </div>
      </Section>
    </>
  )
}
