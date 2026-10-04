/**
 * A plugin's utility sheet, minus every rule the host stylesheet already has.
 *
 * The defect this exists to stop: a plugin's utilities are compiled by their OWN Tailwind build,
 * so they are sorted among themselves, not among the host's, and they arrive unlayered — and an
 * unlayered rule beats any rule inside the host's `@layer utilities`, whatever the order. The
 * moment one plugin used `flex-col-reverse`, its copy of that class out-ranked the host's
 * `sm:flex-row` on every host element carrying both: every dialog footer in the app stacked its
 * buttons at desktop widths, because one plugin that used the class was enabled.
 *
 * Dropping the duplicates is exact rather than heuristic. A rule the host already emits has the
 * same declarations in both sheets (the plugin is compiled against the host theme), so removing
 * the plugin's copy changes nothing but precedence — the host's copy, in the host's own sorted
 * order, is the one that applies. What stays is only what the host does not emit, and a host
 * element never carries a class the host does not emit; a plugin element carrying a host class
 * alongside a plugin-only variant still gets the variant, because that variant stays unlayered.
 */

/**
 * A rule's text with every `var(--x, fallback)` reduced to `var(--x)`.
 *
 * "Same declarations in both sheets" was not literally true. The plugin is compiled with the host
 * theme as a `@reference`, and in that mode Tailwind writes each theme value WITH its fallback —
 * `padding-inline: calc(var(--spacing, 0.25rem) * 2)` where the host writes `calc(var(--spacing)
 * * 2)`. Compared as text, no utility that reads a token matched, so a plugin kept its unlayered
 * copy of hundreds of them (161 in Database alone) and out-ranked the host's layered rules: a
 * menu row's `px-2` beat its own `pl-8`, and every icon in a gutter menu sat on its label. In the
 * host document the variable is always defined, so the fallback never applies and dropping it
 * from the comparison is exact.
 */
export function canonicalRuleText(text: string): string {
  let out = ''
  let at = 0
  for (let open = text.indexOf('var(--', at); open >= 0; open = text.indexOf('var(--', at)) {
    const nameEnd = open + 4 + /^[\w-]+/.exec(text.slice(open + 4))![0].length
    out += text.slice(at, nameEnd)
    if (text[nameEnd] !== ',') {
      at = nameEnd
      continue
    }
    // Skip the fallback to the `)` that closes this `var(`, whatever it nests.
    let depth = 1
    let cursor = nameEnd
    while (cursor < text.length && depth > 0) {
      const char = text[cursor++]
      if (char === '(') depth++
      else if (char === ')') depth--
    }
    out += ')'
    at = cursor
  }
  return out + text.slice(at)
}

/**
 * One host sheet's canonical rule texts, keyed by the sheet object.
 *
 * Each plugin's mount asked for the host's rules, and each ask re-walked and re-canonicalized the
 * whole host stylesheet — thousands of rules, twenty times over at startup (84 ms of main thread
 * in the startup profile). A host sheet does not change under a mount; when its source does (a
 * dev HMR update), the element gets a NEW sheet object, which misses here and is read afresh.
 */
const sheetTexts = new WeakMap<object, ReadonlySet<string>>()

function readSheetTexts(sheet: Pick<CSSStyleSheet, 'cssRules'>): ReadonlySet<string> {
  const known = sheetTexts.get(sheet)
  if (known) return known
  const texts = new Set<string>()
  const walk = (rules: ArrayLike<CSSRule>) => {
    for (const rule of Array.from(rules)) {
      // A layer block (`@layer utilities { … }`) groups rules; its members are what a plugin
      // duplicates. A style rule is recorded whole, nested `@media` variant included.
      if (isLayerBlock(rule)) walk(rule.cssRules)
      else texts.add(canonicalRuleText(rule.cssText))
    }
  }
  walk(sheet.cssRules)
  sheetTexts.set(sheet, texts)
  return texts
}

/** Every style rule the host document already applies, by its canonical text. */
export function hostRuleTexts(sheets: Iterable<Pick<CSSStyleSheet, 'cssRules'>>): Set<string> {
  const texts = new Set<string>()
  for (const sheet of sheets) {
    try {
      for (const text of readSheetTexts(sheet)) texts.add(text)
    } catch {
      // A cross-origin sheet cannot be read; it is not host source anyway.
    }
  }
  return texts
}

/** By shape, not `instanceof`: `CSSLayerBlockRule` is missing from older engines and test DOMs. */
function isLayerBlock(rule: CSSRule): rule is CSSRule & { cssRules: CSSRuleList } {
  return 'cssRules' in rule && rule.cssText.trimStart().startsWith('@layer')
}

/** Delete, in place, every top-level rule of `sheet` whose text the host already has. */
export function dropHostDuplicates(
  sheet: Pick<CSSStyleSheet, 'cssRules' | 'deleteRule'>,
  host: ReadonlySet<string>,
): number {
  let dropped = 0
  for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
    if (host.has(canonicalRuleText(sheet.cssRules[index].cssText))) {
      sheet.deleteRule(index)
      dropped += 1
    }
  }
  return dropped
}
