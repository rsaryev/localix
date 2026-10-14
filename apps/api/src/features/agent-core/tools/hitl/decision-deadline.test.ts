import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  HITL_DECISION_MS,
  UNANSWERED_CALL_TAIL,
  hitlDecisionDeadline,
  isHitlTimeout,
  unansweredRefusal,
} from './decision-deadline'
import { HumanInLoopDismissedError, HumanInLoopTimeoutError } from '@localixai/agent/agents'

describe('the deadline', () => {
  test('is five minutes, and the card is given the instant rather than the duration', () => {
    expect(HITL_DECISION_MS).toBe(5 * 60_000)
    const at = hitlDecisionDeadline()
    expect(at).toBeGreaterThan(Date.now() + HITL_DECISION_MS - 1_000)
    expect(at).toBeLessThanOrEqual(Date.now() + HITL_DECISION_MS)
  })

  test('only the timeout reads as a timeout', () => {
    // The whole point of the distinction: a dismissal is a person acting, and it must not
    // reach the model wearing the sentence reserved for an empty room.
    expect(isHitlTimeout(new HumanInLoopTimeoutError())).toBe(true)
    expect(isHitlTimeout(new HumanInLoopDismissedError())).toBe(false)
    expect(isHitlTimeout(new Error('aborted'))).toBe(false)
    expect(isHitlTimeout(undefined)).toBe(false)
  })
})

describe('what the model is told', () => {
  const text = unansweredRefusal(UNANSWERED_CALL_TAIL)

  test('says it was automatic, and says nothing changed', () => {
    expect(text).toContain('AUTO-DENIED')
    expect(text).toContain('5 minutes')
    expect(text).toContain('nothing was changed')
  })

  test('does not read as a person refusing', () => {
    // A model that cannot tell the two apart either abandons work over an empty room or
    // re-asks after a real refusal. The user's own decline still says "User declined …".
    expect(text).not.toContain('User declined')
    expect(text.toLowerCase()).toContain('no one approved it, no one refused it')
  })

  test('the tail says what to do next, per site', () => {
    expect(unansweredRefusal('Nothing else.')).toEndWith('Nothing else.')
  })
})

/**
 * THE GUARD, and the reason this module exists.
 *
 * Every card that blocks a run must carry the deadline the controller enforces. This reads
 * the SOURCES rather than a list someone maintains: any file that raises a human-in-the-loop
 * request must set `expiresAt`, so a new blocking card added tomorrow fails here until it
 * decides what happens when nobody answers — which is exactly the decision each of the four
 * existing ones made differently, and one of them (a tool-approval confirm) never made at
 * all: it waited forever.
 */
describe('no blocking card may be raised without a deadline', () => {
  const ROOT = new URL('../../../../', import.meta.url).pathname
  const RAISES = /\.request<|humanInLoop\.request\(/

  function sources(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) out.push(...sources(path))
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(path)
    }
    return out
  }

  test('every raiser either sets expiresAt or gets it from the one helper that does', () => {
    const raisers = sources(ROOT).filter((path) => RAISES.test(readFileSync(path, 'utf8')))
    // The positive control: if this list is empty the test proves nothing, and a refactor
    // that renames `request<` would silently empty it.
    expect(raisers.length).toBeGreaterThan(2)
    for (const path of raisers) {
      const source = readFileSync(path, 'utf8')
      const covered =
        source.includes('expiresAt') ||
        // The confirm paths build their request through this one helper, which sets it.
        source.includes('surfaceConfirmRequest')
      expect({ file: path.slice(ROOT.length), covered }).toEqual({
        file: path.slice(ROOT.length),
        covered: true,
      })
    }
  })

  test('the helper the exemption points at does set one', () => {
    // Without this the exemption above is a hole: every confirm path would pass by naming
    // `surfaceConfirmRequest`, while the deadline it is trusted to add had been deleted.
    const helper = readFileSync(join(ROOT, 'features/chat/runtime/hitl-confirm.ts'), 'utf8')
    expect(helper).toContain('expiresAt: hitlDecisionDeadline()')
  })
})
