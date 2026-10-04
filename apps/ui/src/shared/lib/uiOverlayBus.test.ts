import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { openUiOverlay, subscribeUiOverlay } from './uiOverlayBus'

/**
 * Dropping a request with no listener is the contract — a transient surface that is not mounted
 * cannot open. What it must not be is INVISIBLE.
 *
 * The sources drawer shipped doing nothing when clicked: its owner was mounted behind a focus gate,
 * so a click from any other pane reached no one. No error, no drawer, nothing in the console. The
 * warning turns that into one line naming the id, which is the whole diagnosis.
 */
describe('openUiOverlay', () => {
  const warnings: string[] = []
  let warn: { mockRestore: () => void } | undefined

  afterEach(() => {
    warn?.mockRestore()
    warn = undefined
    warnings.length = 0
  })

  const captureWarnings = () => {
    warn = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '))
    })
  }

  test('a request with no listener warns, naming the id', () => {
    captureWarnings()

    openUiOverlay('nobody-is-listening', { message: 'm1' })

    expect(warnings.join('\n')).toContain('nobody-is-listening')
  })

  test('a delivered request says nothing', () => {
    captureWarnings()
    const seen: unknown[] = []
    const stop = subscribeUiOverlay('has-owner', (params) => seen.push(params))

    openUiOverlay('has-owner', { message: 'm1' })

    expect(seen).toEqual([{ message: 'm1' }])
    expect(warnings).toEqual([])
    stop()
  })

  test('an owner that unsubscribed is the same as none — this is the regression shape', () => {
    const stop = subscribeUiOverlay('was-owned', () => {})
    stop()
    captureWarnings()

    openUiOverlay('was-owned')

    expect(warnings.join('\n')).toContain('was-owned')
  })

  test('an empty id is ignored without noise', () => {
    captureWarnings()

    openUiOverlay('')

    expect(warnings).toEqual([])
  })
})
