import { pollAttempts } from '@/shared/lib/pollAttempts'
import { decodeEvalResult } from './nativeProbe'

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export interface PageOutcome {
  ok: boolean
  result?: Record<string, unknown>
  error?: string
  errorCode?: string
}

/** What `take` reads when the document holding the command is gone: the page navigated. */
const REPLACED = '__localixReplaced'

/** Actions that can make the page navigate (a link, a submitted form, a key that follows one). */
const DRIVE = new Set(['click', 'hover', 'press', 'scroll', 'steps', 'type'])
export const drivesPage = (action: string): boolean => DRIVE.has(action)

/** How long a finished action waits for a navigation it started to replace the document. */
const NAVIGATION_WAIT = { attempts: 200, delayMs: 25 }

/**
 * Run one command through the page's bridge. `replaced` when the document that took the command
 * was replaced before it answered: its result went with it, so the action navigated the page.
 */
export async function runInPage(
  invoke: Invoke,
  tabId: string,
  commandId: string,
  command: unknown,
): Promise<PageOutcome | 'replaced' | null> {
  await invoke('browser_inject', {
    tabId,
    script: `window.__localixBrowser.run(${JSON.stringify(commandId)}, ${JSON.stringify(command)})`,
  })
  let outcome: PageOutcome | 'replaced' | null = null
  // A command answers in tens of milliseconds; polling every 100 ms added up to that to every
  // browser action (and to each step of a goal run). Ten seconds in all, as before.
  await pollAttempts(400, 25, async () => {
    const raw = decodeEvalResult(
      await invoke('browser_eval', {
        tabId,
        script: `JSON.stringify(window.__localixBrowser ? (window.__localixBrowser.take(${JSON.stringify(commandId)}) ?? null) : ${JSON.stringify(REPLACED)})`,
      }),
    )
    if (raw === REPLACED) outcome = 'replaced'
    else if (raw && typeof (raw as PageOutcome).ok === 'boolean') outcome = raw as PageOutcome
    return outcome !== null
  })
  return outcome
}

/**
 * After an action answered: whether it started a navigation that has since replaced the
 * document. An action answers once the page settles, which is usually before the next document
 * commits, so the answer alone would describe the page being left.
 */
export async function navigatedAfter(
  invoke: Invoke,
  tabId: string,
  action: string,
): Promise<boolean> {
  if (!drivesPage(action)) return false
  let replaced = false
  await pollAttempts(NAVIGATION_WAIT.attempts, NAVIGATION_WAIT.delayMs, async () => {
    const loading = await invoke('browser_navigation_state', { tabId }).then(
      (state) => (state as { loading?: boolean }).loading === true,
      () => false,
    )
    const page = decodeEvalResult(
      await invoke('browser_eval', {
        tabId,
        script:
          'JSON.stringify({bridge:!!window.__localixBrowser,leaving:!!window.__localixBrowser?.leaving?.()})',
      }),
    ) as { bridge?: boolean; leaving?: boolean } | null
    replaced = page?.bridge === false
    // Off macOS the shell reports only loads it asked for: the page says when it is leaving.
    return replaced || !(loading || page?.leaving)
  })
  return replaced
}

/** An action's result once it navigated: what it did, and the page it led to. */
export function navigatedResult(
  action: string,
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const snapshot = next?.snapshot as { url?: string } | undefined
  const done = typeof previous?.note === 'string' ? previous.note : `${action} done`
  return {
    ...previous,
    action,
    diff: undefined,
    snapshot,
    note: `${done} — the page navigated to ${snapshot?.url ?? 'another address'}. Refs from the previous page are invalid; the new page is below.`,
  }
}
