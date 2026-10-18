/**
 * press key normalization: the agent may send short aliases ("Up", "Esc", "Return") or
 * the literal "+" key. These must reach the page as the canonical event.key + a correct
 * keyCode, so games/handlers that listen for "ArrowUp"/38 actually fire.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from './index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

function deps(): ActuateDeps {
  return { reg: createRefRegistry(), console: installConsoleCapture(), prevTree: { value: '' } }
}

/** Press `key` on document.body and return the captured keydown {key, keyCode}. */
async function press(key: string): Promise<{ key: string; keyCode: number }> {
  return (await pressFull(key)).short
}

async function pressFull(key: string) {
  document.body.innerHTML = ''
  let got = { short: { key: '', keyCode: -1 }, code: '' }
  const onKey = (e: KeyboardEvent) => {
    got = { short: { key: e.key, keyCode: e.keyCode }, code: e.code }
  }
  document.addEventListener('keydown', onKey, true)
  await runCommand({ action: 'press', key }, deps())
  document.removeEventListener('keydown', onKey, true)
  return got
}

describe('press key normalization', () => {
  it('normalizes arrow aliases to ArrowX with the right keyCode', async () => {
    expect(await press('Up')).toEqual({ key: 'ArrowUp', keyCode: 38 })
    expect(await press('down')).toEqual({ key: 'ArrowDown', keyCode: 40 })
    expect(await press('Left')).toEqual({ key: 'ArrowLeft', keyCode: 37 })
    expect(await press('right')).toEqual({ key: 'ArrowRight', keyCode: 39 })
  })

  it('keeps canonical ArrowUp working', async () => {
    expect(await press('ArrowUp')).toEqual({ key: 'ArrowUp', keyCode: 38 })
  })

  it('normalizes Esc/Return/Del aliases', async () => {
    expect((await press('Esc')).key).toBe('Escape')
    expect((await press('Return')).key).toBe('Enter')
    expect((await press('Del')).key).toBe('Delete')
  })

  it('names the physical key, which games read instead of the character', async () => {
    expect((await pressFull('Left')).code).toBe('ArrowLeft')
    expect((await pressFull('w')).code).toBe('KeyW')
    expect((await pressFull('7')).code).toBe('Digit7')
    expect((await pressFull('Space')).code).toBe('Space')
    expect((await pressFull('Enter')).code).toBe('Enter')
  })

  it('sends the literal + key instead of an empty key', async () => {
    expect((await press('+')).key).toBe('+')
  })
})
