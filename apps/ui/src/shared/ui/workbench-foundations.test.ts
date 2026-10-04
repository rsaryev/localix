import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { readKitStylesheet } from '@localixai/kit/testing/stylesheet'

const uiRoot = resolve(import.meta.dir, '../..')
const read = (path: string) => readFileSync(resolve(uiRoot, path), 'utf8')
/** The pure primitives live in `@localixai/kit`; host-bound composites stay under `uiRoot`. */
const kitRoot = resolve(uiRoot, '../../../packages/kit/src')
const readKit = (path: string) => readFileSync(resolve(kitRoot, path), 'utf8')

/**
 * Bundled plugin UI surfaces that mount the shared tab row, found by scanning the plugin
 * tree. Core may hold plugin UI to a shared contract; it may not name a concrete plugin.
 */
const pluginTabBarConsumers = () => {
  const pluginsRoot = resolve(uiRoot, '../../..', 'plugins')
  return readdirSync(pluginsRoot, { encoding: 'utf8', recursive: true })
    .filter(
      (entry) =>
        entry.endsWith('.tsx') &&
        !/(?:^|[\\/])(?:node_modules|dist)[\\/]/u.test(entry) &&
        !/\.(?:dom\.)?test\.tsx$/u.test(entry),
    )
    .map((entry) => ({
      path: `plugins/${entry}`,
      source: readFileSync(resolve(pluginsRoot, entry), 'utf8'),
    }))
    .filter(({ source }) => source.includes('<TabBar'))
}

describe('workbench foundation contracts', () => {
  test('defines one physical geometry scale for persistent chrome', () => {
    const css = readKitStylesheet()
    for (const declaration of [
      '--chrome-control-xs: 20px',
      '--chrome-control-sm: 24px',
      '--chrome-control-md: 28px',
      '--chrome-control-lg: 32px',
      '--chrome-control-xl: 36px',
      '--chrome-control-touch: 40px',
      '--workbench-rail-width: 48px',
      '--workbench-gutter: 12px',
      '--titlebar-height: 36px',
      '--mobile-header-height: 44px',
      '--editor-tab-height: 36px',
      '--panel-header-height: 36px',
      '--statusbar-height: 24px',
      '--sash-hit-area: 6px',
      '--sash-line-width: 1px',
    ]) {
      expect(css).toContain(declaration)
    }

    expect(readKit('controls/button-variants.ts')).toContain('var(--chrome-control-md)')
    for (const token of [
      'var(--chrome-control-md)',
      'var(--chrome-control-lg)',
      'var(--chrome-control-xl)',
    ]) {
      expect(readKit('controls/input.tsx')).toContain(token)
    }
    expect(readKit('controls/button-variants.ts')).toContain('var(--chrome-control-touch)')
    expect(read('widgets/workspace-shell/ui/WorkspaceShell.tsx')).toContain(
      'w-[var(--workbench-rail-width)]',
    )
    expect(read('widgets/editor-grid/ui/GroupView.tsx')).toContain('h-[var(--editor-tab-height)]')
    expect(readKit('layout/panel-header.tsx')).toContain('h-[var(--panel-header-height)]')
    expect(readKit('layout/workbench-statusbar.tsx')).toContain('h-[var(--statusbar-height)]')
    // The input-group's addon buttons name the same measures as
    // `buttonVariants`. They used to read `icon-xs` = 24px and `icon-sm` = 28px
    // — the identical names `buttonVariants` gives 20px and 24px, one design
    // system holding two meanings for one name. The pixels suited a 28px field
    // and were kept; only the labels moved (`icon-xs`→`icon-sm`, `icon-sm`→`icon`).
    const inputGroup = readKit('controls/input-group.tsx')
    expect(inputGroup).toContain('h-[var(--chrome-control-md)]')
    expect(inputGroup).toContain("'icon-sm': 'size-[var(--chrome-control-sm)]")
    expect(inputGroup).toContain("icon: 'size-[var(--chrome-control-md)]")
    expect(inputGroup, 'icon-xs must not name a second size').not.toContain("'icon-xs'")

    // ONE icon ladder, and it is Tailwind's — `size-2.5/3/3.5/4/4.5`. A second,
    // tokenized scale (`--icon-xs…lg` = 12/14/16/18px) lived alongside it and
    // lost: four files used it, `--icon-md` had no users at all, and it was
    // never redefined per theme or density, so it bought no theming power and
    // only let one physical size answer to two names. Its users were converted
    // to the exact `size-*` equivalents (14px→`size-3.5`, 18px→`size-4.5`) and
    // the tokens deleted. Chrome BOXES stay tokenized — that is the scale that
    // moves with density; the glyph inside a box is a typography choice.
    for (const token of ['--icon-xs:', '--icon-sm:', '--icon-md:', '--icon-lg:']) {
      expect(css, `${token} is a second icon scale; use Tailwind size-*`).not.toContain(token)
    }
    expect(
      readKit('controls/button-variants.ts'),
      'button-variants sizes glyphs on the Tailwind ladder',
    ).not.toContain('var(--icon-')
    for (const path of [
      'features/chat/ui/BreadcrumbTrailingActions.tsx',
      'shared/ui/notification-center/NotificationCenterLauncher.tsx',
      'widgets/workspace-shell/ui/WorkspaceShell.tsx',
    ]) {
      expect(read(path), `${path} sizes glyphs on the Tailwind ladder`).not.toContain('var(--icon-')
    }
  })

  test('keeps the tab row on the token ladder, with one seam it never delegates', () => {
    const tabs = readKit('layout/tabs/tabs.tsx')
    const tabBar = tabs.slice(tabs.indexOf('export function TabBar'))

    // ONE row measure, taken from the scale — not a `pt-1`/`pb-2.5` pair that
    // happened to add up to ~34px, which is what made every control beside it
    // need a hand-tuned nudge.
    expect(tabBar).toContain('h-[var(--panel-header-height)]')
    expect(tabBar).not.toMatch(/\bp[bty]-[\d.]+/)

    // ONE seam weight in this file: the repo-wide content-chrome step documented
    // in panel-header.tsx — the `soft` border step. TabBar used to draw `/20` while
    // TabStrip drew `/60`.
    const seams = [...tabs.matchAll(/border-b border-border(?:\/\d+|-[a-z]+)?\b/g)].map((m) => m[0])
    expect(seams.length).toBeGreaterThan(1)
    expect(new Set(seams)).toEqual(new Set(['border-b border-border-soft']))

    // The seam belongs to the primitive. A consumer that needs a control beside
    // the tabs passes `trailing` instead of suppressing the line and redrawing it.
    expect(tabs).toContain('trailing?: ReactNode')
    expect(tabs).toContain('data-slot="tab-bar-trailing"')
    for (const path of [
      'features/settings/ui/capabilities/CapabilityTabRow.tsx',
      'features/settings/ui/SettingsPanel.tsx',
    ]) {
      const consumer = read(path)
      expect(consumer, `${path} suppresses the shared tab-row seam`).not.toContain('border-b-0')
      expect(consumer, `${path} no longer mounts the shared tab row`).toContain('<TabBar')
    }
    // Bundled plugin UI is compiled into this workbench and obeys the same seam, but core
    // must not know which plugin that is: discover the consumers instead of naming a tree.
    const pluginConsumers = pluginTabBarConsumers()
    expect(
      pluginConsumers.length,
      'no bundled plugin surface mounts the shared tab row',
    ).toBeGreaterThan(0)
    for (const { path, source } of pluginConsumers) {
      expect(source, `${path} suppresses the shared tab-row seam`).not.toContain('border-b-0')
    }
  })

  test('keeps chat and editor status surfaces on one primitive', () => {
    for (const path of [
      'features/chat/ui/StatusBar.tsx',
      'features/inspector/ui/EditorStatusBar.tsx',
    ]) {
      const source = read(path)
      expect(source).toContain('WorkbenchStatusBar')
      expect(source).not.toMatch(/\bh-(?:6|7)\b/)
    }
  })

  test('keeps every composer context control on one native chip primitive', () => {
    const primitive = readKit('controls/composer-chip.tsx')
    expect(primitive).toContain('data-slot="composer-chip"')
    expect(primitive).toContain("type = 'button'")
    expect(primitive).toContain("tone?: 'default' | 'strong' | 'danger'")
    expect(primitive).not.toContain('export const CHIP')

    for (const path of [
      'widgets/chat-workspace/ui/ComposerContextBar.tsx',
      // A CONTRIBUTED pill is drawn by `status-item.tsx` on this same primitive, asserted above.
      // The one plugin surface that still draws its own holds the contract where it lives — core
      // cannot name a plugin's tree, which is the whole point of it being contributed.
      'widgets/chat-workspace/ui/PermissionsChip.tsx',
    ]) {
      const source = read(path)
      expect(source).toContain('<ComposerChip')
      expect(source).toContain("from '@localixai/kit/composer-chip'")
      expect(source).not.toContain('className={CHIP}')
      expect(source).not.toContain("from './composerChip'")
    }
  })

  test('the unread bell is a chrome button with a badge, never a status-coloured plate', () => {
    const launcher = read('shared/ui/notification-center/NotificationCenterLauncher.tsx')
    const tones = readKit('feedback/status-tone.ts')

    // The wash is GONE, from the bell and from the shared tone maps: it was the bell's only
    // user, and what it did was paint the glyph on a red plate for 2.4 seconds.
    expect(launcher).not.toContain('STATUS_SIGNAL_CLASS')
    expect(tones).not.toContain('export const STATUS_SIGNAL_CLASS')

    // The control's className carries the chrome recipe and its open state — nothing else.
    expect(launcher).toContain('className={cn(chromeAction, open && chromeActionActive)}')

    // The count is a corner badge on the shared Chip counter, not an inline pill: inline, a
    // second digit widened the button and shifted the whole titlebar cluster.
    expect(launcher).toContain('size="counter"')
    expect(launcher).toContain('absolute -top-px -right-px')
    expect(launcher).toContain('ring-2 ring-sidebar')
    expect(launcher).toContain('STATUS_BADGE_CLASS[unreadSeverity]')

    // Arrival is the badge's animation, and it yields to reduced motion.
    expect(launcher).toContain('data-signal:animate-in')
    expect(launcher).toContain('motion-reduce:animate-none')

    // One phrased announcement, outside the button; the badge itself is decorative because the
    // button's accessible name already carries the count.
    expect(launcher).toContain('aria-hidden="true"')
    expect(launcher).toMatch(/<span className="sr-only" aria-live="polite">/)
    expect(launcher).toContain('`Event Center, ${unread} unread`')
  })

  test('the titlebar keeps core actions and renders contributed ones through one control', () => {
    const cluster = read('features/chat/ui/BreadcrumbTrailingActions.tsx')

    // Core's three are always there, and the bell is LAST. It is the one place a user looks when
    // something needs attention; an anchor that a plugin can push around is not an anchor.
    expect(cluster).toContain('label="Command palette"')
    expect(cluster).toContain('label="Terminal"')
    expect(cluster).toContain('<NotificationCenterLauncher />')
    expect(cluster.indexOf('<StatusItems')).toBeLessThan(
      cluster.indexOf('<NotificationCenterLauncher />'),
    )

    // The middle zone is DECLARED, not drawn. The free React surface it replaced is what let the
    // one contributed button grow its own height and lose its focus ring.
    expect(cluster).toContain('placement="titlebar"')
    expect(cluster).not.toContain('breadcrumb.trailing')

    // The cap counts contributed items only — it is passed to `StatusItems`, which never sees a
    // core button, so twenty plugins push plugin glyphs into the overflow and nothing else.
    expect(cluster).toContain('MAX_VISIBLE_TITLEBAR_ITEMS')
    expect(cluster).toContain('renderOverflow')

    // One control for all three placements, each on the host's own recipe.
    const control = read('shared/ui/status-item.tsx')
    expect(control).toContain('chromeAction')
    expect(control).toContain('<ComposerChip')
    expect(control).toContain('WorkbenchStatusButton')
    expect(control).toContain('WorkbenchStatusItem')
    // A plugin describes; it never renders. One `Component` field and the chrome is a canvas again.
    expect(control).not.toContain('state.Component')
  })

  test('keeps titlebar navigation fluid and trailing actions intrinsic', () => {
    const titlebar = read('pages/chat/ui/TitlebarContent.tsx')
    const breadcrumb = read('features/chat/ui/UnifiedBreadcrumb.tsx')
    expect(titlebar).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(breadcrumb).toContain('<WorkbenchBreadcrumb aria-label="Session path"')
    expect(breadcrumb).toContain('className="flex-1"')
    expect(read('features/inspector/ui/SymbolBreadcrumbBar.tsx')).toContain(
      '<WorkbenchBreadcrumb aria-label="Document symbols" density="compact" bordered={bordered}>',
    )

    const primitive = readKit('layout/workbench-breadcrumb.tsx')
    expect(primitive).toContain("'min-w-0 overflow-hidden'")
    expect(primitive).toContain('h-[var(--chrome-control-md)]')
  })

  test('uses stable icon actions and one modal information hierarchy', () => {
    const iconButton = readKit('controls/icon-button.tsx')
    expect(iconButton).toContain("'aria-label': string")
    // Re-tiered onto Button's ladder: this used to pin `sm: 'icon-xs'`,
    // `md: 'icon-sm'`, `lg: 'icon'` — a map one tier below its own labels, so
    // `size="sm"` meant 24px on a Button and 20px on an IconButton. The pin was
    // accurate but it was pinning the defect. The behavioural rule (a name
    // renders the same measure on both components, default included) is pinned
    // in `icon-button.test.tsx`; this keeps the map itself honest.
    expect(iconButton).toContain("xs: 'icon-xs'")
    expect(iconButton).toContain("sm: 'icon-sm'")
    expect(iconButton).toContain("md: 'icon'")
    expect(iconButton).toContain("lg: 'icon-lg'")
    expect(iconButton).toContain("xl: 'icon-xl'")
    expect(iconButton).toContain('aria-hidden="true"')
    expect(iconButton).not.toContain("square: 'flex size-6")

    const dialog = readKit('overlays/dialog.tsx')
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl', "'2xl'", "'3xl'"]) {
      expect(dialog).toContain(`${size}: 'sm:max-w-`)
    }
    expect(dialog).toContain("size = 'lg'")
    expect(dialog).toContain('max-h-[calc(100dvh-2rem)]')
    expect(dialog).toContain('DialogBody')
    expect(dialog).not.toContain('outline-none sm:max-w-sm')

    expect(readKit('overlays/drawer.tsx')).toContain('max-h-[calc(100dvh-0.5rem)]')
    expect(readKit('overlays/confirm-dialog.tsx')).toContain('max-h-[calc(100dvh-2rem)]')
    expect(readKit('overlays/dialog.tsx')).toContain('max-h-[80%]')

    for (const path of [
      'overlays/dialog.tsx',
      'overlays/drawer.tsx',
      'overlays/confirm-dialog.tsx',
    ]) {
      const source = readKit(path)
      expect(source).toContain('modalTitle')
      expect(source).toContain('modalDescription')
    }
  })

  test('associates editor tabs with mounted panels and names every shared tablist', () => {
    const tabs = readKit('layout/tabs/tabs.tsx')
    expect(tabs).toContain("'aria-label': string")
    expect(tabs).toContain('aria-controls={item.panelId}')
    expect(tabs).toContain('role="tabpanel"')
    expect(tabs).toContain('hidden={!active}')

    const editorGroup = read('widgets/editor-grid/ui/GroupView.tsx')
    expect(editorGroup).toContain("useTabPanelIds('editor-group')")
    expect(editorGroup).toContain('...tabIds.item(id)')
    expect(editorGroup).toContain('<TabPanel')
    expect(editorGroup).toContain('aria-labelledby={tabIds.tabId(id)}')

    const previewBrowser = read('features/inspector/ui/BrowserWorkspace.tsx')
    expect(previewBrowser).toContain("useTabPanelIds('browser')")
    expect(previewBrowser).toContain('<TabPanel')
    expect(previewBrowser).not.toContain('role="tab"')
    const browserTabs = read('features/inspector/ui/BrowserTabStrip.tsx')
    expect(browserTabs).toContain('<TabStrip')
    expect(browserTabs).toContain('aria-label="Browser tabs"')
    expect(browserTabs).toContain('...tabIds.item(tab.previewId)')
    expect(browserTabs).not.toContain('role="tab"')

    for (const path of [
      'features/settings/ui/SettingsPanel.tsx',
      'features/settings/ui/CapabilitiesSettings.tsx',
    ]) {
      expect(read(path)).toContain('aria-label=')
    }
  })

  test('keeps editor and contributed-workbench action bars on shared geometry', () => {
    const toolbar = readKit('layout/workbench-toolbar.tsx')
    expect(toolbar).toContain("default: 'h-[var(--panel-header-height)] px-(--workbench-gutter)'")
    expect(toolbar).toContain("compact: 'h-[var(--chrome-control-lg)] px-2.5'")
    expect(toolbar).toContain("role = 'group'")
    expect(toolbar).toContain('data-slot="workbench-toolbar-section"')
    expect(toolbar).toContain("align === 'end' && 'ml-auto shrink-0'")

    for (const path of [
      'features/inspector/ui/MessageReplayTab.tsx',
      'features/inspector/ui/LiveFileChangeTab.tsx',
      'features/inspector/ui/BrowserToolbar.tsx',
      'features/inspector/ui/ProblemsTab.tsx',
      'features/inspector/ui/FileTreeSidebar.tsx',
      'features/inspector/ui/PeekDefinitionPanel.tsx',
      'features/inspector/ui/search/ContentSearchView.tsx',
      'features/secrets/ui/VaultItemsView.tsx',
      'features/search/ui/GlobalSearchTab.tsx',
      // Every diff surface (settled tab, live patch, plugin staging) mounts VirtualDiff,
      // whose one DiffToolbar is the shared bar.
      'shared/ui/diff/DiffToolbar.tsx',
    ]) {
      expect(read(path)).toContain('WorkbenchToolbar')
    }
    for (const path of [
      'features/inspector/ui/LivePatchDiff.tsx',
      'widgets/editor-grid/ui/DiffWorkItemBody.tsx',
    ]) {
      expect(read(path)).toContain('<VirtualDiff')
    }

    for (const path of [
      'features/inspector/ui/MessageReplayTab.tsx',
      'features/inspector/ui/LiveFileChangeTab.tsx',
      'features/inspector/ui/BrowserToolbar.tsx',
      'features/inspector/ui/FileTreeSidebar.tsx',
      'features/inspector/ui/PeekDefinitionPanel.tsx',
      'features/inspector/ui/search/ContentSearchView.tsx',
      'shared/ui/diff/DiffToolbar.tsx',
    ]) {
      expect(read(path)).toContain('WorkbenchToolbarSection')
    }

    for (const path of [
      'features/inspector/ui/ProblemsTab.tsx',
      'features/inspector/ui/search/ContentSearchView.tsx',
    ]) {
      expect(read(path)).toContain('WorkbenchStatusBar')
    }

    const panelHeader = readKit('layout/panel-header.tsx')
    expect(panelHeader).toContain('icon?: ReactNode')
    expect(panelHeader).toContain('actionsLabel?: string')
    expect(panelHeader).toContain('role="group"')
  })

  test('reserves named toolbar rows for viewer controls', () => {
    const primitive = readKit('layout/workbench-toolbar.tsx')
    expect(primitive).toContain('role="group"')
    expect(primitive).toContain('z-(--z-controls)')
    expect(primitive).not.toContain('role="toolbar"')

    for (const path of [
      'features/inspector/ui/BridgedPluginView.tsx',
      'features/inspector/ui/FileEditorToolbar.tsx',
      'features/inspector/ui/FileImageView.tsx',
      'features/inspector/ui/FileReadonlyView.tsx',
      'shared/ui/diff/DiffToolbar.tsx',
    ]) {
      const source = read(path)
      expect(source).toContain('<WorkbenchToolbar')
      expect(source).not.toContain('<FloatingActionGroup')
      expect(source).not.toMatch(/absolute right-2 top-2 z-(?:10|20)/)
    }
    expect(read('shared/ui/diff/VirtualDiff.tsx')).toContain('<DiffToolbar')
    expect(read('shared/ui/diff/DiffViewModeToggle.tsx')).toContain('embedded')

    const actionPill = readKit('controls/action-pill.tsx')
    expect(actionPill).toContain('<Button')
    expect(actionPill).toContain('size="xs"')
    // The tooltip now sits in `overlays/`, so any relative import of it ends in `/tooltip'`.
    expect(actionPill).not.toContain("/tooltip'")
  })

  test('keeps transient workbench notices on one neutral in-flow primitive', () => {
    const primitive = readKit('feedback/workbench-notice-bar.tsx')
    expect(primitive).toContain('min-h-[var(--chrome-control-lg)]')
    // A foreground VEIL, not the pane's ground: a notice bar sits INSIDE a pane that already
    // painted `bg-background`, and the glass theme's paint-once rule cleared the duplicate coat —
    // leaving the strip unfilled. The veil separates it from the pane in every theme.
    expect(primitive).toContain('border-b border-border-soft bg-foreground/[0.04]')
    expect(primitive).toContain("layout === 'stacked'")
    expect(primitive).not.toContain('role="alert"')
    expect(primitive).not.toContain('role="status"')

    for (const path of [
      'features/chat/ui/prompt-input/StatusTipStrip.tsx',
      'features/chat/ui/prompt-input/SpendAlertStrip.tsx',
      'features/inspector/ui/FileTab.tsx',
      'features/inspector/ui/ConflictCompareBar.tsx',
    ]) {
      expect(read(path)).toContain('WorkbenchNoticeBar')
    }
    expect(readKit('feedback/dismissible-hint.tsx')).toContain('WorkbenchNoticeBar')
  })

  test('orders app overlays by semantic layer instead of a shared magic tier', () => {
    const css = readKitStylesheet()
    const value = (token: string) =>
      Number(css.match(new RegExp(`${token}: (\\d+);`))?.[1] ?? Number.NaN)

    expect(value('--z-navigation-backdrop')).toBeLessThan(value('--z-sidebar'))
    expect(value('--z-sidebar')).toBeLessThan(value('--z-modal-backdrop'))
    expect(value('--z-modal-backdrop')).toBeLessThan(value('--z-modal'))
    expect(value('--z-modal')).toBeLessThan(value('--z-popover'))
    expect(value('--z-popover')).toBeLessThan(value('--z-tooltip'))

    for (const path of [
      'overlays/dialog.tsx',
      'overlays/drawer.tsx',
      'overlays/confirm-dialog.tsx',
    ]) {
      const source = readKit(path)
      expect(source).toContain('z-(--z-modal-backdrop)')
      expect(source).toContain('z-(--z-modal)')
    }
    const shell = read('widgets/workspace-shell/ui/WorkspaceShell.tsx')
    expect(shell).toContain('z-(--z-navigation-backdrop)')
    expect(shell).toContain('z-(--z-sidebar)')
    expect(readKit('overlays/tooltip.tsx')).toContain('z-(--z-tooltip)')
    const dialog = readKit('overlays/dialog.tsx')
    const paneDialog = dialog.slice(dialog.indexOf('function PaneDialog'))
    expect(paneDialog).toContain('z-(--z-overlay)')
    expect(paneDialog).not.toContain('DialogPrimitive.Portal')
    for (const path of [
      'overlays/dialog.tsx',
      'overlays/drawer.tsx',
      'overlays/confirm-dialog.tsx',
    ]) {
      expect(readKit(path)).toContain('modalSurface')
    }
  })

  test('uses one sash primitive across editor, shell, table and nested panels', () => {
    const css = readKitStylesheet()
    const primitive = readKit('controls/button.tsx')
    expect(css).toContain(".lx-sash[aria-orientation='vertical']")
    expect(css).toContain(".lx-sash[aria-orientation='horizontal']")
    expect(css).toContain('.lx-sash:focus-visible::after')
    expect(primitive).toContain('data-slot="workbench-sash"')
    expect(primitive).toContain("className={cn('lx-sash', className)}")
    expect(primitive).toContain('aria-description={hint}')
    for (const source of [
      read('widgets/editor-grid/ui/GridView.tsx'),
      read('widgets/workspace-shell/ui/WorkspaceShell.tsx'),
      read('features/inspector/ui/table/HeaderCell.tsx'),
      readKit('layout/collapsible-section.tsx'),
    ]) {
      expect(source).toContain('<WorkbenchSash')
      expect(source).not.toContain('title="Drag to resize')
    }
    const editorGrid = read('widgets/editor-grid/ui/GridView.tsx')
    expect(editorGrid).toContain('onKeyDown={resizeWithKeyboard}')
    const shell = read('widgets/workspace-shell/ui/WorkspaceShell.tsx')
    expect(shell).toContain('onKeyDown={onResizeKeyDown}')
    expect(shell).toContain('valueNow={sidebarWidth}')
    expect(read('features/inspector/ui/table/HeaderCell.tsx')).toContain(
      'onKeyDown={(e) => onResizeKeyDown(col.id, e)}',
    )
  })
})
