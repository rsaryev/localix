import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { tsxSourcesUnder } from '@localixai/kit/testing/jsx-contract'
import {
  commandDialogViolations,
  drawerWidthOffenders,
  structuredPopoverViolations,
} from '@localixai/kit/testing/overlay-contracts'

/**
 * The product-wide halves of the kit's floating-surface contracts.
 *
 * The kit proves its own overlays compose correctly (`packages/kit/src/overlays/*.test.ts*`), but
 * a primitive is only as good as the way the product composes it: a palette without its list, a
 * popover with a header and no scrolling body, a drawer override that silently loses to the cap.
 * The kit never reads the host, so the same detectors — with their positive controls in the kit —
 * run over the app and the plugins here, and the cases that pin one product surface live here too.
 */
const REPO_ROOT = new URL('../../../../../', import.meta.url).pathname
const hostSources = () => tsxSourcesUnder(REPO_ROOT, ['apps/ui/src', 'plugins'])
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('command input glyph', () => {
  test('every dialog palette owns one command root, input, and scrolling list', async () => {
    const { checked, violations } = commandDialogViolations(await hostSources())
    expect(violations).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })
})

describe('drawer width overrides', () => {
  test('a wider drawer says so at the same breakpoint the cap uses', async () => {
    // `DrawerContent` caps itself at `md:max-w-205`. Tailwind emits media-query rules after
    // unprefixed ones, so a bare `max-w-*` override LOSES at md and up — silently, with no
    // error and no visual clue except a squashed panel. That is exactly what happened to the
    // agent editor's model picker: the list collapsed to ~300px and every model name rendered
    // as a single letter. An override must therefore carry the `md:` prefix.
    expect(drawerWidthOffenders(await hostSources())).toEqual([])
  })
})

describe('workbench floating-surface contracts', () => {
  test('every structured popover keeps pinned regions around one scrolling body', async () => {
    const { checked, violations } = structuredPopoverViolations(await hostSources())
    expect(violations).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })

  test('exclusive floating choices use primitives that own complete keyboard behavior', () => {
    // The composer's mode picker was this contract's other live instance; with agent modes
    // gone there is no exclusive choice left in the composer (the model picker is a list, not
    // a radio group). The rule still binds every popover that offers one — the assertion below
    // keeps a real instance under it rather than leaving the test asserting nothing.
    const composerContext = read('../../widgets/chat-workspace/ui/ComposerContextBar.tsx')
    expect(composerContext).toContain('<ProjectFolderMenu')
    const projectMenu = read('../../entities/chat/ui/ProjectFolderMenu.tsx')
    expect(projectMenu).toContain('<DropdownMenu')
    expect(projectMenu).toMatch(/<MenuEntries[\s\S]*family="dropdown"/)
    expect(projectMenu).toContain('selected: project.id === activeProjectId')
  })
})

describe('a panel that floats over content the app does not own', () => {
  test('the shared comment card picks it by where it floats, not by who renders it', () => {
    // One card serves text surfaces and the preview, so the choice cannot live with a caller: it is
    // a prop the surface answers, and the preview is the surface that answers "foreign".
    const card = read('./comments/AnchoredCommentCard.tsx')
    expect(card).toContain('POPOVER_SURFACE_OVER_FOREIGN')
    expect(card).toContain("material === 'foreign'")

    const previewLayer = read('../../features/inspector/ui/VisualFeedbackLayer.tsx')
    expect(previewLayer).toContain('material="foreign"')
  })
})
