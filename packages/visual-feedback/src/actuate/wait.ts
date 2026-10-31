/**
 * `wait` — hold a batch until text or an element appears in the page (or goes away).
 *
 * A page that renders late (a search, a route change, a spinner) used to be read before it was
 * ready, and the model re-read blindly. This polls IN the page, so it costs one round trip, on
 * the native timer (settle.ts): animation frames stop in a hidden tab, a timer does not.
 * It only observes: it never touches the page, so it is safe on any site.
 */
import { waitLimitMs, type VfCommand } from '../protocol/index'
import { fail, type Fail } from './target'
import { nativeSleep, now } from './settle'
import type { ActuateDeps, ActuateResult } from './types'

const POLL_MS = 100
/** "1.2s" — whole seconds and one decimal, the way the reply reads. */
const seconds = (ms: number) => `${Math.floor(ms / 1000)}.${Math.floor((ms % 1000) / 100)}s`

/** The page's visible text, read lazily so a missing body is just "no text yet". */
function pageText(root: Element | undefined): string {
  const el = (root ?? document.body) as HTMLElement | null
  return collapse(el?.innerText ?? el?.textContent ?? '')
}

/** `read` collapses runs of whitespace; a wanted text is compared the same way. */
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

export async function performWait(cmd: VfCommand, deps: ActuateDeps): Promise<ActuateResult> {
  const text = cmd.text
  const selector = cmd.selector
  if ((text == null || text === '') === (selector == null || selector === ''))
    return fail('bad_request', '`wait` needs exactly one of `text` or `selector`.')
  if (selector) {
    try {
      ;(deps.root ?? document).querySelector(selector)
    } catch {
      return fail('bad_request', `invalid selector "${selector}"`)
    }
  }
  const subject = selector ?? text!
  const present = (): boolean =>
    selector
      ? (deps.root ?? document).querySelector(selector) !== null
      : pageText(deps.root).includes(collapse(text!))
  const gone = cmd.gone === true
  const satisfied = () => present() !== gone

  const clock = deps.clock ?? { now, sleep: nativeSleep }
  const limit = waitLimitMs(cmd.timeoutMs)
  const started = clock.now()
  let first = true
  while (!satisfied()) {
    first = false
    const elapsed = clock.now() - started
    if (elapsed >= limit) return notReached(subject, gone, limit)
    await clock.sleep(Math.min(POLL_MS, limit - elapsed))
  }
  const took = clock.now() - started
  const what = gone ? 'gone' : 'appeared'
  const note = first
    ? gone
      ? `"${subject}" was already gone`
      : `"${subject}" was already there`
    : `"${subject}" ${what} after ${seconds(took)}`
  return { ok: true, result: { action: 'wait', note } }
}

function notReached(subject: string, gone: boolean, limit: number): Fail {
  return fail(
    'failed',
    `"${subject}" did not ${gone ? 'go away' : 'appear'} within ${seconds(limit).replace(/\.0s$/, 's')}: the page may still be working; wait again, or take a snapshot to see what it shows`,
  )
}
