import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'
import { kitTsxSources } from '../testing/jsx-contract'
import {
  dialogBodyViolations,
  dialogWidthOffenders,
  MODAL_BACKDROP_TOKEN,
  MODAL_LIBRARY_IMPORT,
} from '../testing/overlay-contracts'

/**
 * This file renders markup, so it registers a DOM and loads react-dom and the dialog/drawer
 * modules INSIDE its tests — never at module scope.
 *
 * Both halves matter, and neither is about this file. Bun evaluates every test file's graph
 * before any hook runs and keeps one module registry for the whole process, so a static import
 * here initialized the dialog stack — Radix decides AT MODULE INIT whether it is in a browser —
 * while no `document` existed. Any DOM test that mounted a drawer later in the same run then
 * rendered nothing at all, silently, in that file only: `bun test src/shared/ui <that file>`
 * failed while either alone passed. Registering the DOM first makes the initialization the
 * browser one, whatever order the files are given in.
 */
let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())

const modalRegions = async () => {
  const [{ renderToStaticMarkup }, dialog, drawer] = await Promise.all([
    import('react-dom/server'),
    import('./dialog'),
    import('./drawer'),
  ])
  return { renderToStaticMarkup, ...dialog, ...drawer }
}

describe('modal surface regions', () => {
  test('dialog header and footer name their action groups, aside before actions', async () => {
    const { renderToStaticMarkup, DialogFooter, DialogHeader } = await modalRegions()
    const dialogHeader = renderToStaticMarkup(
      <DialogHeader actions={<button>Copy</button>} actionsLabel="Document actions">
        Context
      </DialogHeader>,
    )
    const dialogFooter = renderToStaticMarkup(
      <DialogFooter aside={<label htmlFor="remember">Remember choice</label>}>
        <button>Cancel</button>
        <button>Save</button>
      </DialogFooter>,
    )

    expect(dialogHeader).toContain('data-slot="dialog-header-main"')
    expect(dialogHeader).toContain('data-slot="dialog-header-actions"')
    expect(dialogHeader).toContain('role="group" aria-label="Document actions"')
    expect(dialogFooter).toContain('data-slot="dialog-footer-aside"')
    expect(dialogFooter).toContain('data-slot="dialog-footer-actions"')
    expect(dialogFooter).toContain('role="group" aria-label="Dialog actions"')
    expect(dialogFooter.indexOf('dialog-footer-aside')).toBeLessThan(
      dialogFooter.indexOf('dialog-footer-actions'),
    )
  })

  test('every current and future standard kit dialog declares its one scroll-owning body', async () => {
    // The kit's own dialogs; the product's are the host half, in
    // `apps/ui/src/shared/ui/modal-surface.contract.test.ts`, because the kit never reads the host.
    const { checked, violations } = dialogBodyViolations(await kitTsxSources())
    expect(violations).toEqual([])
    expect(checked).toBeGreaterThan(0)

    // Positive control: both directions of the rule are read.
    const scan = (source: string) => dialogBodyViolations([{ path: 'x.tsx', source }]).violations
    expect(scan('<DialogContent><DialogBody /></DialogContent>')).toEqual([])
    expect(scan('<DialogContent><p /></DialogContent>')).toEqual([
      'x.tsx:1 must declare DialogBody',
    ])
    expect(scan('<DialogContent layout="edge-to-edge"><DialogBody /></DialogContent>')).toEqual([
      'x.tsx:1 must not own DialogBody',
    ])
  })

  test('a dialog states its width through the size tier, never through className', async () => {
    // `w-…`, `max-w-…`, `min-w-…` at any breakpoint or arbitrary value (`WIDTH_UTILITY`). The
    // kit's own dialogs; the product's are the host half, in
    // `apps/ui/src/shared/ui/modal-surface.contract.test.ts`.
    const { checked, violations } = dialogWidthOffenders(await kitTsxSources())
    expect(checked).toBeGreaterThan(0)
    expect(
      violations,
      `use the DialogContent \`size\` prop instead:\n${violations.join('\n')}`,
    ).toEqual([])

    // Positive control: a hand-written measure at any breakpoint is read; the size tier is not.
    const scan = (source: string) => dialogWidthOffenders([{ path: 'x.tsx', source }]).violations
    expect(scan('<DialogContent className="sm:max-w-lg p-0" />')).toHaveLength(1)
    expect(scan('<DialogContent className="w-[40rem]" />')).toHaveLength(1)
    expect(scan('<DialogContent size="lg" className="p-0" />')).toEqual([])
  })

  test('modal surfaces scroll on one axis, and no dialog surface hides an x scrollbar', async () => {
    // `overflow-x-hidden` is the mask, not the fix: the box is still an x scroll container, so
    // whatever overflowed became unreachable rather than absent — and paired with a `visible`
    // y it drags that axis into `auto` too. Dialog surfaces use `clip`, which cannot scroll,
    // and the content is expected to wrap before it ever gets there.
    const dialogSurfaces = [
      'modal-surface.ts',
      'dialog.tsx',
      'drawer.tsx',
      'command.tsx',
      'confirm-dialog.tsx',
    ]
    for (const file of dialogSurfaces) {
      const text = await Bun.file(new URL(`./${file}`, import.meta.url)).text()
      expect(text, `${file} must not hide a horizontal scrollbar`).not.toContain(
        'overflow-x-hidden',
      )
    }
    // The product's interaction views that render inside these surfaces, and how each breaks an
    // unbreakable string, are the host half: `apps/ui/src/shared/ui/modal-surface.contract.test.ts`.
  })

  /**
   * PROVENANCE, the rule this file was missing.
   *
   * Everything above checks how a modal that already goes through `dialog.tsx` /
   * `confirm-dialog.tsx` / `drawer.tsx` behaves. Nothing checked that a modal goes through them at
   * all — and a surface that reaches past the primitive gets a dialog that is *almost* the app's:
   * right shape, wrong material, its own scrim, its own z-index, its own idea of where the footer
   * sits (`MODAL_LIBRARY_IMPORT`). The menu surface learned this the hard way
   * (`scripts/menu-surface-guard.test.ts`); the modal surface is the same argument with a bigger
   * blast radius, because a dialog is the app's most interruptive surface and the one a person
   * judges its polish by.
   *
   * Two rules, each run against a planted defect below so a green line means the scanner reads.
   * These are the kit halves — inside the kit only the three shells may reach the libraries — and
   * `apps/ui/src/shared/ui/modal-surface.contract.test.ts` holds the same rules over the product.
   */
  const MODAL_PRIMITIVE_OWNERS = new Set([
    'src/overlays/dialog.tsx',
    'src/overlays/confirm-dialog.tsx',
    'src/overlays/drawer.tsx',
  ])

  test('only the three modal shells reach the dialog libraries', async () => {
    const offenders: string[] = []
    let checked = 0
    for (const { path: sourcePath, source } of await kitTsxSources()) {
      if (MODAL_PRIMITIVE_OWNERS.has(sourcePath)) {
        checked += 1
        continue
      }
      if (MODAL_LIBRARY_IMPORT.test(source)) offenders.push(sourcePath)
    }
    // Every owner was seen, so a renamed primitive fails here rather than silently emptying the
    // allowlist and letting the rule pass over a repo full of hand-rolled dialogs.
    expect(checked).toBe(MODAL_PRIMITIVE_OWNERS.size)
    expect(
      offenders,
      `import from './dialog' (or ./confirm-dialog / ./drawer) instead:\n${offenders.join('\n')}`,
    ).toEqual([])

    // Positive control.
    expect(MODAL_LIBRARY_IMPORT.test("import { Dialog, DialogContent } from 'radix-ui'")).toBe(true)
    expect(MODAL_LIBRARY_IMPORT.test("import { Drawer as D } from 'vaul'")).toBe(true)
    expect(MODAL_LIBRARY_IMPORT.test("import { Dialog } from './dialog'")).toBe(false)
  })

  test('nobody paints their own modal scrim', async () => {
    const offenders: string[] = []
    for (const { path: sourcePath, source } of await kitTsxSources()) {
      if (MODAL_PRIMITIVE_OWNERS.has(sourcePath)) continue
      if (source.includes(MODAL_BACKDROP_TOKEN)) offenders.push(sourcePath)
    }
    expect(
      offenders,
      `a modal's backdrop belongs to its shell, not to the surface opening it:\n${offenders.join('\n')}`,
    ).toEqual([])

    // Positive control: the scanner reads the token it is looking for.
    const owner = await Bun.file(new URL('./confirm-dialog.tsx', import.meta.url)).text()
    expect(owner).toContain(MODAL_BACKDROP_TOKEN)
  })
})
