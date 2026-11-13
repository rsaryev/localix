/** How wide a recording really is. A session is recorded in a wide window but seldom prints to
 *  its edge; played in the columns it used, its text is larger in the same frame. */
import type { Terminal } from '@xterm/xterm';
import type { Cast } from './cast';

/** The fewest columns anything is fitted to: narrower, and a prompt alone looks cut. */
const FEWEST = 48;

/** Prints the recording once, unseen, and reads the widest it got: where the cursor stood after
 *  each frame (a line later overwritten counts), and each line left on the screen at the end. */
export function usedColumns(term: Terminal, cast: Cast): Promise<number> {
  return new Promise((resolve) => {
    let widest = 0;
    const cursor = () => {
      widest = Math.max(widest, term.buffer.active.cursorX);
    };
    for (const frame of cast.frames) term.write(frame.data, cursor);
    term.write('', () => {
      const lines = term.buffer.normal;
      for (let y = 0; y < lines.length; y += 1) widest = Math.max(widest, lines.getLine(y)?.translateToString(true).length ?? 0);
      resolve(Math.min(cast.cols, Math.max(FEWEST, widest + 1)));
    });
  });
}
