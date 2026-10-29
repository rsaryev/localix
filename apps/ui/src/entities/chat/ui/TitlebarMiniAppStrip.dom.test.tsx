import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type { StatusItemContribution, StatusItemState } from '@localixai/mini-app-sdk/ui'
import { Database, GitBranch, LayoutGrid, Users } from 'lucide-react'

import { registerDom } from '@localixai/kit/testing/dom'
// Type-only, so the value graph still loads inside the tests: `react-dom` must not be pulled in
// before `registerDom()` has installed a `document` — see `domTestSetup`.
import type * as StatusItemsModule from '@/shared/contrib/statusItems'
import type * as StatusStripFitModule from '@localixai/kit/workbench-statusbar'
import type * as DropdownMenuModule from '@localixai/kit/dropdown-menu'
import type * as TitlebarOverflowModule from './TitlebarOverflowItems'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')
  setEnabledMiniAppNames(null)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/**
 * The titlebar's contributed strip, end to end: the registry, the fit model, the control and the
 * `…` menu, wired the way `BreadcrumbTrailingActions` wires them.
 *
 * It reproduces the reported state exactly — four mini apps that DRAW something among ten that are
 * registered, under fixture names — because that shape is what
 * broke. The strip budgeted its slots on registrations, so six went to mini apps with nothing to
 * say; four glyphs reached the bar and the `…` beside them opened onto rows that were `null` too.
 * Every assertion below is a sentence from that report.
 */

/** The bar as the titlebar composes it: measured width in, glyphs and an `…` menu out. */
function MiniAppStrip({
  titlebarWidth,
  sessionId = 's1',
}: {
  titlebarWidth: number | null
  sessionId?: string | null
}) {
  const { StatusItems, useLiveStatusItemCount } = strip
  const { fitStatusStrip } = fit
  const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } = dropdown
  const { TitlebarOverflowItems } = overflowModule

  const count = useLiveStatusItemCount('titlebar')
  const layout = fitStatusStrip({ containerWidth: titlebarWidth, count, max: 10 })
  return (
    <div role="group" aria-label="Mini app items">
      <StatusItems
        placement="titlebar"
        sessionId={sessionId}
        max={layout.visible}
        compact={layout.compact}
        renderOverflow={(hidden) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-haspopup="menu" aria-label={`${hidden.length} more`} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <TitlebarOverflowItems items={hidden} sessionId={sessionId} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
    </div>
  )
}

let strip: typeof StatusItemsModule
let fit: typeof StatusStripFitModule
let dropdown: typeof DropdownMenuModule
let overflowModule: typeof TitlebarOverflowModule

const opened: string[] = []

/**
 * The four that draw, and the six that answer `null` until they have something to say.
 *
 * The names are FIXTURES, not the bundled mini apps' own. Core code naming a mini app is the
 * coupling the architecture guard stops, and a test that hard-codes the name is the same coupling
 * with a different file extension. What this
 * suite reproduces is the SHAPE of that workspace (four speaking among ten registered), and the
 * shape is what broke.
 */
const SPEAKING: Array<[string, StatusItemState]> = [
  ['rows', { label: 'Rows', Icon: Database, onClick: () => opened.push('rows') }],
  ['crew', { label: 'Crew', Icon: Users, onClick: () => opened.push('crew') }],
  [
    'scm',
    {
      label: 'Branches',
      Icon: GitBranch,
      text: 'main',
      onClick: () => opened.push('scm'),
      menu: [
        { id: 'open', label: 'Open Branches', onSelect: () => opened.push('scm:open') },
        { id: 'fetch', label: 'Fetch', onSelect: () => opened.push('scm:fetch') },
      ],
    },
  ],
  ['sheets', { label: 'Sheets', Icon: LayoutGrid, onClick: () => opened.push('sheets') }],
]
const SILENT = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']

async function mount(node: unknown) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node as React.ReactNode))
  // Presence is reported from an effect, so the placed layout is one settled frame away.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const settle = async (run: () => void) => {
    await act(async () => {
      run()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  return {
    host,
    settle,
    glyphs: () => [...host.querySelectorAll('button[aria-label]')],
    menuItems: () => [...document.body.querySelectorAll('[role="menuitem"]')],
    named: (name: string) =>
      [...host.querySelectorAll('button[aria-label]')].find((node) =>
        (node.getAttribute('aria-label') ?? '').startsWith(name),
      ),
    row: (label: string) =>
      [...document.body.querySelectorAll('[role="menuitem"]')].find((node) =>
        node.textContent?.includes(label),
      ),
    click: (node: Element) =>
      settle(() => {
        node.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
          }),
        )
        node.dispatchEvent(
          new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }),
        )
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }),
    rightClick: (node: Element) =>
      settle(() =>
        node.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 2,
            buttons: 2,
            clientX: 40,
            clientY: 12,
          }),
        ),
      ),
    async close() {
      await act(async () =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      )
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

/** Register one titlebar contribution owned by its own mini app, under a suite-unique id. */
function register(miniAppName: string, state: StatusItemState | null, suffix = ''): string {
  const id = `${miniAppName}${suffix}:titlebar`
  const contribution: StatusItemContribution = {
    id,
    miniAppName,
    placement: 'titlebar',
    useItem: () => state,
  }
  strip.registerStatusItem(contribution)
  return id
}

beforeAll(async () => {
  strip = await import('@/shared/contrib/statusItems')
  fit = await import('@localixai/kit/workbench-statusbar')
  dropdown = await import('@localixai/kit/dropdown-menu')
  overflowModule = await import('./TitlebarOverflowItems')
  const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')

  for (const [miniApp, state] of SPEAKING) register(miniApp, state)
  for (const miniApp of SILENT) register(miniApp, null)
  // Eleven speaking mini apps live in their own placement, so the overflow case is not entangled
  // with the reported one.
  for (let index = 0; index < 11; index += 1) {
    const name = `crowd-${String(index).padStart(2, '0')}`
    strip.registerStatusItem({
      id: `${name}:titlebar`,
      miniAppName: name,
      placement: 'crowded',
      useItem: () => ({
        label: `Crowd ${index}`,
        Icon: Database,
        onClick: () => opened.push(`crowd-${index}`),
      }),
    })
  }
  setEnabledMiniAppNames(
    new Set([
      ...SPEAKING.map(([miniApp]) => miniApp),
      ...SILENT,
      ...Array.from({ length: 11 }, (_, i) => `crowd-${String(i).padStart(2, '0')}`),
    ]),
  )
})

afterEach(() => {
  opened.length = 0
})

describe('the titlebar mini app strip', () => {
  test('every mini app that has something to say gets a glyph — no premature “…”', async () => {
    // The report: four icons on the bar and "almost every mini app" behind a `…`. Six of the ten
    // registrations draw nothing, and the six slots they were given are what pushed the speaking
    // ones into the menu.
    const view = await mount(<MiniAppStrip titlebarWidth={1280} />)
    try {
      const labels = view.glyphs().map((node) => node.getAttribute('aria-label'))
      expect(labels).toContain('Rows')
      expect(labels).toContain('Crew')
      expect(labels).toContain('Sheets')
      expect(labels.some((label) => label?.startsWith('Branches'))).toBe(true)
      // Four glyphs and NOT a `…` beside them: with ten registrations and a ceiling of ten there
      // is nothing to fold, and the six silent ones cost nobody a slot.
      expect(labels.filter((label) => label?.endsWith('more'))).toEqual([])
      expect(view.glyphs()).toHaveLength(4)
    } finally {
      await view.close()
    }
  })

  test('the same four survive the frame before the titlebar has been measured', async () => {
    // `titlebarWidth` is `null` on the first paint of every mount. It used to mean "show four,
    // fold the rest", which on this workspace is the only frame the user ever saw.
    const view = await mount(<MiniAppStrip titlebarWidth={null} />)
    try {
      expect(view.glyphs()).toHaveLength(4)
      expect(view.glyphs().map((node) => node.getAttribute('aria-label'))).toContain('Rows')
    } finally {
      await view.close()
    }
  })

  test('an ordinary click runs the glyph’s primary action', async () => {
    const view = await mount(<MiniAppStrip titlebarWidth={1280} />)
    try {
      await view.click(view.named('Rows')!)
      expect(opened).toEqual(['rows'])
    } finally {
      await view.close()
    }
  })

  test('a right-click opens the shared menu on every visible glyph', async () => {
    const view = await mount(<MiniAppStrip titlebarWidth={1280} />)
    try {
      for (const name of ['Rows', 'Crew', 'Sheets', 'Branches']) {
        await view.rightClick(view.named(name)!)
        const menu = document.body.querySelector('[role="menu"]')
        expect(menu, name).not.toBeNull()
        // The host's uniform row proves it is THE shared menu, not something the mini app drew.
        expect(menu?.textContent, name).toContain('Mini app settings…')
        await view.settle(() =>
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        )
      }
    } finally {
      await view.close()
    }
  })

  test('a right-click menu entry executes the mini app’s action', async () => {
    const view = await mount(<MiniAppStrip titlebarWidth={1280} />)
    try {
      await view.rightClick(view.named('Branches')!)
      await view.click(view.row('Fetch')!)
      expect(opened).toEqual(['scm:fetch'])
    } finally {
      await view.close()
    }
  })

  test('a right-click opens the menu without also running the primary action', async () => {
    // Two handlers on one node, composed by three nested `asChild` triggers — the arrangement
    // that already dropped `onContextMenu` once. Opening the menu must not also open the
    // workspace behind it.
    const view = await mount(<MiniAppStrip titlebarWidth={1280} />)
    try {
      await view.rightClick(view.named('Rows')!)
      expect(document.body.querySelector('[role="menu"]')).not.toBeNull()
      expect(opened).toEqual([])
    } finally {
      await view.close()
    }
  })

  test('a glyph is a real button with an accessible name, compact or not', async () => {
    // Compaction takes the text off the bar; the name is where it has to survive, because a
    // 28px glyph is the whole control a keyboard or screen-reader user is given.
    const view = await mount(<MiniAppStrip titlebarWidth={420} />)
    try {
      const scm = view.named('Branches')!
      expect(scm.tagName).toBe('BUTTON')
      expect(scm.getAttribute('type')).toBe('button')
      expect(scm.getAttribute('aria-label')).toContain('main')
      expect(scm.hasAttribute('disabled')).toBe(false)
    } finally {
      await view.close()
    }
  })

  test('an eleventh mini app is what brings the “…” out', async () => {
    const view = await mount(<MiniAppStrip titlebarWidth={1280} />)
    const crowded = await mountCrowded()
    try {
      expect(view.glyphs().filter((n) => n.getAttribute('aria-label')?.endsWith('more'))).toEqual(
        [],
      )
      // Ten glyphs on the bar, the eleventh in the menu — the ceiling, not a guess about width.
      expect(crowded.glyphs()).toHaveLength(11)
      expect(crowded.named('1 more')).toBeDefined()
    } finally {
      await crowded.close()
      await view.close()
    }
  })

  test('a folded mini app keeps its whole list, not just its first row', async () => {
    // The regression this pins: the overflow row measured the mini app's half of the menu by
    // looking for the FIRST separator, which is the mini app's own the moment it groups its rows.
    // A mini app with sections does — so it collapsed to `Open …` the moment its glyph stopped
    // fitting, and the row that replaced it looked like it worked.
    const view = await mountOverflowFor({
      label: 'Reader',
      Icon: Database,
      menu: [
        { id: 'open', label: 'Open Reader', onSelect: () => opened.push('folded:open') },
        { separator: true },
        { header: 'Open books' },
        { id: 'book:1', label: 'Dune', onSelect: () => opened.push('folded:row') },
      ],
    })
    try {
      const trigger = view.row('Reader')
      expect(trigger).toBeDefined()
      // A trigger, not a plain row: there is more than one thing to reach.
      expect(trigger?.getAttribute('aria-haspopup')).toBe('menu')
    } finally {
      await view.close()
    }
  })

  test('a mini app whose only offer is one action stays a single click', async () => {
    // The other half of the same rule, and the reason it is not "always a submenu": a title above
    // one row is still one row, and a panel to reach it would be a hover for nothing.
    const view = await mountOverflowFor({
      label: 'Sheets',
      Icon: LayoutGrid,
      onClick: () => opened.push('sheets'),
    })
    try {
      const row = view.row('Sheets')
      expect(row?.getAttribute('aria-haspopup')).toBeNull()
      await view.click(row!)
      expect(opened).toEqual(['sheets'])
    } finally {
      await view.close()
    }
  })

  test('an overflow row runs the same action the glyph would have', async () => {
    // It used to be a sub-menu trigger with nothing on the row itself, so a click on it did
    // nothing — the menu read as decorative.
    const crowded = await mountCrowded()
    try {
      await crowded.click(crowded.named('1 more')!)
      const row = crowded.row('Crowd 10')
      expect(row).toBeDefined()
      await crowded.click(row!)
      expect(opened).toEqual(['crowd-10'])
    } finally {
      await crowded.close()
    }
  })
})

/**
 * One folded item, in an already-open overflow menu.
 *
 * The menu is rendered open rather than reached through a trigger: what is under test is the SHAPE
 * a folded item takes, and driving Radix's own open/close would be testing Radix.
 */
async function mountOverflowFor(state: StatusItemState) {
  const { DropdownMenu, DropdownMenuContent } = dropdown
  const { TitlebarOverflowItems } = overflowModule
  const id = `folded-${overflowCase++}`
  const contribution: StatusItemContribution = {
    id: `${id}:titlebar`,
    miniAppName: id,
    placement: 'folded',
    useItem: () => state,
  }
  // No registry and no activation gate on purpose: `TitlebarOverflowItems` is handed the
  // contributions it must render, so this exercises the row's own shape without disturbing the
  // enabled set the strip cases above depend on.
  return mount(
    <DropdownMenu open>
      <DropdownMenuContent>
        <TitlebarOverflowItems items={[contribution]} sessionId="s1" />
      </DropdownMenuContent>
    </DropdownMenu>,
  )
}

let overflowCase = 0

/** The eleven-mini-app placement, laid out by the same strip. */
async function mountCrowded() {
  const { StatusItems, useLiveStatusItemCount } = strip
  const { fitStatusStrip } = fit
  const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } = dropdown
  const { TitlebarOverflowItems } = overflowModule

  function Crowded() {
    const count = useLiveStatusItemCount('crowded')
    const layout = fitStatusStrip({ containerWidth: 1280, count, max: 10 })
    return (
      <StatusItems
        placement="crowded"
        sessionId="s1"
        max={layout.visible}
        compact={layout.compact}
        renderOverflow={(hidden) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-haspopup="menu" aria-label={`${hidden.length} more`} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <TitlebarOverflowItems items={hidden} sessionId="s1" />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
    )
  }
  return mount(<Crowded />)
}
