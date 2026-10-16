import { expect, test } from 'bun:test'
import { mergeSignals } from './runtime-signal'

test('external cancellation relays the original reason and keeps the run signal', () => {
  const external = new AbortController()
  const run = new AbortController()
  const merged = mergeSignals(run, external.signal)
  const reason = { stop: 'external' }
  expect(merged.signal).toBe(run.signal)
  external.abort(reason)
  expect(run.signal.aborted).toBe(true)
  expect(run.signal.reason).toBe(reason)
  merged.cleanup()
})

test('cleanup detaches external cancellation without disabling other listeners', () => {
  const external = new AbortController()
  const run = new AbortController()
  let observed = 0
  external.signal.addEventListener('abort', () => {
    observed++
  })
  const merged = mergeSignals(run, external.signal)
  merged.cleanup()
  merged.cleanup()
  external.abort('late')
  expect(run.signal.aborted).toBe(false)
  expect(observed).toBe(1)
})

test('already aborted signals retain their reason and an absent signal leaves local control', () => {
  const external = new AbortController()
  const reason = new Error('already stopped')
  external.abort(reason)
  const merged = mergeSignals(new AbortController(), external.signal)
  expect(merged.signal.reason).toBe(reason)
  merged.cleanup()
  const local = new AbortController()
  const unlinked = mergeSignals(local)
  unlinked.cleanup()
  local.abort('local')
  expect(unlinked.signal.reason).toBe('local')
})
