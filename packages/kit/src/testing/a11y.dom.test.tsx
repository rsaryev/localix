import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from './dom'
import { describeAxeViolations, findAxeViolations } from './axe-check'

/**
 * The shared primitives are what every surface is built from, in the app and in every bundled
 * plugin, so an accessibility defect here is one defect in one file and a hundred broken screens.
 *
 * These are the checks the static rules cannot make. `jsx-a11y` reads source; it cannot tell that a
 * rendered button has no accessible name, because the name is missing rather than wrong and absence
 * has no syntax.
 */

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  // axe-core installs itself on `globalThis` when imported, and a leaked global changes what every
  // later test file sees. Deleted rather than set to undefined — the key itself is the leak.
  delete (globalThis as { axe?: unknown }).axe
  await teardown()
})

async function renderToHost(node: React.ReactNode): Promise<{
  host: HTMLElement
  cleanup: () => Promise<void>
}> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('shared primitives have no accessibility violations', () => {
  test('a labelled button, an icon button and a form field', async () => {
    const { Button } = await import('../controls/button')
    const { IconButton } = await import('../controls/icon-button')
    const { Input } = await import('../controls/input')
    const { X } = await import('lucide-react')

    const { host, cleanup } = await renderToHost(
      <>
        <Button>Save</Button>
        <IconButton aria-label="Close">
          <X />
        </IconButton>
        <label htmlFor="name-field">Name</label>
        <Input id="name-field" />
      </>,
    )
    try {
      const violations = await findAxeViolations(host)
      expect(violations, describeAxeViolations(violations)).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test('the check is real: an icon button with no name is caught', async () => {
    // POSITIVE CONTROL. Everything above passing is indistinguishable from axe never running, and
    // this is exactly the defect the static rules cannot see.
    const { host, cleanup } = await renderToHost(
      <button type="button">
        <svg aria-hidden="true" />
      </button>,
    )
    try {
      const violations = await findAxeViolations(host)
      expect(violations.map((violation) => violation.id)).toContain('button-name')
    } finally {
      await cleanup()
    }
  })
})
