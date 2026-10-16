/**
 * Snapshot field-value labelling: the agent reads form state from the tree, so an input
 * must show its CURRENT value (to verify what was typed), fall back to placeholder/name
 * when empty, and never leak a password's value.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { buildSnapshot, createRefRegistry } from './index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

function treeFor(html: string): string {
  document.body.innerHTML = html
  return buildSnapshot(createRefRegistry()).tree
}

describe('snapshot input/textarea labelling', () => {
  it('shows the current value of a filled input, not its placeholder', () => {
    const input = (() => {
      document.body.innerHTML = '<input placeholder="Name">'
      return document.querySelector('input')!
    })()
    input.value = 'Ada'
    const tree = buildSnapshot(createRefRegistry()).tree
    expect(tree).toContain('"Ada"')
    expect(tree).not.toContain('"Name"')
  })

  it('falls back to placeholder for an empty input', () => {
    expect(treeFor('<input placeholder="Email">')).toContain('"Email"')
  })

  it('never surfaces a password value', () => {
    const input = (() => {
      document.body.innerHTML = '<input type="password" placeholder="Password">'
      return document.querySelector('input')!
    })()
    input.value = 'hunter2'
    const tree = buildSnapshot(createRefRegistry()).tree
    expect(tree).not.toContain('hunter2')
    expect(tree).toContain('"Password"')
  })

  it('shows a textarea current value over its placeholder', () => {
    const ta = (() => {
      document.body.innerHTML = '<textarea placeholder="Bio"></textarea>'
      return document.querySelector('textarea')!
    })()
    ta.value = 'hello world'
    const tree = buildSnapshot(createRefRegistry()).tree
    expect(tree).toContain('"hello world"')
  })
})
