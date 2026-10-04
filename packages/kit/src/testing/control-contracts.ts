import {
  jsxElementsNamed,
  jsxElementsWithStringAttribute,
  type WorkspaceTsxSource,
} from './jsx-contract'

/**
 * The control ownership rules, stated ONCE.
 *
 * Each rule has two halves: the kit proves its own sources keep it, and the host proves the app
 * and the plugins do (`apps/ui/src/shared/ui/controls.contract.test.ts`), because the kit never
 * reads the host. Two copies of a detector drift — one half tightens a regex, the other keeps
 * passing over the shape it stopped seeing — so both halves call these, over different sources.
 */

/** A raw native checkbox: `<input … type="checkbox" …>`, either JSX spelling of the value. */
export const RAW_CHECKBOX = new RegExp(
  [
    String.raw`<input\b`,
    String.raw`(?=[^>]*\btype\s*=\s*(?:["']checkbox["']|\{\s*["']checkbox["']\s*\}))`,
    String.raw`[^>]*>`,
  ].join(''),
  's',
)

const JSX_RADIO_VALUE = String.raw`(?:["']radio(?:group)?["']|\{\s*["']radio(?:group)?["']\s*\})`
/** A hand-rolled radio: an intrinsic element typed or roled `radio` / `radiogroup`. */
export const RAW_RADIO = new RegExp(
  String.raw`<[a-z][a-z0-9:-]*\b[^>]*(?:\btype\s*=\s*${JSX_RADIO_VALUE}|\brole\s*=\s*${JSX_RADIO_VALUE})[^>]*>`,
  's',
)

/** A native `<select>`, whose keyboard model is the platform's and not the shared Select's. */
export const RAW_SELECT = /<select\b/s

/** A hand-rolled switch: an intrinsic element carrying `role="switch"`. */
export const RAW_SWITCH_ROLE =
  /<[a-z][^>]*\brole\s*=\s*(?:["']switch["']|\{\s*["']switch["']\s*\})[^>]*>/s

export interface RawOwnerScan {
  /** Absolute directory the `roots` and the returned paths are relative to. */
  cwd: string
  roots: readonly string[]
  pattern: RegExp
  /** Skip `*.test.tsx`. The checkbox rule has always read tests too; the others never did. */
  skipTests: boolean
  /** The primitives that ARE the owner, as `cwd`-relative paths. */
  owners?: ReadonlySet<string>
}

/** Every `.tsx` under `roots` whose text matches `pattern`, owners excluded. */
export async function rawOwnerFiles(scan: RawOwnerScan): Promise<string[]> {
  const offenders: string[] = []
  for (const root of scan.roots) {
    for (const path of new Bun.Glob('**/*.tsx').scanSync({ cwd: `${scan.cwd}/${root}` })) {
      const relative = `${root}/${path}`
      if (scan.owners?.has(relative)) continue
      if (scan.skipTests && relative.endsWith('.test.tsx')) continue
      const source = await Bun.file(`${scan.cwd}/${relative}`).text()
      if (scan.pattern.test(source)) offenders.push(relative)
    }
  }
  return offenders
}

/**
 * Native `<button>`s with no `type` — the element's default is `submit`, so inside any form it
 * submits. A component named `Button` owns its own default and is not this rule's business.
 */
export function untypedNativeButtons(
  sources: readonly WorkspaceTsxSource[],
): { path: string; line: number }[] {
  return sources.flatMap(({ path, source }) =>
    jsxElementsNamed(path, source, 'button')
      .filter((element) => !element.hasAttribute('type'))
      .map((element) => ({ path, line: element.line })),
  )
}

const REQUIRED_EDITABLE_COMBOBOX_ATTRIBUTES = [
  'aria-autocomplete',
  'aria-haspopup',
  'aria-expanded',
  'aria-controls',
  'aria-activedescendant',
] as const

/**
 * Every `role="combobox"` that breaks the editable-combobox contract: the role belongs on the
 * focus-owning editor with its complete list wiring, or — for a closed select — on a button that
 * owns a listbox. A disclosure button carrying the role announces an editor that is not there.
 */
export function editableComboboxViolations(sources: readonly WorkspaceTsxSource[]): string[] {
  const violations: string[] = []
  for (const { path, source } of sources) {
    for (const element of jsxElementsWithStringAttribute(path, source, 'role', 'combobox')) {
      const location = `${path}:${element.line}`
      if (element.stringAttribute('aria-autocomplete') === 'none') {
        if (
          element.tagName !== 'button' ||
          element.stringAttribute('aria-haspopup') !== 'listbox'
        ) {
          violations.push(
            `${location} is a closed select but does not expose a button-owned listbox`,
          )
        }
        continue
      }
      if (element.tagName === 'button' || element.tagName === 'Button') {
        violations.push(
          `${location} is a disclosure button; the popup's editable input must own role="combobox"`,
        )
        continue
      }

      const missing = REQUIRED_EDITABLE_COMBOBOX_ATTRIBUTES.filter(
        (attribute) => !element.hasAttribute(attribute),
      )
      if (missing.length > 0) {
        violations.push(`${location} is missing ${missing.join(', ')}`)
      }
    }
  }
  return violations
}
