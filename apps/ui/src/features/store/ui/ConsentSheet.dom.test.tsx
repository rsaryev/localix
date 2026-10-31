import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const COMMUNITY = {
  id: 'lint',
  displayName: 'Lint',
  ref: { kind: 'plugin' as const, id: 'lint' },
  publisher: { name: 'Someone', verified: false },
  source: { id: 'ada/market', label: 'Ada’s market', trust: 'community' as const },
}

async function ask(
  project: { id: string; name: string } | null,
  source: typeof COMMUNITY.source = COMMUNITY.source,
) {
  const view = await renderStore({
    listings: [listing({ ...COMMUNITY, source })],
    project,
    target: { shelf: 'package:plugin' },
  })
  await view.click(view.button('Get Lint', view.card('lint')!))
  const sheet = document.body.querySelector<HTMLElement>('[role="dialog"]')!
  return { view, sheet }
}

/** The select a person reaches by its name. */
const picker = (within: ParentNode, label: string) =>
  [...within.querySelectorAll<HTMLElement>('[role="combobox"]')].find(
    (node) => node.getAttribute('aria-label') === label,
  ) ?? null

describe('the consent sheet', () => {
  test('says where the package comes from and that nothing installs before Install', async () => {
    const { view, sheet } = await ask(null)
    try {
      expect(sheet.textContent).toContain('Ada’s market')
      expect(sheet.textContent).toContain('Community')
      expect(view.calls).toEqual([])
      await view.click(view.button('Cancel', sheet))
      expect(view.calls).toEqual([])
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('with no project open, a plugin has no scope to pick', async () => {
    const { view, sheet } = await ask(null)
    try {
      expect(picker(sheet, 'Install for')).toBeNull()
      await view.click(view.button('Install', sheet))
      expect(view.calls).toEqual(['install plugin/lint user consent'])
    } finally {
      await view.done()
    }
  })

  test('with a project open, Install can be for that project alone', async () => {
    const { view, sheet } = await ask({ id: 'p1', name: 'Atlas' })
    try {
      const select = picker(sheet, 'Install for')!
      expect(select).not.toBeNull()
      await view.openMenu(select)
      const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
        o.textContent?.includes('Only for Atlas'),
      )!
      await view.click(option)
      await view.click(view.button('Install', sheet))
      expect(view.calls).toEqual(['install plugin/lint project consent in p1'])
    } finally {
      await view.done()
    }
  })

  // A consent sheet is read in a second: what it runs and reaches in words, each said once. The
  // commands themselves are on the package's Permissions tab and in a run's tooltip.
  test('says what it runs and reaches in plain words, each thing once, the command on hover', async () => {
    const { view, sheet } = await ask(null)
    try {
      const text = sheet.textContent ?? ''
      expect(text).toContain('PreToolUse')
      expect(text).toContain('api.example.test')
      expect(text).not.toContain('node check.js')
      expect(sheet.querySelector('[title="node check.js"]')).not.toBeNull()
      expect(text.split('Localix does not review').length - 1).toBe(1)
      expect(text.split('Ada’s market').length - 1).toBe(1)
    } finally {
      await view.done()
    }
  })

  test('names a source whose name already says Community once', async () => {
    const { view, sheet } = await ask(null, {
      id: 'localix-community',
      label: 'Localix Community',
      trust: 'community',
    })
    try {
      expect(sheet.textContent?.split('Community').length).toBe(2)
    } finally {
      await view.done()
    }
  })

  // Read in a second: the warnings as one list to heed, then what it adds, runs and reaches, each
  // under its own word.
  test('warnings are one list, and what it runs and reaches are named facts', async () => {
    const { view, sheet } = await ask(null)
    try {
      const warnings = sheet.querySelector('ul[aria-label="Before you install"]')
      expect([...(warnings?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
        'Localix does not review what this source lists',
      ])
      const facts = [...sheet.querySelectorAll('dt')].map((dt) => [
        dt.textContent,
        dt.nextElementSibling?.textContent,
      ])
      expect(facts).toEqual([
        ['Runs', 'PreToolUse hook, on this computer'],
        ['Reaches', 'api.example.test'],
      ])
    } finally {
      await view.done()
    }
  })
})
