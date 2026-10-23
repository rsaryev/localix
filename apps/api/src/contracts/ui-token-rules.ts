/**
 * The design TOKENS a class string must take its value from — one list for the app, its bundled
 * mini apps and every mini app a person builds.
 *
 * Every rule is a value that already has a token, and every one drifted the same way before it
 * was a check: a literal is a bet that nobody will retune the system, and each copy placed that
 * bet on its own. Ten literal durations ran beside the motion tokens, twenty border alphas beside
 * three border steps, thirty-eight raw z-indexes beside a named layer scale — so a retune moved
 * some surfaces and left the rest, and the app looked assembled rather than designed.
 * `docs/internals/visual-system.md` says which token answers each question.
 *
 * Two readers, so one owner: the repository guard (`scripts/ui-token-drift-guard.test.ts`) scans
 * the app and the bundled mini apps, and `mini_app_build` scans a user's mini app, which lives in
 * `~/.localix/mini-apps` where no repository guard can see it (a generated mini app once shipped
 * `text-red-500`, `bg-emerald-500` and a bare `rounded` through every build step). A second copy of
 * this list would drift from the first exactly the way the literals it forbids did.
 *
 * Browser-safe and dependency-free. Each rule carries a line of code in its drifted shape, the
 * guard's positive control.
 */

export interface UiTokenRule {
  readonly name: string
  readonly pattern: RegExp
  readonly fix: string
  /** A line of real code in the drifted shape, for the positive control. */
  readonly offender: string
}

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'

export const UI_TOKEN_RULES: readonly UiTokenRule[] = [
  {
    name: 'literal duration',
    pattern: /(?<![\w-])duration-\d+(?![\w-])/gu,
    fix: 'time it with a motion token: duration-(--dur-instant|fast|base|moderate|slow)',
    offender: "const a = 'transition-colors duration-200'",
  },
  {
    name: 'stock easing curve',
    pattern: /(?<![\w-])ease-(?:in-out|in|out)(?![\w-])/gu,
    fix: 'ease with a motion token: ease-(--ease-soft|emphasized|standard|exit)',
    offender: "const a = 'transition-opacity ease-out'",
  },
  {
    name: 'transition-all',
    pattern: /(?<![\w-])transition-all(?![\w-])/gu,
    fix: 'name the properties that move (transition-colors, transition-[transform,opacity], …)',
    offender: "const a = 'transition-all'",
  },
  {
    name: 'raw z-index',
    pattern: /(?<![\w-])-?z-[1-9]\d*(?![\w\]-])/gu,
    fix: 'stack on a named layer: z-(--z-raised|controls|sticky|overlay|popover|tooltip|…)',
    offender: "const a = 'absolute z-10'",
  },
  {
    name: 'literal font size',
    pattern: /(?<![\w-])text-\[\d*\.?\d+(?:px|rem)\]/gu,
    fix: 'size text on the type scale: text-3xs / text-2xs / text-xs / text-sm …',
    offender: "const a = 'text-[10px]'",
  },
  {
    name: 'hand-picked border alpha',
    pattern: /(?<![\w-])(?:border(?:-[trblxy])?|divide)-border\/\d+(?![\w-])/gu,
    fix: 'use a border step: border-border-faint (rows), border-border-soft (groups), border-border',
    offender: "const a = 'border-b border-border/40'",
  },
  {
    name: 'off-scale radius',
    // A bare `rounded` CLASS is followed by a space or the closing quote; an identifier named
    // `rounded` is followed by an operator (`const rounded = …`, `rounded ? a : b`), which is code.
    // A literal that is EXACTLY `rounded` is a NAME — the board's shape kind (`case 'rounded':`,
    // `{ value: 'rounded' }`, `shapePath('rounded', w, h)`) tripped this rule three times — unless
    // it opens a class string: a `class`/`className` value or a class combiner's first argument.
    pattern:
      /(?<![\w-])(?!(?<=(?<!(?:class|className)=\{?|\b(?:cn|clsx|cva|twMerge)\()(['"`]))rounded(?:-[trbl]{1,2})?\1)rounded(?:-[trbl]{1,2})?(?:-\[\d+px\]|(?=[\s'"`])(?!\s*[=:?(),;.|&+*/<>]))/gu,
    fix: 'use the radius scale: rounded-xs / sm / md / lg / xl / full',
    offender: "const a = 'rounded px-1'",
  },
  {
    name: 'stock shadow',
    pattern: /(?<![\w-])shadow-(?:xs|sm|md|lg|xl|2xl)(?![\w-])/gu,
    fix: 'lift with an elevation token: shadow-(--shadow-raised|soft|popover|drawer)',
    offender: "const a = 'shadow-sm'",
  },
  {
    name: 'muted-foreground text',
    pattern: /(?<![\w-])text-muted-foreground(?![\w-])/gu,
    fix: 'secondary text is a text tier: text-text-soft (or text-text-faint)',
    offender: "const a = 'text-muted-foreground'",
  },
  {
    name: 'alpha foreground text',
    pattern: /(?<![\w-])text-foreground\/\d+(?![\w-])/gu,
    fix: 'secondary text is a text tier: text-text-soft (or text-text-faint)',
    offender: "const a = 'text-foreground/60'",
  },
  {
    // A panel already has a width: the one the user gave its pane. Centring a literal cap inside
    // it spends that width on two empty gutters — Settings and the Vault did it at `max-w-7xl` and
    // `max-w-4xl`, then Database, DevOps, Trading and the mini app template at `max-w-2xl`/`6xl`,
    // numbers that agreed with nothing and showed only once someone widened the window. The
    // offence is the PAIR in one string: a bare `max-w-2xl` on a `<p>` is a measure on text, and a
    // bare `mx-auto` has no column. Long-form prose that is a column (a lesson) asks for the named
    // `--reading-measure`; `max-w-full`/`none` cap nothing. A variant-scoped centre (`md:mx-auto`)
    // is an overlay sizing itself at a breakpoint — the drawer — not a panel body.
    name: 'centred literal column',
    pattern:
      /(["'`])(?=(?:(?!\1)[^\n])*?(?<![\w:-])mx-auto(?![\w-]))(?=(?:(?!\1)[^\n])*?(?<![\w-])(?:[\w@-]+:)*max-w-(?!\(|full\b|none\b|min\b|max\b|fit\b)[\w.[\]%-])(?:(?!\1)[^\n])*\1/gu,
    fix: 'let the body fill its pane (drop mx-auto + max-w-*); prose that is a column uses max-w-(--reading-measure)',
    offender: '<div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4">',
  },
  {
    name: 'palette colour',
    pattern: new RegExp(
      `(?<![\\w-])(?:text|bg|border|ring|fill|stroke|from|via|to|outline|decoration|divide|placeholder|caret|accent|shadow)-(?:${PALETTE})-(?:50|[1-9]00|950)(?:\\/\\d+)?(?![\\w-])`,
      'gu',
    ),
    fix: 'colour with a token that follows the theme: text-status-error|warning|success|info (bg-status-*/12 for a tint), --chart-N for a series',
    offender: "const a = 'bg-emerald-500 text-red-500'",
  },
]
