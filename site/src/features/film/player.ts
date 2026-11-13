/**
 * A recording played into a real terminal (xterm.js) that takes no input: what was printed is
 * written at the pace it was recorded, so the reader can scroll back, select and copy while it
 * plays. A chapter is reached by printing everything before it at once.
 */
import type { Terminal } from '@xterm/xterm';
import { type Cast, printed } from './cast';

export type Status = 'playing' | 'paused' | 'ended';
export type Told = (status: Status, frame: number) => void;

/** A hard reset, in band, so it lands after anything still being parsed. */
const RESET = '\x1bc';
/** Frames closer than this are written together. */
const TOGETHER = 0.015;

export class Player {
  private next = 0;
  private timer: number | undefined;
  private playing = false;

  constructor(
    private readonly term: Terminal,
    private readonly cast: Cast,
    private readonly told: Told,
  ) {}

  play() {
    if (this.playing) return;
    if (this.next >= this.cast.frames.length) this.seek(0);
    this.playing = true;
    this.told('playing', this.next);
    this.schedule();
  }

  pause() {
    window.clearTimeout(this.timer);
    this.playing = false;
    this.told('paused', this.next);
  }

  /** The screen as it was just before `frame`; playing goes on from there if it was playing. */
  seek(frame: number) {
    window.clearTimeout(this.timer);
    this.term.write(RESET + printed(this.cast, frame));
    this.term.scrollToBottom();
    this.next = frame;
    if (this.playing) this.schedule();
    else this.told(frame >= this.cast.frames.length ? 'ended' : 'paused', frame);
  }

  /** Everything at once, for a reader who asked for less motion. */
  finish() {
    this.playing = false;
    this.seek(this.cast.frames.length);
  }

  dispose() {
    window.clearTimeout(this.timer);
    this.term.dispose();
  }

  private schedule() {
    const { frames } = this.cast;
    const first = frames[this.next];
    if (!first) {
      this.playing = false;
      this.told('ended', this.next);
      return;
    }
    const wait = first.at - (frames[this.next - 1]?.at ?? first.at);
    this.timer = window.setTimeout(() => {
      let data = '';
      for (let frame = frames[this.next]; frame && frame.at - first.at < TOGETHER; frame = frames[this.next]) {
        data += frame.data;
        this.next += 1;
      }
      this.term.write(data);
      this.told('playing', this.next);
      this.schedule();
    }, wait * 1000);
  }
}
