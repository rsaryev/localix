import { jsxElementContracts, jsxElementsNamed, type WorkspaceTsxSource } from './jsx-contract'

/**
 * The overlay composition rules, stated ONCE.
 *
 * Each rule has two halves: the kit proves its own sources keep it, and the host proves the app
 * and the mini apps do (`apps/ui/src/shared/ui/overlays.contract.test.ts`,
 * `modal-surface.contract.test.ts`), because the kit never reads the host. Two copies of a
 * detector drift — one half tightens a pattern, the other keeps passing over the shape it stopped
 * seeing — so both halves call these, over different sources, and the positive controls in the
 * kit's tests cover both at once.
 *
 * Each walk reports how many instances it CHECKED beside what it found, so a caller can refuse a
 * green result that came from reading nothing.
 */
export interface ContractScan {
  checked: number
  violations: string[]
}

/** `className="…"` values on a `<DrawerContent` tag. */
export function drawerContentClasses(source: string): string[] {
  const out: string[] = []
  for (const match of source.matchAll(/<DrawerContent\b[\s\S]{0,400}?>/g)) {
    const cls = /className="([^"]*)"/.exec(match[0])
    if (cls) out.push(cls[1]!)
  }
  return out
}

/** An unprefixed `max-w-*`, which LOSES to the drawer's own `md:max-w-205` at md and up. */
export const BARE_MAX_WIDTH = /(?:^|\s)(max-w-\S+)/

/** Every `<DrawerContent>` override that states a width without the breakpoint the cap uses. */
export function drawerWidthOffenders(sources: readonly WorkspaceTsxSource[]): string[] {
  const offenders: string[] = []
  for (const { path, source } of sources) {
    for (const cls of drawerContentClasses(source)) {
      const bare = cls.match(BARE_MAX_WIDTH)
      if (bare) offenders.push(`${path}: ${bare[1]} needs the md: prefix to beat md:max-w-205`)
    }
  }
  return offenders
}

/** Every `<CommandDialog>` that does not hold exactly one root, input and scrolling list. */
export function commandDialogViolations(sources: readonly WorkspaceTsxSource[]): ContractScan {
  const scan: ContractScan = { checked: 0, violations: [] }
  for (const { path, source } of sources) {
    if (!source.includes('<CommandDialog')) continue
    for (const contract of jsxElementContracts(path, source, 'CommandDialog')) {
      scan.checked += 1
      for (const tagName of ['Command', 'CommandInput', 'CommandList']) {
        const count = contract.descendantCount(tagName)
        if (count !== 1) {
          scan.violations.push(
            `${path}:${contract.line} must contain exactly one ${tagName} (found ${count})`,
          )
        }
      }
    }
  }
  return scan
}

/**
 * Every `<PopoverContent>` whose layout and regions disagree: a structured region needs
 * `layout="structured"`, and a structured popover needs its one scrolling `PopoverBody`.
 */
export function structuredPopoverViolations(sources: readonly WorkspaceTsxSource[]): ContractScan {
  const scan: ContractScan = { checked: 0, violations: [] }
  for (const { path, source } of sources) {
    if (!source.includes('<PopoverContent')) continue
    for (const contract of jsxElementContracts(path, source, 'PopoverContent')) {
      scan.checked += 1
      const structured = contract.stringAttribute('layout') === 'structured'
      const hasBody = contract.hasDescendant('PopoverBody')
      const hasStructuredRegion =
        contract.hasDescendant('PopoverHeader') ||
        hasBody ||
        contract.hasDescendant('PopoverFooter')

      if (structured !== hasStructuredRegion) {
        scan.violations.push(
          `${path}:${contract.line} must opt into structured layout when it uses a structured region`,
        )
      }
      if (structured && !hasBody) {
        scan.violations.push(`${path}:${contract.line} must declare the one scrolling PopoverBody`)
      }
    }
  }
  return scan
}

/** Every `<DialogContent>` that owns (edge-to-edge) or lacks (standard) its one `DialogBody`. */
export function dialogBodyViolations(sources: readonly WorkspaceTsxSource[]): ContractScan {
  const scan: ContractScan = { checked: 0, violations: [] }
  for (const { path, source } of sources) {
    if (!source.includes('<DialogContent')) continue
    for (const contract of jsxElementContracts(path, source, 'DialogContent')) {
      scan.checked += 1
      const edgeToEdge = contract.stringAttribute('layout') === 'edge-to-edge'
      if (contract.hasDescendant('DialogBody') === edgeToEdge) {
        scan.violations.push(
          `${path}:${contract.line} must ${edgeToEdge ? 'not own' : 'declare'} DialogBody`,
        )
      }
    }
  }
  return scan
}

/**
 * `w-…`, `max-w-…`, `min-w-…` at any breakpoint or arbitrary value. Anything that decides how wide
 * a dialog shell is belongs to DIALOG_CONTENT_SIZE, which also carries the viewport clamp a
 * hand-written measure keeps forgetting.
 */
export const WIDTH_UTILITY = /(?:^|\s)(?:[a-z-]+:)*(?:min-|max-)?w-/u

/** Every `<DialogContent className="…">` that states its own width. */
export function dialogWidthOffenders(sources: readonly WorkspaceTsxSource[]): ContractScan {
  const scan: ContractScan = { checked: 0, violations: [] }
  for (const { path, source } of sources) {
    if (!source.includes('<DialogContent')) continue
    for (const element of jsxElementsNamed(path, source, 'DialogContent')) {
      scan.checked += 1
      const className = element.stringAttribute('className')
      if (className && WIDTH_UTILITY.test(className)) {
        scan.violations.push(`${path}:${element.line} — className="${className}"`)
      }
    }
  }
  return scan
}

/**
 * `import { Dialog … } from 'radix-ui'` / `from 'vaul'` — the reach past the kit's own modal
 * shells. A surface that reaches past them gets a dialog that is *almost* the app's: right shape,
 * wrong material, its own scrim, its own z-index, its own idea of where the footer sits.
 */
export const MODAL_LIBRARY_IMPORT =
  /import\s*(?:\*\s*as\s*\w+|\{[^}]*\b(?:Dialog|AlertDialog|Drawer)\b[^}]*\})\s*from\s*['"](?:radix-ui|@radix-ui\/react-(?:alert-)?dialog|vaul)['"]/u

/** The modal scrim's stacking token. One backdrop recipe, owned by the three shells. */
export const MODAL_BACKDROP_TOKEN = 'z-(--z-modal-backdrop)'
