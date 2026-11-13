import type { ReactNode } from 'react';
import { renderMarkdown } from '@/entities/doc';
import { Clip } from '@/features/clip';
import { Download } from '@/features/download';
import { InstallCommand } from '@/features/install-command';
import { Tour } from '@/features/tour';
import { rich } from '@/shared/lib/rich';
import { Action, Check, Copy, GitHubIcon, Panel, SectionHead } from '@/shared/ui';
import { LoopCard } from '@/widgets/loop';
import { BLOCKS, BUILDS, CARD, CLIP, ONE_WAY, PROSE, THREE_WAYS, TOUR } from './samples';

/** A component shown as it is: its name, where it lives, when to use it, and the thing itself. */
function Specimen({ id, title, from, children, note }: { id: string; title: string; from: string; note: string; children: ReactNode }) {
  return (
    <section className="kit-spec" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <p className="kit-meta">
        <code>{from}</code>
      </p>
      <p className="kit-note">{rich(note)}</p>
      <div className="kit-stage">{children}</div>
    </section>
  );
}

/** The install command, alive: the page's script mounts the component over this markup. */
function Install({ tabs }: { tabs: [string, string][] }) {
  return (
    <div data-island="install" data-tabs={JSON.stringify(tabs)}>
      <InstallCommand tabs={tabs} />
    </div>
  );
}

/** Every component of the landing and the docs, drawn by the code the pages use. */
export function Components() {
  return (
    <section className="kit-section" aria-labelledby="components">
      <h2 id="components">Components</h2>

      <Specimen id="headline" title="Headline" from="widgets/hero" note="One a page. Its first word may stand on a chip: the one place white is used as a fill beside the focus ring.">
        <p className="hero-title">
          <span className="hero-lead">
            <span className="hero-chip">Fast</span>,
          </span>{' '}
          and everything after it
        </p>
        <p className="lede">{rich('The lede: what it is and who it is for, with `code` where a name is a command.')}</p>
        <p className="hero-under">
          The small line · platforms · <a href="#headline">a link</a>
        </p>
      </Specimen>

      <Specimen id="install" title="Install command" from="features/install-command" note="The page's one action: a command and its Copy. With several ways in it gets tabs (one tab stop; the arrows, Home and End move between them).">
        <Install tabs={ONE_WAY} />
        <Install tabs={THREE_WAYS} />
      </Specimen>

      <Specimen id="download" title="Download" from="features/download" note="For a product that is an app, the page's first action: the build for the reader's system (the first build until the page runs, and where the system has none), the page's other ways in beside it as outlined actions, and under the row one quiet line: what the build needs and the other builds as links. The install command is for a product with no builds.">
        <div data-island="download" data-builds={JSON.stringify(BUILDS)}>
          <Download builds={BUILDS}>
            <Action href="#download">Get started</Action>
          </Download>
        </div>
      </Specimen>

      <Specimen id="tour" title="Tour and chapters" from="features/tour, shared/ui/Chapters" note="An app's window in a few stills of one size, in the hero in place of the recording. The scenes follow each other while the frame is in view, and never with reduced motion. The row under it is the recording's too: a chapter goes to its part and stops the turning, and the button at the right plays or pauses.">
        <div data-island="tour" className="kit-tour" data-tour={JSON.stringify(TOUR)}>
          <Tour tour={TOUR} />
        </div>
      </Specimen>

      <Specimen id="clip" title="Clip" from="features/clip" note="An app at work in a short silent clip, in the hero in place of the stills, or beside a card's words. It plays while it is in view, never with reduced motion, and its controls play it by hand. Its size holds its room before it loads; its poster stands until it plays.">
        <div data-island="clip" className="kit-clip" data-clip={JSON.stringify(CLIP)}>
          <Clip clip={CLIP} />
        </div>
      </Specimen>

      <Specimen id="panel" title="Panel" from="shared/ui/Panel" note="What a program printed. It scrolls sideways instead of wrapping, and is reachable by keyboard when it does. Its content is blocks:">
        <div className="kit-grid">
          {BLOCKS.map(({ name, text, blocks }) => (
            <div key={name}>
              <p className="kit-meta">
                <code>{name}</code> {rich(text)}
              </p>
              <Panel blocks={blocks} label={`A panel of ${name}`} />
            </div>
          ))}
        </div>
      </Specimen>

      <Specimen id="card" title="Card" from="widgets/loop" note="A claim and what shows it. On the landing the cards stack: each sticks under the bar while the next slides over it, where the window is tall enough for a whole card.">
        <LoopCard card={CARD} />
      </Specimen>

      <Specimen id="section-head" title="Section heading" from="shared/ui" note="Each section of the landing opens with one: its heading, and at the right a short aside, a count, a line or a link, set as a label.">
        <SectionHead id="section-head-sample" title="A section" aside={<p className="label">An aside</p>} />
      </Specimen>

      <Specimen id="links" title="Actions and icons" from="shared/ui" note="A link that is the thing to do next is an action: a pill, filled for the one to take first, and one filled action to a view. A link in the bar or the footer is a colour step instead. Icons take the text's colour.">
        <p className="kit-actions">
          <Action href="#links" filled>
            The first action
          </Action>
          <Action href="#links">Another</Action>
        </p>
        <p className="kit-icons">
          <GitHubIcon size={20} />
          <Copy />
          <Check />
        </p>
      </Specimen>

      <Specimen id="docs-cards" title="Docs cards and labels" from="pages/docs" note="The docs index: a label, a group, and its pages as cards whose text is cut at three lines.">
        <p className="docs-label">A label</p>
        <ul className="docs-cards">
          {['A page', 'Another page', 'A third'].map((title) => (
            <li key={title}>
              <a href="#docs-cards">
                <span className="docs-card-title">{title}</span>
                <span className="docs-card-text">Its first paragraph, shortened to a sentence or two, says what the page covers.</span>
              </a>
            </li>
          ))}
        </ul>
        <footer className="docs-foot">
          <a className="docs-turn" href="#docs-cards">
            <span aria-hidden="true">←</span>
            <span className="docs-turn-title">The page before</span>
          </a>
          <a className="docs-edit" href="#docs-cards">
            Edit on GitHub
          </a>
          <a className="docs-turn docs-turn-next" href="#docs-cards">
            <span className="docs-turn-title">The page after</span>
            <span aria-hidden="true">→</span>
          </a>
        </footer>
      </Specimen>

      <Specimen id="prose" title="Prose" from="entities/doc" note="A docs page's text, written in markdown: headings with anchors, lists, code blocks with a Copy, tables that scroll inside their frame on a phone.">
        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(PROSE) }} />
      </Specimen>
    </section>
  );
}
