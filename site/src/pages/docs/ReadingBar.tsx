import { GROUPS, type DocPage } from '@/entities/doc';
import { DOCS } from '@/shared/config';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Type } from '@/shared/ui';

type Item = { href: string; label: string; active: boolean };

/** From this many rows a menu gets a field to filter them: a shorter list is read at a glance. */
const FILTERED = 8;
const SIZES = [
  ['', 'Standard text'],
  ['large', 'Large text'],
  ['larger', 'Larger text'],
] as const;

/** One step of the path: its name, and a menu of what stands beside it. The menu is the browser's
 *  own popover of plain links, so it opens, closes on Esc and goes somewhere with no script; the
 *  page's script only puts it under its step and moves through it with the arrows. */
function Crumb({ id, label, items, current }: { id: string; label: string; items: Item[]; current?: boolean }) {
  return (
    <li>
      <button type="button" className="crumb" popoverTarget={id} aria-current={current ? 'page' : undefined}>
        <span>{label}</span>
        <ChevronDown />
      </button>
      <div id={id} popover="auto" className="menu" aria-label={label}>
        {items.length >= FILTERED && <input type="search" placeholder="Filter pages…" aria-label="Filter pages" autoComplete="off" />}
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              <a href={item.href} aria-current={item.active ? 'true' : undefined}>
                <span>{item.label}</span>
                <Check />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

function Step() {
  return (
    <li className="crumb-step" aria-hidden="true">
      <ChevronRight />
    </li>
  );
}

/** What stays over a docs page as it is read: the way back, the path to the page (each step a
 *  menu of its neighbours: the docs' only menu on a phone), and the text's size. */
export function ReadingBar({ page }: { page?: DocPage | undefined }) {
  const group = page && GROUPS.find((candidate) => candidate.title === page.group);
  const pages = (group?.pages ?? []).map((other) => ({ href: other.route, label: other.title, active: other === page }));
  const groups = GROUPS.flatMap((other) => {
    const first = other.pages[0];
    return first ? [{ href: first.route, label: other.title, active: other === group }] : [];
  });
  return (
    <div className="docs-bar">
      <a className="docs-bar-button" href={page ? DOCS : '/'} data-back aria-label="Back">
        <ArrowLeft />
      </a>
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          <Crumb id="crumb-home" label="Home" items={[{ href: '/', label: 'Home', active: false }, { href: DOCS, label: 'Docs', active: true }]} />
          <Step />
          <Crumb id="crumb-docs" label="Docs" items={groups} current={!page} />
          {page && group && (
            <>
              <Step />
              <Crumb id="crumb-group" label={group.title} items={pages} />
              <Step />
              <Crumb id="crumb-page" label={page.title} items={pages} current />
            </>
          )}
        </ol>
      </nav>
      {page && (
        <>
          <button type="button" className="docs-bar-button" popoverTarget="reading-size" aria-label="Reading options" data-size-open hidden>
            <Type />
          </button>
          <div id="reading-size" popover="auto" className="menu menu-end" aria-label="Reading options">
            <ul>
              {SIZES.map(([size, label]) => (
                <li key={size}>
                  <button type="button" data-size={size} role="menuitemradio" aria-checked={size === ''}>
                    <span>{label}</span>
                    <Check />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
