import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { resolveRunProfile } from './run-shape'
import { renderLintMatrix, richRegistry, SHAPE_SESSION_KIND } from './testing/prompt-harness'

// Cross-section duplication lint: the machine-enforced form of "don't duplicate
// pieces in the system prompt". Within a SINGLE assembled prompt no instruction may
// live in two different `#` sections. Two detectors:
//   1. PHRASE — a shared run of normalized words across two sections (verbatim guard).
//   2. CONCEPT — a hand-picked signature (regex) matching two different sections
//      (catches paraphrase dups: the same rule restated in # Available tools guidance,
//      # Tool discipline, AND # Execution discipline).
// The current known-dup set is committed as a baseline and shrinks toward empty as the
// dedup refactor lands; regenerate intentionally with
// `UPDATE_PROMPTS=1 bun test system-prompt-dedup`.
const DIR = join(import.meta.dir, '__prompts__')
const UPDATE = process.env.UPDATE_PROMPTS === '1'
const SHINGLE = 8

// Audit-derived concept signatures. A concept matching >1 section of one prompt is a
// duplication to consolidate to a single home (see the plan's consolidation table).
//
// FALSIFIABILITY — a concept regex that matches NOTHING reports nothing and passes, so
// a reworded instruction silently retires its own guard. Three of these were dead when
// this was audited, for two DIFFERENT reasons, which is why each concept now declares
// where the rule is supposed to LIVE and that claim is asserted (see the two tests at
// the bottom):
//
//   'stated'    — a cross-cutting rule the system prompt DOES state. Must match ≥1
//                 section somewhere. Zero means either the regex broke (guard silently
//                 retired) or the instruction was dropped from the prompt (a bug).
//                 `wait-not-bash-sleep` was exactly this: the anti-poll rule is very much
//                 still in the prompt, but the wording moved to "chase a server with
//                 sleep+curl", which `/bash .{0,3}sleep/` no longer matches.
//   'delegated' — a TOOL-specific rule that by the project's rule ("a tool's own schema
//                 description is the ONLY home for tool-specific guidance") must NOT be
//                 in the prompt at all. Must match ZERO sections in EVERY prompt. These
//                 read as "dead" but are correctly silent, and asserting the zero turns
//                 them from dead weight into the enforcement of that rule — which nothing
//                 else checks. (The memory "declarative facts" rule lives in memory.ts's
//                 description.)
const CONCEPTS: { id: string; presence: 'stated' | 'delegated'; re: RegExp }[] = [
  {
    id: 'wait-not-bash-sleep',
    presence: 'stated',
    // Polling a running thing. A shell sleep LOOP standing in for a schedule is a different
    // rule (`no-fake-schedule`); matching it here reported the two as one duplicated rule.
    re: /sleep[+/]curl|chase a server with sleep|spawning duplicates or polling/i,
  },
  {
    id: 'profile-already-in-prompt',
    presence: 'delegated',
    re: /already in (your|the) system prompt/i,
  },
  {
    id: 'write-whole-file',
    presence: 'delegated',
    re: /full (new )?(file )?content|whole[- ]file|replace almost all/i,
  },
  {
    id: 'skill-retrieve-follow',
    presence: 'stated',
    re: /skill\.get|do not improvise (a workflow|if a relevant skill)|retrieve.{0,16}skill/i,
  },
  {
    id: 'memory-declarative',
    presence: 'delegated',
    re: /declarative facts|prefers concise responses|never instructions or task state/i,
  },
  { id: 'narrate-routine', presence: 'stated', re: /(narrate|preface)[^.]{0,48}(routine|reads)/i },
  {
    id: 'verify-not-recall',
    presence: 'stated',
    re: /never answer[^.]{0,24}from memory|from memory[^.]{0,16}never|verify[^.]{0,12}(don.?t|not) recall/i,
  },
  // The board lifecycle and explicit delegation rules used to live here. They were
  // rules of a board-mode PROSE section, and with modes gone the board's workflow moved into
  // its tool's own schema — the only home for per-tool semantics,
  // and which this guard (a lint over rendered PROMPT sections) cannot see. That tool is the
  // bundled task-board plugin's now, and its own tests pin that description.
  {
    id: 'no-fake-schedule',
    presence: 'stated',
    re: /crontab|launchd|while true|stand up your own recurrence|self-restarting/i,
  },
  {
    id: 'batch-independent',
    presence: 'stated',
    re: /batch independent tool calls|one-file-per-turn/i,
  },
  // The four rules the 3.2 consolidation gave one home each. Each was stated twice before —
  // the routing line twice within one section, the rest across sections or the tool texts.
  {
    id: 'edit-routing',
    presence: 'stated',
    re: /dedicated file tools|`edit` for one exact/i,
  },
  {
    id: 'reread',
    presence: 'stated',
    re: /(do not|never) re-?read|re-?read(ing)? (unchanged|to .?make sure)|reuse (visible )?results/i,
  },
  {
    id: 'child-report',
    presence: 'stated',
    re: /final (reply|response)[^.]{0,40}report|return only the conclusion|concise report/i,
  },
  {
    id: 'preview-evidence',
    presence: 'stated',
    re: /opened url proves|proof of (probe|readiness)/i,
  },
]

function sections(prompt: string): { header: string; text: string }[] {
  const out: { header: string; lines: string[] }[] = []
  let cur: { header: string; lines: string[] } | null = null
  for (const raw of prompt.split('\n')) {
    if (raw.startsWith('# ')) {
      cur = { header: raw.slice(2).trim(), lines: [] }
      out.push(cur)
    } else if (cur) {
      cur.lines.push(raw)
    } else {
      cur = { header: '(identity)', lines: [raw] }
      out.push(cur)
    }
  }
  return out.map((s) => ({ header: s.header, text: s.lines.join('\n') }))
}

function words(text: string): string[] {
  return text
    .replace(/`[^`]*`/g, ' ')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function shingles(text: string): Set<string> {
  const w = words(text)
  const out = new Set<string>()
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(w.slice(i, i + SHINGLE).join(' '))
  return out
}

/** The lines of a section that carry a rule — a bullet or a prose line, never blank. */
const ruleLines = (text: string) => text.split('\n').filter((line) => line.trim())

/**
 * The detectors. The first version looked only ACROSS sections, which is why two rules could
 * sit one line apart inside "# Execution discipline" ("Prefer dedicated file tools…", "Edit
 * with the dedicated file tools…") and why a section could restate a tool's own description
 * word for word: neither pair spans two `#` headers. `within` and `tool` close those two gaps.
 */
export function dupsIn(
  promptName: string,
  prompt: string,
  toolTexts: ReadonlyMap<string, string> = new Map(),
): string[] {
  const secs = sections(prompt)
  const hits = new Set<string>()
  // PHRASE detector — across sections
  const sh = secs.map((s) => ({ header: s.header, sh: shingles(s.text) }))
  for (let a = 0; a < sh.length; a++)
    for (let b = a + 1; b < sh.length; b++) {
      if (sh[a].header === sh[b].header) continue
      for (const s of sh[a].sh)
        if (sh[b].sh.has(s))
          hits.add(`phrase :: ${promptName} :: ${sh[a].header} ⇎ ${sh[b].header} :: ${s}`)
    }
  // PHRASE detector — within one section, across its lines
  for (const sec of secs) {
    const seen = new Map<string, number>()
    ruleLines(sec.text).forEach((line, index) => {
      for (const s of shingles(line)) {
        const first = seen.get(s)
        if (first === undefined) seen.set(s, index)
        else if (first !== index) hits.add(`within :: ${promptName} :: ${sec.header} :: ${s}`)
      }
    })
  }
  // PHRASE detector — a section restating a tool this prompt carries
  const roster = secs.find((s) => s.header === 'Available tools')
  const carried = ruleLines(roster?.text ?? '').map((line) => line.replace(/^- /, '').trim())
  for (const name of carried) {
    const text = toolTexts.get(name)
    if (!text) continue
    const toolShingles = shingles(text)
    for (const sec of secs)
      for (const s of shingles(sec.text))
        if (toolShingles.has(s))
          hits.add(`tool :: ${promptName} :: ${sec.header} ⇎ ${name} :: ${s}`)
  }
  // CONCEPT detector — across sections, and across the lines of one section
  for (const c of CONCEPTS) {
    const where = secs.filter((s) => c.re.test(s.text)).map((s) => s.header)
    if (where.length > 1) hits.add(`concept :: ${promptName} :: ${c.id} :: ${where.join(' + ')}`)
    for (const sec of secs)
      if (ruleLines(sec.text).filter((line) => c.re.test(line)).length > 1)
        hits.add(`concept-within :: ${promptName} :: ${c.id} :: ${sec.header}`)
  }
  return [...hits]
}

/**
 * Every text a tool puts on the wire — its description and every field description — keyed by
 * name, across the three run shapes (bash's text differs between them, so the texts join).
 */
function wireToolTexts(): Map<string, string> {
  const texts = new Map<string, string>()
  const collect = (node: unknown, out: string[]) => {
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'description' && typeof value === 'string') out.push(value)
      else collect(value, out)
    }
  }
  for (const sessionKind of Object.values(SHAPE_SESSION_KIND)) {
    for (const tool of richRegistry(resolveRunProfile({ sessionKind })).tools) {
      const parts = [tool.description ?? '']
      collect(z.toJSONSchema(tool.inputSchema as z.ZodType, { unrepresentable: 'any' }), parts)
      texts.set(tool.name, [texts.get(tool.name) ?? '', ...parts].join('\n'))
    }
  }
  return texts
}

function baseline(): string[] {
  const file = join(DIR, '_known_dups.json')
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, 'utf8')) as string[]
}

describe('system-prompt cross-section duplication', () => {
  // Goldens ∪ the full (profile × tool-surface) cross-product. A duplication can exist
  // only in a variant nobody committed a golden for — a different surface renders a
  // different section set, and a gated bullet may restate what an ungated one already said.
  const matrix = renderLintMatrix()
  const tools = wireToolTexts()
  const found = [
    ...new Set(Object.entries(matrix).flatMap(([name, p]) => dupsIn(name, p, tools))),
  ].sort()

  test('each detector fires on a planted duplicate (positive control)', () => {
    // A lint that finds nothing is only evidence while it CAN find something.
    const rule = 'keep the answer short and grounded in what you observed'
    const planted = [
      '# Alpha',
      `- ${rule}.`,
      `- Also, ${rule} today.`,
      '# Beta',
      `- ${rule}.`,
      '# Available tools',
      '- probe',
    ].join('\n')
    const hits = dupsIn('planted', planted, new Map([['probe', `Probe. Always ${rule}.`]]))
    for (const kind of ['phrase', 'within', 'tool'])
      expect(hits.some((hit) => hit.startsWith(`${kind} :: planted`))).toBe(true)
    const conceptWithin = dupsIn(
      'planted',
      '# Gamma\n- batch independent tool calls\n- never one-file-per-turn',
    )
    expect(conceptWithin).toContain('concept-within :: planted :: batch-independent :: Gamma')
  })

  if (UPDATE) {
    test('regenerate known-dup baseline', () => {
      mkdirSync(DIR, { recursive: true })
      writeFileSync(join(DIR, '_known_dups.json'), JSON.stringify(found, null, 2) + '\n')
    })
    return
  }

  test('introduces no NEW cross-section duplication beyond the known baseline', () => {
    const known = new Set(baseline())
    expect(found.filter((d) => !known.has(d))).toEqual([])
  })

  test('baseline has no STALE entries — it shrinks monotonically toward empty', () => {
    const foundSet = new Set(found)
    expect(baseline().filter((d) => !foundSet.has(d))).toEqual([])
  })

  // The two halves that make the CONCEPT detector falsifiable. Without them a concept
  // regex can quietly stop matching anything and the suite never notices — it just
  // watches for nothing forever.
  const sectionsMatching = (c: (typeof CONCEPTS)[number]) =>
    Object.values(matrix).reduce(
      (n, p) => n + sections(p).filter((s) => c.re.test(s.text)).length,
      0,
    )

  test('every `stated` concept still matches the prompt — a dead regex guards nothing', () => {
    const dead = CONCEPTS.filter((c) => c.presence === 'stated' && sectionsMatching(c) === 0).map(
      (c) => c.id,
    )
    expect(dead).toEqual([])
  })

  test('every `delegated` concept is ABSENT from the prompt — tool guidance belongs in the tool schema', () => {
    const leaked = CONCEPTS.filter(
      (c) => c.presence === 'delegated' && sectionsMatching(c) > 0,
    ).map((c) => c.id)
    expect(leaked).toEqual([])
  })
})
