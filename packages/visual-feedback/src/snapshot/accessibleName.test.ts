/**
 * Snapshot field labelling: the agent reads form state from the tree, so a field is named by its
 * label (falling back to placeholder/name), shows its CURRENT value apart (to verify what was
 * typed, and to tell an empty field from a filled one), and never leaks a password's value.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { buildSnapshot, createRefRegistry } from './index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

function treeFor(html: string, fill?: (doc: Document) => void): string {
  document.body.innerHTML = html
  fill?.(document)
  return buildSnapshot(createRefRegistry()).tree
}

describe('snapshot field labelling', () => {
  it('names a filled input by its placeholder and shows its value apart', () => {
    const tree = treeFor('<input placeholder="Name">', (doc) => {
      doc.querySelector('input')!.value = 'Ada'
    })
    expect(tree).toBe('- textbox "Name" = "Ada" [ref=e1]')
  })

  it('an empty input shows no value', () => {
    expect(treeFor('<input placeholder="Email">')).toBe('- textbox "Email" [ref=e1]')
  })

  it('never surfaces a password value', () => {
    const tree = treeFor('<input type="password" placeholder="Password">', (doc) => {
      doc.querySelector('input')!.value = 'hunter2'
    })
    expect(tree).not.toContain('hunter2')
    expect(tree).toContain('"Password"')
    expect(tree).not.toContain(' = ')
  })

  it('shows a textarea value apart from its placeholder', () => {
    const tree = treeFor('<textarea placeholder="Bio"></textarea>', (doc) => {
      doc.querySelector('textarea')!.value = 'hello world'
    })
    expect(tree).toContain('"Bio" = "hello world"')
  })
})
