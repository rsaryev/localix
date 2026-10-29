import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { tsxSourcesUnder } from '@localixai/kit/testing/jsx-contract'
import {
  dialogBodyViolations,
  dialogWidthOffenders,
  MODAL_BACKDROP_TOKEN,
  MODAL_LIBRARY_IMPORT,
} from '@localixai/kit/testing/overlay-contracts'

/**
 * The product-wide halves of the kit's modal-surface contracts.
 *
 * The kit proves its three modal shells (`dialog`, `confirm-dialog`, `drawer`) keep one scroll
 * owner, one width tier and one scrim (`packages/kit/src/overlays/modal-surface.test.tsx`). That
 * proves nothing about a product dialog that forgets its `DialogBody`, measures itself by hand, or
 * reaches past the shells to radix/vaul and paints its own scrim. The kit never reads the host, so
 * the same detectors — with their positive controls in the kit — run over the app and the mini apps
 * here.
 */
const REPO_ROOT = new URL('../../../../../', import.meta.url).pathname
const hostSources = () => tsxSourcesUnder(REPO_ROOT, ['apps/ui/src'])

describe('modal surface regions', () => {
  test('every current and future standard dialog declares its one scroll-owning body', async () => {
    const { checked, violations } = dialogBodyViolations(await hostSources())
    expect(violations).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })

  test('a dialog states its width through the size tier, never through className', async () => {
    // `w-…`, `max-w-…`, `min-w-…` at any breakpoint or arbitrary value. Anything that decides
    // how wide the shell is belongs to DIALOG_CONTENT_SIZE, which also carries the viewport
    // clamp a hand-written measure keeps forgetting.
    const { checked, violations } = dialogWidthOffenders(await hostSources())
    expect(checked).toBeGreaterThan(0)
    expect(
      violations,
      `use the DialogContent \`size\` prop instead:\n${violations.join('\n')}`,
    ).toEqual([])
  })

  /**
   * PROVENANCE. A surface that reaches past the kit's modal shells gets a dialog that is *almost*
   * the app's: right shape, wrong material, its own scrim, its own z-index. The shells all live in
   * the kit now, so no product file is an owner: any import of the dialog libraries, and any use
   * of the scrim token, is an offender. The kit's half checks that the three owners still exist,
   * so a renamed shell cannot empty that allowlist unnoticed.
   */
  test('only the three modal shells reach the dialog libraries', async () => {
    const sources = await hostSources()
    const offenders = sources
      .filter(({ source }) => MODAL_LIBRARY_IMPORT.test(source))
      .map(({ path }) => path)
    // A scan that read nothing would pass over a repo full of hand-rolled dialogs.
    expect(sources.length).toBeGreaterThan(0)
    expect(
      offenders,
      `import from '@localixai/kit/dialog' (or confirm-dialog / drawer) instead:\n${offenders.join('\n')}`,
    ).toEqual([])

    // Positive control: the kit's own spelling is not a reach past the shell.
    expect(MODAL_LIBRARY_IMPORT.test("import { Dialog } from 'radix-ui'")).toBe(true)
    expect(MODAL_LIBRARY_IMPORT.test("import { Dialog } from '@localixai/kit/dialog'")).toBe(false)
  })

  test('nobody paints their own modal scrim', async () => {
    const offenders = (await hostSources())
      .filter(({ source }) => source.includes(MODAL_BACKDROP_TOKEN))
      .map(({ path }) => path)
    expect(
      offenders,
      `a modal's backdrop belongs to its shell, not to the surface opening it:\n${offenders.join('\n')}`,
    ).toEqual([])

    // Positive control: the scanner reads the token its owner actually writes.
    const owner = readFileSync(`${REPO_ROOT}/packages/kit/src/overlays/confirm-dialog.tsx`, 'utf8')
    expect(owner).toContain(MODAL_BACKDROP_TOKEN)
  })
})
