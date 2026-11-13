import type { ITheme } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { Chapters } from '@/shared/ui';
import { type Chapter, parseCast } from './cast';
import { usedColumns } from './fit';
import { Player, type Status } from './player';
import './Film.css';

/** Mono's advance, in em: the font size that fits the recording's columns in the frame. */
const CELL = 0.6;
/** The frame's side padding and border (Film.css), both sides. */
const PADDING = 34;
/** Its top and bottom padding (Film.css). */
const PADDING_BLOCK = 28;
/** A row's height, in em (the terminal's `lineHeight`). */
const LINE = 1.15;
/** The largest type a wide frame gets: past it the recording reads as a poster, not a terminal. */
const LARGEST = 15;
/** xterm's names for the sixteen colours, in the order of the `--ansi-*` tokens. */
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

/** The recording's colours, all from the site's tokens (shared/styles/global.css), so a theme
 *  that changes `--panel` or an `--ansi-*` changes the recording with it. */
function themed(node: HTMLElement): ITheme {
  const css = getComputedStyle(node);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const [background, foreground] = [token('--panel'), token('--panel-text')];
  const theme: ITheme = { background, foreground, cursor: foreground, cursorAccent: background, selectionBackground: token('--line-strong') };
  ANSI.forEach((name, index) => {
    theme[name] = token(`--ansi-${index}`);
    theme[`bright${name[0]?.toUpperCase()}${name.slice(1)}` as `bright${Capitalize<typeof name>}`] = token(`--ansi-${index + 8}`);
  });
  return theme;
}

/**
 * A real run at a terminal, recorded with asciinema and played into a real terminal that takes no input:
 * it scrolls back, selects and copies like one. It starts when it comes into view; its chapters
 * jump to a command. xterm.js and its styles load in the browser only, after the page: neither
 * holds up its first paint.
 */
export function Film({ src, label }: { src: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const [status, setStatus] = useState<Status | 'loading'>('loading');
  const [frame, setFrame] = useState(0);
  const [chapters, setChapters] = useState<Chapter[]>([]);

  useEffect(() => {
    let alive = true;
    let cleanup = () => {};
    const fonts = document.fonts.load('14px Mono').catch(() => []);
    const styles = import('@xterm/xterm/css/xterm.css');
    void Promise.all([import('@xterm/xterm'), fetch(src).then((r) => r.text()), fonts, styles]).then(async ([{ Terminal }, text]) => {
      const node = host.current;
      if (!alive || !node) return;
      const cast = parseCast(text);
      const term = new Terminal({
        cols: cast.cols,
        rows: cast.rows,
        disableStdin: true,
        cursorBlink: true,
        scrollback: 2000,
        fontFamily: 'Mono, ui-monospace, monospace',
        lineHeight: LINE,
        theme: themed(node),
      });
      // Measured before it is shown: the recording is printed once, then wiped.
      node.style.visibility = 'hidden';
      term.open(node);
      // A row's height by the type's size, as this font really sets it: its own line height times
      // the terminal's, which no constant here could know.
      const pitch = (node.querySelector<HTMLElement>('.xterm-screen')?.offsetHeight ?? 0) / (term.rows * (term.options.fontSize ?? 15)) || 1.5;
      const cols = await usedColumns(term, cast);
      if (!alive) return term.dispose();
      term.resize(cols, cast.rows);
      term.reset();
      // The frame's size is the stylesheet's alone (Film.css), the same before the terminal
      // loads and after, so nothing on the page moves when it arrives. The type fits the
      // recording's columns to the frame's width, and the rows are those its height holds.
      const fit = () => {
        const size = (node.clientWidth - PADDING) / (cols * CELL);
        const font = Math.max(6, Math.min(LARGEST, Math.floor(size * 2) / 2));
        term.options.fontSize = font;
        const rows = Math.max(8, Math.floor((node.clientHeight - PADDING_BLOCK) / Math.ceil(font * pitch)));
        if (rows !== term.rows) term.resize(cols, rows);
      };
      fit();
      node.style.visibility = '';
      const resized = new ResizeObserver(fit);
      resized.observe(node);
      window.addEventListener('resize', fit);
      const made = new Player(term, cast, (now, at) => {
        setStatus(now);
        setFrame(at);
      });
      player.current = made;
      setChapters(cast.chapters);
      const seen = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting) return;
        seen.disconnect();
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) made.finish();
        else made.play();
      });
      seen.observe(node);
      cleanup = () => {
        seen.disconnect();
        resized.disconnect();
        window.removeEventListener('resize', fit);
        made.dispose();
      };
    });
    return () => {
      alive = false;
      player.current = null;
      cleanup();
    };
  }, [src]);

  const current = chapters.reduce((last, chapter, index) => (chapter.frame <= frame ? index : last), -1);
  const toggle = () => {
    if (status === 'playing') player.current?.pause();
    else player.current?.play();
  };

  return (
    <>
      <div ref={host} className="film" role="region" aria-label={label} />
      <Chapters
        labels={chapters.map((chapter) => chapter.label)}
        current={current}
        onPick={(at) => player.current?.seek(chapters[at]?.frame ?? 0)}
        toggle={{ label: status === 'playing' ? 'Pause' : status === 'ended' ? 'Replay' : 'Play', disabled: status === 'loading', onPress: toggle }}
      />
    </>
  );
}
