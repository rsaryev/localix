import type { CSSProperties, ReactNode } from 'react';
import { highlight } from '@/shared/lib/highlight';
import { Tokens } from './Code';
import './Panel.css';

/** A word's tone in a panel (the terminal's colours); '' is plain. */
export type Tone = 'dim' | 'hi' | 'ok' | 'bad' | 'acc' | 'sel' | '';
/** A cell of a table: its text, or its tone and text. */
export type Cell = string | [Tone, string];
/** A line of a drawn screen: its parts, each with a tone. */
export type Line = [Tone, string][];

/** What a panel shows, a block after a block. A `shell` session or `json` is plain text the
 *  highlighter colours; `out` is a line of output in one tone; `grid` is a table in real columns
 *  (`align`: `l` or `r` for each); `ui` is a screen of an interface, drawn by tone. */
export type Block =
  | { lang: 'shell' | 'json'; text: string }
  | { out: string; tone?: Tone }
  | { grid: Cell[][]; align?: string }
  | { ui: Line[] };

/** What a program printed, as a terminal shows it: monospace, scrolled sideways rather than
 *  wrapped. `label` says what it is to a screen reader. Each row carries its number (`--i`), for
 *  a parent that brings the lines in one by one. */
export function Panel({ blocks, label }: { blocks: Block[]; label: string }) {
  return (
    // A region that scrolls must be reachable by keyboard (WCAG 2.1.1): hence the tab stop.
    <pre className="panel" role="region" aria-label={label} tabIndex={0}>
      {rows(blocks)}
    </pre>
  );
}

const tone = (name: string) => (name ? `t-${name}` : undefined);

function cell([name, text]: [string, string], col: number, align: string | undefined) {
  return (
    <span key={col} className={[tone(name), align?.[col] === 'r' && 'r'].filter(Boolean).join(' ') || undefined}>
      {text}
    </span>
  );
}

/** The panel's blocks as rows, numbered across all of them for the lines that come in one by one.
 *  A table's rows share its columns (a subgrid), so the columns line up whatever the text. */
function rows(panel: Block[]): ReactNode[] {
  const out: ReactNode[] = [];
  let n = 0;
  const row = (children: ReactNode, grid = false) => {
    const row = (
      <span key={n} className={grid ? 'panel-row panel-cells' : 'panel-row'} style={{ '--i': n } as CSSProperties}>
        {children}
      </span>
    );
    n += 1;
    return row;
  };
  for (const block of panel) {
    if ('lang' in block) {
      for (const line of highlight(block.text, block.lang, true)) out.push(row(<Tokens line={line} />));
    } else if ('out' in block) {
      out.push(row(<span className={tone(block.tone ?? '')}>{block.out}</span>));
    } else if ('ui' in block) {
      for (const line of block.ui) {
        out.push(
          row(
            line.map(([name, text], part) => (
              <span key={part} className={tone(name)}>
                {text}
              </span>
            )),
          ),
        );
      }
    } else {
      const cols = Math.max(...block.grid.map((cells) => cells.length));
      const style = { gridTemplateColumns: `repeat(${cols}, max-content)` };
      out.push(
        <span key={`grid-${n}`} className="panel-grid" style={style}>
          {block.grid.map((cells) =>
            row(
              cells.map((c: Cell, col) => cell(typeof c === 'string' ? ['', c] : c, col, block.align)),
              true,
            ),
          )}
        </span>,
      );
    }
  }
  return out;
}
