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
import {
  SECTIONS,
  AUTONOMY_FEATURES,
  BROWSER_FEATURES,
  CONTEXT_FEATURES,
  EXTERNAL_FEATURES,
  CONVERSATION_FEATURES,
  CONTROL_FEATURES,
  CRAFT_FEATURES,
  KANBAN_FEATURES,
  PLUGIN_FEATURES,
  PLUGINS,
  SECTION_GUIDES,
  SPACE_FEATURES,
} from './homeContent'

const CARD_GRID = 'mt-14 grid gap-x-8 gap-y-8 md:grid-cols-2 xl:grid-cols-4'

export function HomePage() {
  return (
    <>
      <SectionNav sections={SECTIONS} />

      <Section
        id="intro"
        reveal={false}
        snap={false}
        className="relative pb-20 pt-24 md:pb-28 md:pt-28"
      >
        <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(24rem,0.92fr)] lg:gap-0">
          <div className="relative z-10 max-w-4xl">
            <p className="eyebrow mb-5">
              Localix <span className="text-text-faint">· {RELEASE_CHANNEL}</span>
            </p>
            <h1 className="display text-balance text-[2.5rem] sm:text-[3.25rem] lg:text-[3.75rem] xl:text-[4.25rem]">
              One workspace for you and a team of agents
            </h1>
            <p className="lede mt-6 text-lg md:text-xl">
              Localix is an open source{' '}
              <span
                className="group/ade relative inline-block cursor-help rounded-sm border-b border-dashed border-text-faint outline-none focus-ring"
                tabIndex={0}
                aria-describedby="ade-expansion"
              >
                ADE
                <span
                  id="ade-expansion"
                  role="tooltip"
                  className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-max max-w-[min(20rem,80vw)] translate-y-1 rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 font-sans text-xs font-medium tracking-normal text-text-soft opacity-0 shadow-[var(--shadow-soft)] transition-[opacity,transform] duration-150 group-hover/ade:translate-y-0 group-hover/ade:opacity-100 group-focus-within/ade:translate-y-0 group-focus-within/ade:opacity-100"
                >
                  Agentic Development Environment
                </span>
              </span>
              . Several agents work in one conversation across the editor, terminals, preview,
              databases, and a shared board, and an agent builds the plugins you are missing.
            </p>
            <DownloadChooser className="mt-8 max-w-2xl" />
          </div>
          <div className="relative z-0 hidden min-h-[22rem] items-center justify-center md:flex lg:-ml-28 lg:min-h-[30rem]">
            <AfterFirstPaint>
              <HeroBird />
            </AfterFirstPaint>
          </div>
        </div>
        <ProductVideo className="mt-10 lg:mt-14" />
      </Section>

      <Section id="conversations" className="border-t border-border-subtle py-20 md:py-28">
        <SectionLede
          eyebrow="Multi-agent conversations"
          title="Work with a team of agents in one conversation"
          guide={SECTION_GUIDES.conversations}
          shot="conversations/participants"
          shotAlt="One conversation with several agent participants, their roles, and who is answering now"
        >
          A conversation can have several agents as participants, all reading one shared transcript.
          Add them from the composer, address them by{' '}
          <code className="font-mono text-[0.9em]">@handle</code>, and let an agent bring in a
          colleague when the work calls for one. Each agent keeps its own role, rules, and model.
        </SectionLede>
        <Stagger className={CARD_GRID}>
          {CONVERSATION_FEATURES.map((feature) => (
            <FeatureLinkCard key={feature.title} {...feature} />
          ))}
        </Stagger>
      </Section>

      <Section id="context" className="border-t border-border-subtle py-20 md:py-28">
        <SectionLede
          eyebrow="Connected context"
          title="Context follows the work"
          guide={SECTION_GUIDES.context}
          shot="context/composer-context"
          shotAlt="The composer listing the files, selections, and terminals attached to the next message"
        >
          Link the conversation to the file, terminal, preview, task, document, or live resource in
          front of you. References stay addressable, so an agent&rsquo;s result leads back to the
          surface that produced it instead of an untraceable text fragment.
        </SectionLede>
        <Stagger className={CARD_GRID}>
          {CONTEXT_FEATURES.map((row) => (
            <FeatureLinkCard key={row.title} {...row} />
          ))}
        </Stagger>
      </Section>

      <Section id="external" className="border-t border-border-subtle py-20 md:py-28">
        <SectionLede
          eyebrow="External agents"
          title="Keep your CLI conversations connected to the work"
          guide={SECTION_GUIDES.external}
          shot="external-agents/history"
          shotAlt="External agent history and a linked native conversation"
        >
          Read the sessions from installed coding-agent CLIs, link them as context, or continue them
          in a terminal. History and statistics share Localix and External tabs.
        </SectionLede>
        <Stagger className={CARD_GRID}>
          {EXTERNAL_FEATURES.map((feature) => (
            <FeatureLinkCard key={feature.title} {...feature} />
          ))}
        </Stagger>
      </Section>

      <Section id="space" className="border-t border-border-subtle py-20 md:py-28">
        <SectionLede
          eyebrow="Project Space"
          title="A board that you and the agents share"
          guide={SECTION_GUIDES.space}
          shot="project-space/board"
          shotAlt="A Project Space board with notes, a diagram, and live file cards the agent is arranging"
        >
          Every project has one spatial board for notes, diagrams, mind maps, tables, and live cards
          for its files and sessions. You and the agent edit the same file, and the agent can walk
          you through it, moving your view and lighting up what it points at.
        </SectionLede>
        <Stagger className={CARD_GRID}>
          {SPACE_FEATURES.map((feature) => (
            <FeatureLinkCard key={feature.title} {...feature} />
          ))}
        </Stagger>
      </Section>

      <Section id="browser" className="border-t border-border-subtle py-20 md:py-28">
        <SectionLede
          eyebrow="Agent browser and Visual Feedback"
          title="The agent works in the preview you are looking at"
          guide={SECTION_GUIDES.browser}
          shot="browser/agent-preview"
          shotAlt="The built-in preview beside the session, with an element picked for Visual Feedback"
        >
          Localix runs your app in a built-in preview, and the agent drives that same page. It reads
          a compact tree of the elements, acts in batches, and checks the console, a screenshot, and
          responsive sizes before it reports back. The preview needs no install and starts no second
          browser.
        </SectionLede>
        <Stagger className={CARD_GRID}>
          {BROWSER_FEATURES.map((feature) => (
            <FeatureLinkCard key={feature.title} {...feature} />
          ))}
        </Stagger>
      </Section>

      <Section id="plugins" snap={false} className="border-t border-border-subtle py-20 md:py-28">
        <SectionLede
          eyebrow="Plugins"
          title="Whatever you are working on gets its own workbench"
          guide={SECTION_GUIDES.plugins}
          shot="plugins/agent-build"
          shotAlt="A plugin the agent built from one description, open as a workbench next to the chat"
        >
          Describe what you need, such as a calorie tracker, a release dashboard, or a board for
          your team. An agent builds the interface and the tools together and opens it next to the
          chat. Localix&rsquo;s own Kanban board, DevOps, Project Space, and Code Graph are plugins
          built with agents on the same contract.
        </SectionLede>
        <Stagger className={CARD_GRID}>
          {PLUGIN_FEATURES.map((feature) => (
            <FeatureLinkCard key={feature.title} {...feature} />
          ))}
        </Stagger>

        <div className="mt-20 max-w-2xl">
          <p className="eyebrow mb-3">Bundled workbenches</p>
          <h3 className="section-title text-2xl md:text-3xl">A workbench per domain, ready now</h3>
          <p className="lede mt-4">
            These ship with Localix and use the same plugin contract as the ones you build.
          </p>
        </div>
        <Stagger className={CARD_GRID}>
          {PLUGINS.map((plugin) => (
            <FeatureLinkCard key={plugin.title} {...plugin} />
          ))}
        </Stagger>
        <div className="mt-14 flex flex-col gap-3 border-t border-border-subtle pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-text-soft">
            Plugins run unsandboxed in the Localix process, the ones the agent builds included.
          </p>
          <Link
            to="/docs/extending--build-with-the-agent"
            className="group/cue inline-flex w-fit items-center gap-2 rounded-sm text-sm font-medium text-foreground outline-none focus-ring"
          >
            Build a plugin with the agent
            <ArrowCue reveal={false} className="text-text-faint" />
          </Link>
        </div>
      </Section>

      <Section id="craft" className="border-t border-border-subtle py-20 md:py-28">
        <SectionLede
          eyebrow="Design"
          title="Built as one system, not a pile of panels"
          guide={SECTION_GUIDES.craft}
          shot="workspace/craft"
          shotAlt="The workspace in its dark and light themes, with the command palette open"
        >
          The workspace, the Project Space board, and every plugin draw from one design kit, so a
          workbench the agent builds looks and behaves like the ones that ship.
        </SectionLede>
        <Stagger className={CARD_GRID}>
          {CRAFT_FEATURES.map((feature) => (
            <FeatureLinkCard key={feature.title} {...feature} />
          ))}
        </Stagger>
      </Section>

      <Section id="autonomy" className="border-t border-border-subtle py-20 md:py-28">
        <SectionLede
          eyebrow="Long-running work"
          title="Set it going, and let it wake you"
          guide={SECTION_GUIDES.autonomy}
          shot="autonomy/background-work"
          shotAlt="The composer strip listing a running loop, a monitor, and a background job"
        >
          Loops run a prompt on a schedule or at a pace the agent sets. Monitors watch a command and
          wake the agent when it passes. Plans are versioned, with comments and diffs between
          versions. All of it runs while Localix is open.
        </SectionLede>
        <Stagger className={CARD_GRID}>
          {AUTONOMY_FEATURES.map((feature) => (
            <FeatureLinkCard key={feature.title} {...feature} />
          ))}
        </Stagger>
      </Section>

      <Section id="control" className="border-t border-border-subtle py-20 md:py-28">
        <SectionLede
          eyebrow="Models and control"
          title="Choose the model, then bound what the run may do"
          guide={SECTION_GUIDES.control}
          shot="providers/model-browser"
          shotAlt="The model browser showing connections, context limits, and reasoning levels"
        >
          The model browser routes each workload to its own provider and model, and the
          session&rsquo;s mode and permission rules decide which tool calls go through.
        </SectionLede>
        <Stagger className={CARD_GRID}>
          {CONTROL_FEATURES.map((feature) => (
            <FeatureLinkCard key={feature.title} {...feature} />
          ))}
        </Stagger>
      </Section>

      <Section id="board" snap={false} className="border-t border-border-subtle py-20 md:py-28">
        <SectionLede
          eyebrow="Kanban board"
          title="Keep multi-part work on the chat's own board"
          guide={SECTION_GUIDES.board}
          shot="task-board/board"
          shotAlt="A chat's Kanban board with tasks, owners, and dependencies"
        >
          Create tasks yourself, or hand the agent a goal and let it build the epic. The board only
          records work: an agent takes a card or delegates it with a self-contained brief, and
          nothing on the board starts a run.
        </SectionLede>
        <Stagger className={CARD_GRID}>
          {KANBAN_FEATURES.map((feature) => (
            <FeatureLinkCard key={feature.title} {...feature} />
          ))}
        </Stagger>
      </Section>
    </>
  )
}
