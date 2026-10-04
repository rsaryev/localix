import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'
import { kitTsxSources } from '../testing/jsx-contract'
import {
  dialogBodyViolations,
  dialogWidthOffenders,
  MODAL_BACKDROP_TOKEN,
  MODAL_LIBRARY_IMPORT,
} from '../testing/overlay-contracts'
import { readKitStylesheet } from '../testing/stylesheet'
import {
  modalBody,
  modalFooter,
  modalFooterActions,
  modalHeader,
  modalHeaderActions,
  modalShell,
  modalSurface,
} from './modal-surface'

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
  test('long dialog and drawer bodies share one shrink-and-scroll contract', async () => {
    const { renderToStaticMarkup, DialogBody, DrawerBody } = await modalRegions()
    expect(modalSurface).toContain('lx-modal-surface')
    expect(modalShell).toContain('min-h-0')
    expect(modalShell).toContain('overflow-hidden')
    expect(modalBody).toContain('min-h-0')
    expect(modalBody).toContain('flex-1')
    // One axis, stated: `clip` cannot scroll and does not pull `overflow-y` into pairing.
    expect(modalBody).toContain('overflow-x-clip')
    expect(modalBody).not.toContain('overflow-x-hidden')
    expect(modalBody).toContain('overflow-y-auto')
    expect(modalBody).toContain('overscroll-contain')

    const dialog = renderToStaticMarkup(<DialogBody>Dialog fields</DialogBody>)
    const drawer = renderToStaticMarkup(<DrawerBody>Drawer fields</DrawerBody>)

    expect(dialog).toContain('data-slot="dialog-body"')
    expect(drawer).toContain('data-slot="drawer-body"')
    expect(dialog).toContain('overflow-y-auto')
    expect(drawer).toContain('overflow-y-auto')
  })

  test('context and actions remain pinned around the one scrollable body', async () => {
    const { renderToStaticMarkup, DialogFooter, DialogHeader, DrawerFooter, DrawerHeader } =
      await modalRegions()
    expect(modalHeader).toContain('shrink-0')
    expect(modalFooter).toContain('shrink-0')
    expect(modalFooter).toContain('border-t')
    expect(modalFooter).toContain('flex-col-reverse')
    expect(modalFooterActions).toContain('flex-col-reverse')
    expect(modalFooterActions).toContain('sm:justify-end')
    expect(modalHeaderActions).toContain('justify-end')

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
    const drawerHeader = renderToStaticMarkup(<DrawerHeader>Context</DrawerHeader>)
    const drawerFooter = renderToStaticMarkup(<DrawerFooter>Actions</DrawerFooter>)

    for (const region of [dialogHeader, dialogFooter, drawerHeader, drawerFooter]) {
      expect(region).toContain('shrink-0')
    }
    expect(dialogFooter).toContain('border-t')
    expect(drawerFooter).toContain('border-t')
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

  test('reserves dialog title actions and keeps confirmation detail scrollable', async () => {
    const dialogSource = await Bun.file(new URL('./dialog.tsx', import.meta.url)).text()
    const confirmSource = await Bun.file(new URL('./confirm-dialog.tsx', import.meta.url)).text()
    expect(dialogSource).toContain(
      '<ModalHeaderRegion slot="dialog" className={cn(\'pr-10\', className)}',
    )
    expect(confirmSource).toContain('<div className={modalBody}>')
    expect(confirmSource.indexOf('<div className={modalBody}>')).toBeLessThan(
      confirmSource.indexOf('<ModalFooterRegion slot="alert-dialog"'),
    )
  })

  test('modal shells are viewport-clamped and use semantic stacking tokens', async () => {
    const dialogSource = await Bun.file(new URL('./dialog.tsx', import.meta.url)).text()
    const drawerSource = await Bun.file(new URL('./drawer.tsx', import.meta.url)).text()

    expect(dialogSource).toContain('max-h-[calc(100dvh-2rem)]')
    expect(drawerSource).toContain('max-h-[calc(100dvh-0.5rem)]')
    expect(dialogSource).toContain('z-(--z-modal)')
    expect(drawerSource).toContain('z-(--z-modal)')
    expect(dialogSource).toContain('z-(--z-modal-backdrop)')
    expect(drawerSource).toContain('z-(--z-modal-backdrop)')
    expect(dialogSource).toContain('modalShell')
    expect(drawerSource).toContain('modalShell')
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

    const dialogSource = await Bun.file(new URL('./dialog.tsx', import.meta.url)).text()
    expect(dialogSource).toContain("type DialogContentLayout = 'standard' | 'edge-to-edge'")
    expect(dialogSource).toContain('data-layout={layout}')
    expect(dialogSource).toContain("layout = 'standard'")
  })

  test('the modal material is frosted on every platform, with the opaque fallbacks intact', async () => {
    const css = readKitStylesheet()
    // The base recipe must exist OUTSIDE any `[data-os='mac']` scope, or dialogs are glass in
    // the packaged Mac app and flat cards everywhere else — which is what they were.
    const base = css.indexOf('\n.lx-modal-surface {')
    expect(base).toBeGreaterThan(-1)
    const recipe = css.slice(base, base + 400)
    expect(recipe).toContain('backdrop-filter: blur(')
    // Translucency without a frost is a see-through hole; the two ship together.
    expect(css).toContain(
      'background-color: color-mix(in oklch, var(--surface-raised) 86%, oklch(0 0 0 / 0))',
    )
    // Both accessibility/capability escapes go back to the opaque token.
    const noBackdrop = css.indexOf(
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {\n  .lx-modal-surface {',
    )
    expect(noBackdrop).toBeGreaterThan(-1)
    expect(css.slice(noBackdrop, noBackdrop + 260)).toContain(
      'background-color: var(--surface-raised)',
    )
    const themedModal = ":root:is([data-theme='dark'], [data-theme='light']) .lx-modal-surface {"
    const themedRecipe = css.indexOf(themedModal)
    expect(themedRecipe).toBeGreaterThan(-1)
    const themedBlock = css.slice(themedRecipe, css.indexOf('}', themedRecipe))
    expect(themedBlock).toContain(
      'background-color: color-mix(in oklch, var(--window-ground) 55%, transparent)',
    )
    expect(themedBlock).toContain('-webkit-backdrop-filter: blur(24px) saturate(1.1)')
    expect(themedBlock).toContain('backdrop-filter: blur(24px) saturate(1.1)')

    const reducedTransparency = css.indexOf(
      '@media (prefers-reduced-transparency: reduce), (forced-colors: active)',
      themedRecipe,
    )
    expect(reducedTransparency).toBeGreaterThan(themedRecipe)
    const themedFallback = css.indexOf(themedModal, reducedTransparency)
    expect(themedFallback).toBeGreaterThan(reducedTransparency)
    const fallbackBlock = css.slice(themedFallback, css.indexOf('}', themedFallback))
    expect(fallbackBlock).toContain('background-color: var(--surface-raised)')
    expect(fallbackBlock).toContain('-webkit-backdrop-filter: none')
    expect(fallbackBlock).toContain('backdrop-filter: none')
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

  test('the command palette labels the actual portalled content subtree', async () => {
    const source = await Bun.file(new URL('./command.tsx', import.meta.url)).text()
    const content = source.indexOf('<DialogContent')
    const header = source.indexOf('<DialogHeader', content)
    const close = source.indexOf('</DialogContent>', content)
    expect(content).toBeGreaterThan(-1)
    expect(header).toBeGreaterThan(content)
    expect(header).toBeLessThan(close)
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
