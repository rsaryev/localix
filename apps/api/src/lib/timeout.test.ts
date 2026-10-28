import { describe, expect, test } from 'bun:test'
import { classifyAgentError } from '@localixai/agent/agents'

import { DeadlineExceededError, withTimeout } from './timeout'

/**
 * The regression this class's NAME exists to prevent.
 *
 * `classifyAgentError` decides an error's fate off the bare string
 * `error.name === 'TimeoutError'` → "the provider took too long" + `retryable: true`.
 * That name belongs to the provider/network layer and has two FOREIGN minters we
 * cannot brand: the runtime's `AbortSignal.timeout()` (a `DOMException` named
 * `TimeoutError`, which is `instanceof Error` on Bun) and `p-timeout`'s exported
 * class. This deadline primitive is host-side — a hook, an LSP request, a search
 * provider, a CLI executor — and once minted the same name, so a TOOL deadline was
 * reported to the user as a PROVIDER fault and retried like one.
 *
 * Asserted at RUNTIME and through the REAL classifier: `apps/api/tsconfig.json`
 * excludes `src/**\/*.test.ts` and `bun test` does not type-check, so a compile-time
 * guard here would be checked by nothing.
 */
describe('DeadlineExceededError must not impersonate a provider timeout', () => {
  test('does not squat the reserved provider-timeout name', () => {
    expect(new DeadlineExceededError(5).name).toBe('DeadlineExceededError')
    expect(new DeadlineExceededError(5).name).not.toBe('TimeoutError')
  })

  test('the agent loop does not classify it as "the provider took too long"', () => {
    const info = classifyAgentError(new DeadlineExceededError(5_000, 'search provider "docker"'))
    expect(info.userMessage).not.toContain('provider took too long')
    // It was also RETRIED as if a provider had hiccuped. A blown host-side deadline
    // is not a transient provider fault, and re-running it just blows again.
    expect(info.retryable).toBe(false)
  })

  test('a REAL provider timeout still classifies as one (the branch stays load-bearing)', () => {
    // What the runtime actually throws when `AbortSignal.timeout()` fires — the shape
    // four provider drop-ins fetch with. Reproduced here, not hand-waved.
    const platform = new DOMException('The operation timed out.', 'TimeoutError')
    expect(platform).toBeInstanceOf(Error) // true on Bun — this is why it reaches the branch
    const info = classifyAgentError(platform)
    expect(info.userMessage).toContain('provider took too long')
    expect(info.retryable).toBe(true)
  })
})

describe('withTimeout', () => {
  test('passes through a value that settles before the deadline', () => {
    expect(withTimeout(Promise.resolve('ok'), 1_000)).resolves.toBe('ok')
  })

  test('passes through the original rejection (not a DeadlineExceededError)', () => {
    const boom = new Error('boom')
    expect(withTimeout(Promise.reject(boom), 1_000)).rejects.toBe(boom)
  })

  test('rejects with a DeadlineExceededError when the promise never settles', async () => {
    const never = new Promise<never>(() => {})
    const err = await withTimeout(never, 5, 'usage fetch').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeadlineExceededError)
    expect((err as DeadlineExceededError).timeoutMs).toBe(5)
    expect((err as Error).message).toBe('usage fetch timed out after 5ms')
  })

  test('keeps the label-less message contract used by the LSP call sites', async () => {
    const err = await withTimeout(new Promise<never>(() => {}), 5).catch((e: unknown) => e)
    expect((err as Error).message).toBe('Timed out after 5ms')
  })

  test('an abandoned promise rejecting later is handled, not unhandled', async () => {
    let rejectLate!: (e: unknown) => void
    const late = new Promise<never>((_, rej) => {
      rejectLate = rej
    })
    expect(withTimeout(late, 5)).rejects.toBeInstanceOf(DeadlineExceededError)
    rejectLate(new Error('late failure')) // must not crash the process
    await new Promise((r) => setTimeout(r, 0))
  })
})
