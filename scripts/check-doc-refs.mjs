#!/usr/bin/env bun
/**
 * Documentation references and evidence sections must stay mechanically verifiable.
 *
 * `docs/internals/subsystems/*.md` are the working reference for anyone — human or agent —
 * touching a subsystem, and each one's header says its facts "must stay greppable in code".
 * When a module is renamed or removed and the doc is not, the text does not merely go stale:
 * it actively sends the next reader after wiring that is gone. That is not hypothetical.
 * A reader planning a prompt-versioning experiment against `edit-prediction.md` lost an
 * iteration to a `promptVersion` selector, a `v1.ts`, four rollout flags and a golden test
 * that had all been deleted, because the prose was detailed enough to be believed.
 *
 * This is a RATCHET, not a clean bill of health. `KNOWN_DRIFT` enumerates references that are
 * already broken and not yet repaired — debt, listed so it is visible and so new drift cannot
 * hide behind it. Fixing an entry means deleting its line here. Adding one means you are
 * about to make the same mess worse: correct the doc instead.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

/** Backticked tokens that look like a source path. */
const PATH_REF = /`([A-Za-z0-9_@./-]+\.(?:ts|tsx|mjs|json))`/g

/**
 * References the prose deliberately names as REMOVED — "the old X was retired", "Y is gone".
 * That is correct documentation of history, not drift, and it must survive: someone "fixing"
 * these would delete the very sentence that tells a reader the path no longer exists. Listed
 * per entry rather than matched by pattern, because "mentions a deleted file" and "forgot a
 * deleted file" look identical to a regex.
 */
const HISTORICAL = {}

/**
 * Already-broken references, grouped by doc. DEBT, not blessing — each line is a doc that
 * needs correcting against the current code. Shrink this list; never grow it.
 */
const KNOWN_DRIFT = {}

// Include newly-created source files in the working tree. Architecture docs often
// land in the same change as their new contract; requiring the file to be staged
// before this check can resolve it makes local validation depend on Git index state.
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((path) => path && existsSync(path))
const exact = new Set(tracked)
const byBasename = new Map()
for (const path of tracked) {
  const base = path.slice(path.lastIndexOf('/') + 1)
  if (!byBasename.has(base)) byBasename.set(base, [])
  byBasename.get(base).push(path)
}

/** A reference resolves when it is a tracked path, a suffix of one, or a tracked basename. */
function resolves(ref) {
  if (exact.has(ref)) return true
  const base = ref.slice(ref.lastIndexOf('/') + 1)
  const candidates = byBasename.get(base)
  if (!candidates) return false
  return ref.includes('/') ? candidates.some((path) => path.endsWith(`/${ref}`)) : true
}

const docs = execFileSync('git', ['ls-files', 'docs/internals/subsystems'], { encoding: 'utf8' })
  .split('\n')
  .filter((path) => path.endsWith('.md') && existsSync(path))

let checked = 0
const unexpected = []
/** KNOWN_DRIFT entries that actually suppressed a failure this run. */
const used = new Set()

for (const doc of docs) {
  const name = doc.slice(doc.lastIndexOf('/') + 1)
  const known = new Set(KNOWN_DRIFT[name] ?? [])
  const historical = new Set(HISTORICAL[name] ?? [])
  const seen = new Set()
  for (const [, ref] of readFileSync(doc, 'utf8').matchAll(PATH_REF)) {
    if (seen.has(ref)) continue
    seen.add(ref)
    checked += 1
    if (resolves(ref)) continue
    if (historical.has(ref)) {
      used.add(`${name}: ${ref}`)
      continue
    }
    if (known.has(ref)) {
      used.add(`${name}: ${ref}`)
      continue
    }
    unexpected.push(`${name}: ${ref}`)
  }
}

console.log(`[doc-refs] checked ${checked} path references across ${docs.length} subsystem docs`)

if (unexpected.length > 0) {
  console.error(
    `\n[doc-refs] ${unexpected.length} reference(s) name a file that does not exist. Correct the\n` +
      `doc against the code — do NOT add them to KNOWN_DRIFT, which only records debt that\n` +
      `predates this check:\n  ${unexpected.join('\n  ')}`,
  )
  process.exit(1)
}

// An allowlist that only ever grows is how the previous drift survived. An entry stops being
// needed the moment its reference resolves OR the prose stops naming it — and neither event
// touches this file, so the list must be checked against what it actually suppressed.
const stale = [...Object.entries(HISTORICAL), ...Object.entries(KNOWN_DRIFT)]
  .flatMap(([name, refs]) => refs.map((ref) => `${name}: ${ref}`))
  .filter((entry) => !used.has(entry))
if (stale.length > 0) {
  console.error(
    `\n[doc-refs] ${stale.length} KNOWN_DRIFT entr(ies) no longer suppress anything — the doc was\n` +
      `either corrected or the file exists again. Delete them so the list keeps shrinking:\n  ` +
      stale.join('\n  '),
  )
  process.exit(1)
}

const debt = Object.values(KNOWN_DRIFT).reduce((sum, list) => sum + list.length, 0)
const history = Object.values(HISTORICAL).reduce((sum, list) => sum + list.length, 0)
console.log(
  `[doc-refs] no new drift; ${debt} reference(s) still to repair, ` +
    `${history} intentional historical mention(s)`,
)

/**
 * Evidence and navigation at the end of a guide use one deliberately small visual grammar.
 * Tables made the same two sections look like different components from page to page, while
 * prose-only entries made links easy to mistake for labels. Keep both sections as compact lists.
 */
const SECTION_HEADINGS = ['Source of truth', 'Related guides']
const allMarkdownDocs = tracked.filter((path) => path.startsWith('docs/') && path.endsWith('.md'))
const sectionStyleFailures = []
let checkedSections = 0

for (const doc of allMarkdownDocs) {
  const lines = readFileSync(doc, 'utf8').split('\n')
  const sourceIndex = lines.indexOf('## Source of truth')
  const relatedIndex = lines.indexOf('## Related guides')
  if (sourceIndex >= 0 && relatedIndex >= 0 && relatedIndex > sourceIndex) {
    sectionStyleFailures.push(`${doc}: Related guides must appear before Source of truth`)
  }
  for (const heading of SECTION_HEADINGS) {
    const start = lines.indexOf(`## ${heading}`)
    if (start < 0) continue
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (lines[index].startsWith('## ')) {
        end = index
        break
      }
    }

    const body = lines
      .slice(start + 1, end)
      .join('\n')
      .trim()
    checkedSections += 1
    if (!body.startsWith('- ')) {
      sectionStyleFailures.push(`${doc}: ${heading} must be a compact bullet list`)
      continue
    }
    if (body.split('\n').some((line) => /^\s*\|/u.test(line))) {
      sectionStyleFailures.push(`${doc}: ${heading} must not contain a table`)
    }
    if (body.split('\n').some((line) => line.startsWith('- ') && !line.startsWith('- ['))) {
      sectionStyleFailures.push(`${doc}: ${heading} items must start with a descriptive link`)
    }
  }
}

if (sectionStyleFailures.length > 0) {
  console.error(
    `\n[doc-refs] ${sectionStyleFailures.length} documentation section style failure(s):\n  ` +
      sectionStyleFailures.join('\n  '),
  )
  process.exit(1)
}

console.log(
  `[doc-refs] ${checkedSections} Source of truth / Related guides sections use compact lists`,
)
