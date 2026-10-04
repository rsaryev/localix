import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { RAIL_ENTRY_DRAG_MIME } from '../model/railDrag'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

describe('WorkspaceShell responsive ownership', () => {
  test('mounts one rail and one sidebar tree at either breakpoint', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkspaceShell } = await import('./WorkspaceShell')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const noOp = () => {}

    const renderShell = (isMobile: boolean) => (
      <WorkspaceShell
        isMobile={isMobile}
        statusSessionId={null}
        sidebarOpen={false}
        sidebarContent={<div data-sidebar-probe />}
        railSections={[]}
        railActions={[]}
        onOpenSidebar={noOp}
        onCloseSidebar={noOp}
        onCreateChat={noOp}
      >
        <div data-workspace-probe />
      </WorkspaceShell>
    )

    try {
      await act(async () => root.render(renderShell(false)))
      expect(host.querySelectorAll('[aria-label="Workspace navigation"]')).toHaveLength(1)
      expect(host.querySelectorAll('[data-sidebar-probe]')).toHaveLength(1)
      expect(host.querySelectorAll('[data-workspace-probe]')).toHaveLength(1)

      await act(async () => root.render(renderShell(true)))
      expect(host.querySelectorAll('[aria-label="Workspace navigation"]')).toHaveLength(1)
      expect(host.querySelectorAll('[data-sidebar-probe]')).toHaveLength(1)
      expect(host.querySelectorAll('[data-workspace-probe]')).toHaveLength(1)
      const mobileHeader = host.querySelector('header')
      expect(mobileHeader?.classList.contains('shrink-0')).toBe(true)
      expect(mobileHeader?.classList.contains('fixed')).toBe(false)
      const mobileHistory = mobileHeader?.querySelector<HTMLButtonElement>(
        '[aria-label="Chat history"]',
      )
      expect(mobileHistory?.getAttribute('data-slot')).toBe('button')
      expect(mobileHistory?.getAttribute('data-size')).toBe('icon-touch')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  // The reported symptom was "plugins show no view; it only appears after Manage".
  // The presentational half (a pending section says "Loading views" instead of
  // vanishing) is pinned in PluginsSidebar's own tests. This pins the DERIVATION
  // it depends on, which had no coverage: a plugin-owned rail section has to travel
  // railSections → buildRailEntries → the `plugin` filter → the Views group. Break
  // any link and the section is silently absent rather than wrong.
  test('a plugin-owned rail section reaches the Views group', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkspaceShell } = await import('./WorkspaceShell')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const noOp = () => {}
    localStorage.removeItem('localix_sidebar_width_v4')

    try {
      await act(async () =>
        root.render(
          <WorkspaceShell
            isMobile={false}
            statusSessionId={null}
            sidebarOpen
            activeSectionId="plugins"
            railSections={[
              {
                id: 'sample-plugin-section',
                icon: <span />,
                label: 'Sample Plugin',
                content: <div />,
                defaultArea: 'overflow',
                plugin: true,
                pluginName: 'sample-plugin',
              },
              // A CORE section must not be swept into the plugin group with it.
              { id: 'files', icon: <span />, label: 'Files', content: <div />, defaultArea: 'top' },
            ]}
            railActions={[]}
            onOpenSidebar={noOp}
            onCloseSidebar={noOp}
            onCreateChat={noOp}
          >
            <div />
          </WorkspaceShell>,
        ),
      )

      expect(host.textContent).toContain('Plugins')
      // The plugin's launcher row carries its view's identity directly.
      const entry = host.querySelector<HTMLElement>(
        '[data-plugin-entry-id="section:sample-plugin-section"]',
      )
      expect(entry).not.toBeNull()
      expect(entry?.textContent).toContain('Sample Plugin')
      // Plugin views have no rail placement, so the launcher offers no pin control — and
      // no availability control either: the launcher reaches a view, Settings decides
      // whether the plugin behind it is on at all.
      expect(host.querySelector('[aria-label^="Pin "]')).toBeNull()
      expect(host.querySelector('[aria-label^="Disable "]')).toBeNull()
      expect(host.querySelector('[data-plugin-entry-id="section:files"]')).toBeNull()
      const sash = host.querySelector<HTMLElement>(
        '[data-slot="workbench-sash"][aria-label="Resize sidebar"]',
      )!
      expect(sash.getAttribute('aria-label')).toBe('Resize sidebar')
      expect(sash.getAttribute('aria-valuenow')).toBe('300')
      expect(sash.getAttribute('aria-description')).toContain('Use arrow keys to adjust')
      expect(sash.hasAttribute('title')).toBe(false)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('groups the rail and opens the plugin launcher', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkspaceShell } = await import('./WorkspaceShell')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const noOp = () => {}
    localStorage.removeItem('localix_rail_layout')
    localStorage.removeItem('localix_sidebar_width_v4')
    function Harness() {
      const [sidebarOpen, setSidebarOpen] = React.useState(false)
      const [activeSectionId, setActiveSectionId] = React.useState<string | null>(null)
      return (
        <WorkspaceShell
          isMobile={false}
          statusSessionId={null}
          sidebarOpen={sidebarOpen}
          activeSectionId={activeSectionId}
          onSectionChange={setActiveSectionId}
          railSections={[
            {
              id: 'files',
              icon: <span />,
              label: 'Files',
              content: <div />,
              customizable: true,
              defaultArea: 'top',
            },
            {
              // NOT plugin-owned: a plugin entry never defaults to the bar (see
              // buildRailEntries.test.ts), so this section exists purely to pin
              // down cross-zone button ORDER, unrelated to that policy.
              id: 'vault',
              icon: <span />,
              label: 'Vault keys',
              content: <div />,
              defaultArea: 'bar',
            },
            {
              // A CORE customizable section: only these still have a rail
              // placement, so this is what the zone-to-zone drag coverage below
              // has to exercise. Plugin views are no longer placeable at all.
              id: 'docker',
              icon: <span />,
              label: 'Docker',
              content: <div />,
              defaultArea: 'bar',
            },
          ]}
          railActions={[
            {
              id: 'search',
              icon: <span />,
              label: 'Search',
              onClick: noOp,
              customizable: true,
              defaultArea: 'top',
            },
            {
              id: 'notes',
              icon: <span />,
              label: 'Notes',
              onClick: noOp,
              customizable: true,
              defaultArea: 'bar',
            },
            {
              id: 'review',
              icon: <span />,
              label: 'Review',
              onClick: noOp,
              customizable: true,
              defaultArea: 'bar',
            },
            {
              id: 'usage',
              icon: <span />,
              label: 'Usage & Spend',
              onClick: noOp,
              customizable: true,
              defaultArea: 'bottom',
            },
            {
              id: 'reset-layout',
              icon: <span />,
              label: 'Reset layout',
              onClick: noOp,
              customizable: true,
              defaultArea: 'status',
            },
            {
              id: 'settings',
              icon: <span />,
              label: 'Settings',
              onClick: noOp,
              customizable: true,
              defaultArea: 'bottom',
            },
          ]}
          onOpenSidebar={() => setSidebarOpen(true)}
          onCloseSidebar={() => setSidebarOpen(false)}
          onCreateChat={noOp}
        >
          <div />
        </WorkspaceShell>
      )
    }

    try {
      await act(async () => root.render(<Harness />))

      const openPlugins = host.querySelector<HTMLButtonElement>('[aria-label="Plugins"]')
      const files = host.querySelector<HTMLButtonElement>('[aria-label="Files"]')
      const search = host.querySelector<HTMLButtonElement>('[aria-label="Search"]')
      const vaultKeys = host.querySelector<HTMLButtonElement>('[aria-label="Vault keys"]')
      const notes = host.querySelector<HTMLButtonElement>('[aria-label="Notes"]')
      const review = host.querySelector<HTMLButtonElement>('[aria-label="Review"]')
      const settings = host.querySelector<HTMLButtonElement>('[aria-label="Settings"]')
      const usage = host.querySelector<HTMLButtonElement>('[aria-label="Usage & Spend"]')
      const resetLayout = host.querySelector<HTMLButtonElement>('[aria-label="Reset layout"]')
      const buttons = [...host.querySelectorAll('button')]
      expect(openPlugins).not.toBeNull()
      expect(openPlugins?.querySelector('.lucide-puzzle')).not.toBeNull()
      expect(openPlugins?.getAttribute('data-slot')).toBe('button')
      expect(openPlugins?.getAttribute('data-size')).toBe('icon-touch')
      expect(openPlugins?.getAttribute('title')).toBeNull()
      expect(files).not.toBeNull()
      expect(files?.getAttribute('draggable')).toBe('true')
      expect(search).not.toBeNull()
      expect(search?.getAttribute('draggable')).toBe('true')
      expect(vaultKeys).not.toBeNull()
      expect(notes).not.toBeNull()
      expect(notes?.getAttribute('draggable')).toBe('true')
      expect(review).not.toBeNull()
      expect(settings).not.toBeNull()
      expect(usage).not.toBeNull()
      expect(resetLayout).not.toBeNull()
      expect(resetLayout?.getAttribute('draggable')).toBe('true')
      expect(resetLayout?.closest('[data-status-rail-drop-zone]')).not.toBeNull()
      expect(buttons.indexOf(files!)).toBeLessThan(buttons.indexOf(search!))
      expect(buttons.indexOf(search!)).toBeLessThan(buttons.indexOf(vaultKeys!))
      expect(buttons.indexOf(vaultKeys!)).toBeLessThan(buttons.indexOf(notes!))
      expect(buttons.indexOf(notes!)).toBeLessThan(buttons.indexOf(review!))
      expect(buttons.indexOf(review!)).toBeLessThan(buttons.indexOf(openPlugins!))
      expect(buttons.indexOf(openPlugins!)).toBeLessThan(buttons.indexOf(usage!))
      expect(buttons.indexOf(usage!)).toBeLessThan(buttons.indexOf(settings!))
      expect(buttons.indexOf(settings!)).toBeLessThan(buttons.indexOf(resetLayout!))

      const groups = [...host.querySelectorAll<HTMLElement>('[data-rail-group]')]
      expect(groups.map((group) => group.dataset.railGroup)).toEqual([
        'navigation',
        'workspace',
        'system',
      ])

      await act(async () => {
        notes!.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 2,
            buttons: 2,
            clientX: 80,
            clientY: 80,
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(document.body.querySelector('[role="menu"]')?.textContent).toContain(
        'Reset rail to defaults',
      )
      await act(async () =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      )
      expect(document.body.querySelector('[role="menu"]')).toBeNull()

      await act(async () => openPlugins!.click())
      expect(openPlugins?.getAttribute('aria-current')).toBe('true')
      expect(host.textContent).toContain('Plugins')
      expect(host.textContent).not.toContain('Tools & plugins')
      // The sidebar's width is PAINTED from a custom property on the panel, which the
      // resize hook writes straight to the DOM during a drag (so a mousemove repaints
      // without re-rendering the shell). The inner content column reads the same var,
      // so the two can never drift.
      const sidebarColumn = () => host.querySelector<HTMLElement>('[data-focus-part="sidebar"]')!
      const paintedSidebarWidth = () =>
        sidebarColumn().parentElement!.style.getPropertyValue('--sidebar-width')
      expect(sidebarColumn().style.width).toBe('var(--sidebar-width)')

      expect(paintedSidebarWidth()).toBe('300px')

      const resizeHandle = host.querySelector<HTMLElement>('[aria-label="Resize sidebar"]')
      expect(resizeHandle).not.toBeNull()
      await act(async () => {
        resizeHandle!.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 244 }),
        )
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 308 }))
        window.dispatchEvent(new MouseEvent('mouseup'))
      })
      expect(paintedSidebarWidth()).toBe('364px')
      expect(localStorage.getItem('localix_sidebar_width_v4')).toBe('364')
      expect(resizeHandle?.getAttribute('tabindex')).toBe('0')
      expect(resizeHandle?.getAttribute('aria-valuemin')).toBe('220')
      expect(resizeHandle?.getAttribute('aria-valuemax')).toBe('440')
      expect(resizeHandle?.getAttribute('aria-valuenow')).toBe('364')

      await act(async () => {
        resizeHandle!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        )
      })
      expect(paintedSidebarWidth()).toBe('380px')
      await act(async () => {
        resizeHandle!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
        )
      })
      expect(paintedSidebarWidth()).toBe('364px')

      const railDropZone = host.querySelector<HTMLElement>('[data-rail-drop-zone]')
      expect(railDropZone).not.toBeNull()

      const payload = new Map<string, string>()
      let compactDragImageSet = false
      const dataTransfer = {
        effectAllowed: 'none',
        dropEffect: 'none',
        setData(type: string, value: string) {
          payload.set(type, value)
        },
        setDragImage() {
          compactDragImageSet = true
        },
      } as unknown as DataTransfer
      const dispatchDrag = (target: HTMLElement, type: string) => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
        target.dispatchEvent(event)
      }

      let docker = host.querySelector<HTMLButtonElement>('[aria-label="Docker"]')
      expect(docker).not.toBeNull()
      expect(docker?.getAttribute('data-slot')).toBe('button')
      expect(docker?.getAttribute('data-size')).toBe('icon-touch')
      expect(docker?.getAttribute('data-tooltip-trigger')).toBe('true')
      expect(docker?.getAttribute('title')).toBeNull()

      await act(async () => dispatchDrag(docker!, 'dragstart'))
      expect(payload.get(RAIL_ENTRY_DRAG_MIME)).toBe('section:docker')
      expect(payload.get('text/plain')).toBe('section:docker')
      expect(compactDragImageSet).toBe(true)

      await act(async () => dispatchDrag(railDropZone!, 'dragover'))
      expect(railDropZone!.getAttribute('data-drop-active')).toBe('true')
      await act(async () => dispatchDrag(railDropZone!, 'drop'))

      const bottomDropZone = host.querySelector<HTMLElement>('[data-bottom-rail-drop-zone]')
      const statusDropZone = host.querySelector<HTMLElement>('[data-status-rail-drop-zone]')
      const topDropZone = host.querySelector<HTMLElement>('[data-top-rail-drop-zone]')
      expect(bottomDropZone).not.toBeNull()
      expect(statusDropZone).not.toBeNull()
      expect(topDropZone).not.toBeNull()

      await act(async () => docker!.focus())
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Docker')
      await act(async () => dispatchDrag(docker!, 'dragstart'))
      expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
      await act(async () => dispatchDrag(bottomDropZone!, 'dragover'))
      expect(bottomDropZone!.getAttribute('data-drop-active')).toBe('true')
      await act(async () => dispatchDrag(bottomDropZone!, 'drop'))
      docker = host.querySelector<HTMLButtonElement>('[aria-label="Docker"]')
      expect(docker?.closest('[data-rail-group]')?.getAttribute('data-rail-group')).toBe('system')

      await act(async () => dispatchDrag(docker!, 'dragstart'))
      await act(async () => dispatchDrag(statusDropZone!, 'dragover'))
      expect(statusDropZone!.getAttribute('data-drop-active')).toBe('true')
      await act(async () => dispatchDrag(statusDropZone!, 'drop'))
      docker = host.querySelector<HTMLButtonElement>('[aria-label="Docker"]')
      expect(docker?.closest('[data-status-rail-drop-zone]')).not.toBeNull()

      await act(async () => dispatchDrag(docker!, 'dragstart'))
      await act(async () => dispatchDrag(topDropZone!, 'dragover'))
      expect(topDropZone!.getAttribute('data-drop-active')).toBe('true')
      await act(async () => dispatchDrag(topDropZone!, 'drop'))
      docker = host.querySelector<HTMLButtonElement>('[aria-label="Docker"]')
      expect(docker?.closest('[data-rail-group]')?.getAttribute('data-rail-group')).toBe(
        'navigation',
      )

      await act(async () => dispatchDrag(docker!, 'dragstart'))
      await act(async () => dispatchDrag(railDropZone!, 'dragover'))
      await act(async () => dispatchDrag(railDropZone!, 'drop'))
      docker = host.querySelector<HTMLButtonElement>('[aria-label="Docker"]')
      expect(docker?.closest('[data-rail-group]')?.getAttribute('data-rail-group')).toBe(
        'workspace',
      )

      await act(async () => files!.click())
      expect(paintedSidebarWidth()).toBe('364px')

      await act(async () => openPlugins!.click())
      expect(paintedSidebarWidth()).toBe('364px')
      await act(async () => openPlugins!.click())
      expect(openPlugins?.getAttribute('aria-current')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      localStorage.removeItem('localix_rail_layout')
      localStorage.removeItem('localix_sidebar_width_v4')
      host.remove()
    }
  })
})

/**
 * The app frame owns ONE status bar (one per window). The editor
 * contributes into it instead of docking a second bar underneath itself, which
 * is what used to stack 2 × `--statusbar-height` at the bottom of the editor
 * column while the chat column next to it had none.
 */
describe('WorkspaceShell status contribution', () => {
  test('hosts the single status bar and lands editor entries in it', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkspaceShell } = await import('./WorkspaceShell')
    const { WorkbenchStatusContribution } = await import('@localixai/kit/workbench-statusbar')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const noOp = () => {}

    const renderShell = (focused: boolean) => (
      <WorkspaceShell
        isMobile={false}
        statusSessionId={null}
        sidebarOpen={false}
        onOpenSidebar={noOp}
        onCloseSidebar={noOp}
        onCreateChat={noOp}
        footer={<div data-host-status>2m 1s total</div>}
      >
        <div data-editor-column>
          <WorkbenchStatusContribution active={focused}>
            <span data-editor-status>Ln 21, Col 6</span>
          </WorkbenchStatusContribution>
        </div>
      </WorkspaceShell>
    )

    try {
      await act(async () => root.render(renderShell(true)))
      const bar = host.querySelector('[data-status-rail-drop-zone]')
      // One bar, one row of chrome: the host footer and the editor entries share it.
      expect(host.querySelectorAll('[data-status-rail-drop-zone]')).toHaveLength(1)
      expect(bar?.className).toContain('h-[var(--statusbar-height)]')
      expect(bar?.querySelectorAll('[data-editor-status]')).toHaveLength(1)
      expect(bar?.querySelector('[data-host-status]')).not.toBeNull()
      // Nothing is left docked under the editor.
      expect(
        host.querySelector('[data-editor-column]')?.querySelector('[data-editor-status]'),
      ).toBeNull()

      // Focus leaves the editor (terminal tab, chat tab, unfocused group): cleared.
      await act(async () => root.render(renderShell(false)))
      expect(host.querySelectorAll('[data-editor-status]')).toHaveLength(0)
      expect(host.querySelector('[data-host-status]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
  // The Dock-style half of the rail: opening an UNPINNED view floats it into a
  // recent slot, pinning it hands the slot back, and a view whose plugin went away
  // stops rendering without being forgotten. Without this the whole recents feature
  // is invisible to the suite — the layout store alone can't express it.
  test('an opened plugin view takes a recent slot and leaves with its plugin', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkspaceShell } = await import('./WorkspaceShell')
    const { RAIL_LAYOUT_STORAGE_KEY } = await import('../model/railLayout')
    const { RAIL_RECENTS_STORAGE_KEY } = await import('../model/railRecents')
    localStorage.removeItem(RAIL_LAYOUT_STORAGE_KEY)
    localStorage.removeItem(RAIL_RECENTS_STORAGE_KEY)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const noOp = () => {}

    const renderShell = (sections: string[]) => (
      <WorkspaceShell
        isMobile={false}
        statusSessionId={null}
        sidebarOpen
        activeSectionId="plugins"
        railSections={sections.map((id) => ({
          id,
          icon: <span />,
          label: id === 'reader' ? 'Reader' : 'Office',
          content: <div />,
          defaultArea: 'overflow' as const,
          plugin: true,
          pluginName: id,
        }))}
        railActions={[]}
        onOpenSidebar={noOp}
        onCloseSidebar={noOp}
        onCreateChat={noOp}
      >
        <div />
      </WorkspaceShell>
    )

    const railSlots = () =>
      Array.from(
        host.querySelectorAll<HTMLElement>('[data-rail-group="workspace"] [data-slot="button"]'),
      ).map((slot) => slot.getAttribute('aria-label'))

    try {
      await act(async () => root.render(renderShell(['reader', 'office'])))
      // Nothing opened yet: the rail carries only its fixed plugin launcher.
      expect(railSlots()).toEqual(['Plugins'])

      // Launch Reader from its launcher row — the row records the open.
      const readerRow = host.querySelector<HTMLButtonElement>(
        '[data-plugin-entry-id="section:reader"] [data-slot="workbench-list-row-trigger"]',
      )!
      await act(async () => readerRow.click())
      // Default mode collapses an inactive recent behind the dock's trigger, so the
      // rail itself gains exactly one quiet button instead of a plugin icon.
      expect(railSlots()).toEqual(['Plugins'])
      const dockTrigger = host.querySelector<HTMLButtonElement>(
        '[data-rail-group="workspace"] [data-rail-recents-trigger]',
      )!
      expect(dockTrigger.getAttribute('aria-label')).toBe('Recent views (1)')
      await act(async () => dockTrigger.click())
      const flyoutSlots = () =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-slot="popover-content"][data-state="open"] [data-slot="button"]',
          ),
        ).map((slot) => slot.getAttribute('aria-label'))
      // Exactly one slot: a recent never doubles up, and nothing pins it.
      expect(flyoutSlots().filter((label) => label === 'Reader')).toHaveLength(1)
      await act(async () => dockTrigger.click())

      // Re-opening it does NOT reshuffle the slots — the whole point of excluding
      // an already-visible recent from the touch wrapper.
      await act(async () => readerRow.click())
      expect(railSlots()).toEqual(['Plugins'])

      // Reader's plugin goes away: its slot goes with it, without erasing the entry
      // from the recents store (re-enabling brings it back).
      await act(async () => root.render(renderShell(['office'])))
      expect(railSlots()).not.toContain('Reader')
      // …and the dock's trigger goes with it: nothing is left to reveal.
      expect(host.querySelector('[data-rail-recents-trigger]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      localStorage.removeItem(RAIL_LAYOUT_STORAGE_KEY)
      localStorage.removeItem(RAIL_RECENTS_STORAGE_KEY)
    }
  })
})
