/** An asciinema v3 recording read into a timeline: its size, what it printed and when, and its
 *  chapters. */
export type Frame = { at: number; data: string };
export type Chapter = { label: string; frame: number };
export type Cast = { cols: number; rows: number; frames: Frame[]; chapters: Chapter[] };

/** v3 events carry the time since the one before; a frame keeps the time since the start. */
export function parseCast(text: string): Cast {
  const [head, ...lines] = text.split('\n').filter((line) => line.trim() !== '');
  const { term } = JSON.parse(head ?? '{}') as { term: { cols: number; rows: number } };
  const frames: Frame[] = [];
  const chapters: Chapter[] = [];
  let at = 0;
  for (const line of lines) {
    const [gap, kind, data] = JSON.parse(line) as [number, string, string];
    at += gap;
    if (kind === 'o') frames.push({ at, data });
    if (kind === 'm') chapters.push({ label: data, frame: frames.length });
  }
  return { cols: term.cols, rows: term.rows, frames, chapters };
}

/** What the screen shows once the first `count` frames are printed, as one write. */
export function printed(cast: Cast, count: number): string {
  return cast.frames
    .slice(0, count)
    .map((frame) => frame.data)
    .join('');
}
