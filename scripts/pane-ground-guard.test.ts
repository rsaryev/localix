import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A PANE paints the window's ground exactly once, and only the outermost one paints it.
 *
 * Under the macOS glass theme `--background` and `--sidebar` are translucent, so a pane that
 * paints a ground while nested inside another pane that already painted one COMPOUNDS: 85% over
 * 70% composites to 95.5% opaque — black. That is how the database plugin's pane came out a black
 * slab beside a chat pane that stayed glass. `--surface-raised` and `--surface-sunken` are worse
 * still at pane size: both mix from a ground DARKER than the pane they cover.
 *
 * A CSS rule in `packages/kit/styles/base.css` clears any ground nested inside another ground, but
 * it can only reach elements carrying those utility CLASSES in the rendered tree. This guard is the
 * other half: it stops a NEW pane-sized ground painter from being written in the first place, in
 * any app, package or plugin — the failure mode that produced four rounds of "you missed some"
 * when the search was done by eye instead of by rule.
 *
 * The fix at a reported site is almost always deletion: a feature or plugin pane inherits the
 * host pane it is mounted into, and painting nothing is what makes the window one material.
 */

/** Fills that ARE the window's ground (or mix from a darker one), at full strength. */
const GROUND_FILL = /\bbg-(?:background|sidebar|surface-raised|surface-sunken)(?![-/\w])/u

/** Classes that make an element pane-sized rather than a card or a row. */
const PANE_SIZED = /\b(?:h-full|h-dvh|min-h-0|flex-1|size-full|inset-0)\b/u

/** Frosted floating surfaces and deliberate occluders are a different, documented idiom. */
const EXEMPT_ON_LINE = /backdrop-blur|bg-background-solid|bg-\w+\/\d/u

/**
 * The explicit opt-out, written next to the code as `pane-ground-allow: <reason>`.
 *
 * An allowlist keyed by file path sits far from what it excuses and rots silently; a marker on the
 * element states the reason where the next reader is already looking, and `grep pane-ground-allow`
 * lists every exception in the repository. Use it only for the two shapes this check cannot reason
 * about: a deliberate letterbox mat, and a ternary whose pane-sized branch and filled branch are
 * mutually exclusive.
 */
const EXPLICIT_ALLOW = /pane-ground-allow:/u

/**
 * Comments are prose, not classes. Left in, a comment that merely NAMES a token made the check
 * report the element it documents — `dialog.tsx` was flagged for the words "bg-surface-raised" in
 * a sentence explaining which surface it uses.
 *
 * Stripped PER LINE, before any joining: a `//` comment ends at its newline, so removing them
 * after the lines are joined into one string deletes everything that followed on later lines. That
 * bug silently exempted the majority of every commented `cn()` block — a false NEGATIVE, which is
 * the failure mode that matters for a guard.
 */
function stripComments(line: string): string {
  return line.replaceAll(/\/\*.*?\*\//gu, ' ').replace(/\/\/.*$/u, ' ')
}

/**
 * The branches of a ternary are alternatives, never both at once, so a fill in one and a pane-size
 * class in the other is not a pane painting a ground. Splitting on the branch separators keeps
 * each alternative judged on its own — `CodeBlock`'s bare (pane-sized, unfilled) and bordered
 * (element-sized, filled) shapes are exactly this shape.
 */
function ternaryBranches(text: string): string[] {
  return text.split(/\?|:(?![^(]*\))/u)
}

/** The kit is where the primitives live; a root left out here is a tree the guard never reads. */
const ROOTS = ['apps/ui/src', 'packages/kit/src', 'packages/plugin-sdk/src', 'plugins']

/**
 * The OUTERMOST painters — the handful of elements that legitimately own the ground, plus the
 * standalone full-window routes that have no host pane to inherit from. Every entry names why,
 * because an allowlist without reasons becomes a place to hide.
 */
const OUTERMOST_PAINTERS = new Map<string, string>([
  [
    'apps/ui/src/widgets/editor-grid/ui/GridView.tsx',
    'The editor grid IS the work area — the outermost painter of the work-area ground.',
  ],
  [
    'apps/ui/src/widgets/workspace-shell/ui/WorkspaceShell.tsx',
    'The shell owns the chrome ground for the rail and the sidebar column.',
  ],
  [
    'apps/ui/src/app/routing/RouteErrorBoundary.tsx',
    'A crash screen renders when the shell may not exist; it cannot inherit a pane.',
  ],
  [
    'apps/ui/src/pages/grid-preview/ui/GridPreviewPage.tsx',
    'Standalone preview route, mounted outside the workspace shell.',
  ],
])

/** Another session owns this tree; it is swept on its own schedule. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'git-workspace', '__snapshots__'])

function* sourceFiles(dir: string): Generator<string> {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(path)
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) yield path
  }
}

/**
 * One `className` value, however it is written, as a single string plus the line it starts on.
 *
 * Matching line-by-line was this guard's blind spot and the reason panes kept being reported by
 * eye after it went green: a `cn(...)` call splits one class list across many lines, so the fill
 * and the pane-size class land on different lines and neither line matches both. Joining the
 * expression first is what makes the check see what the browser sees.
 */
function classNameExpressions(source: string): { classes: string; raw: string; line: number }[] {
  const found: { classes: string; raw: string; line: number }[] = []
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (!/\bclassName\s*=/u.test(line)) continue
    // Walk forward until the expression's brackets balance, so a multi-line `cn()` is one unit.
    let depth = 0
    let classes = ''
    let raw = ''
    let started = false
    for (let cursor = index; cursor < lines.length && cursor < index + 40; cursor += 1) {
      // Both forms are kept: `classes` (comments removed, per line) is what gets matched, while
      // `raw` still holds the comments — that is where an author writes the opt-out marker.
      const current = stripComments(lines[cursor]!)
      raw += ` ${lines[cursor]!}`
      classes += ` ${current}`
      for (const character of current) {
        if (character === '{' || character === '(' || character === '[') {
          depth += 1
          started = true
        } else if (character === '}' || character === ')' || character === ']') depth -= 1
      }
      // A plain `className="…"` never opens a bracket; stop at the end of its own line.
      if (!started || depth <= 0) break
    }
    found.push({ classes, raw, line: index + 1 })
  }
  return found
}

describe('pane ground painting', () => {
  test('only the outermost pane paints the window ground', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      try {
        statSync(root)
      } catch {
        continue
      }
      for (const file of sourceFiles(root)) {
        if (OUTERMOST_PAINTERS.has(file)) continue
        for (const expression of classNameExpressions(readFileSync(file, 'utf8'))) {
          // Tested against `raw`, which still has the comments the marker is written in.
          if (EXPLICIT_ALLOW.test(expression.raw)) continue
          const classes = expression.classes
          if (!GROUND_FILL.test(classes) || !PANE_SIZED.test(classes)) continue
          if (EXEMPT_ON_LINE.test(classes)) continue
          // A ground and a pane-size class in DIFFERENT ternary branches never co-occur at
          // runtime; only a branch carrying both is a pane painting a ground.
          if (!ternaryBranches(classes).some((b) => GROUND_FILL.test(b) && PANE_SIZED.test(b)))
            continue
          offenders.push(`${file}:${expression.line}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('every allowlisted painter still exists and still paints', () => {
    // An allowlist that outlives its files silently re-opens the hole it was cut for.
    for (const [file, reason] of OUTERMOST_PAINTERS) {
      const source = readFileSync(file, 'utf8')
      expect(GROUND_FILL.test(source), `${file} no longer paints a ground (${reason})`).toBe(true)
    }
  })
})
