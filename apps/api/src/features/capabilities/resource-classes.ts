import { NON_MUTATING_EFFECTS, type CallEffect } from '@localixai/agent/agents'

import type { CapabilityKind } from './resolve'

/**
 * THE named resource classes — defined here, matched from here, and suggested from here.
 *
 * A rule's `resource` is usually a pattern: a command glob, a path, an agent id. A handful of
 * values are not patterns at all but CLASSES, answered by asking a question about the thing
 * being ruled on rather than by comparing text. `dangerous` is the oldest of them: `rm -fr`,
 * `rm -r -f` and `rm --recursive --force` are one class and three different strings, and no
 * glob a person would write covers all three.
 *
 * They used to be `if (pattern === '…')` branches in three files, with nothing anywhere
 * listing them. So the editor could not suggest what it did not know existed, and a reader
 * learned the vocabulary by grepping the matcher. This module is the one list: adding a class
 * here teaches the engine to match it AND the editor to offer it, with no second place to
 * update and nothing for the client to hardcode.
 *
 * Two families, because they answer about different things:
 *
 *   CALL classes  — computed from the call in flight (its paths, its commands, its verdict).
 *                   Only a `tool:` rule has a call.
 *   TRUST classes — a fact about the artifact itself, carried in as the resource by whoever
 *                   resolved it (`ext/trust.ts`). Only an artifact kind has one.
 */

/**
 * What a CALL class is asked about. Structural, so this module imports no runtime — the
 * answers are computed once in `permission-facts.ts` and handed in.
 */
export interface ClassifiedCall {
  /** A resolved path fell outside the workspace root. */
  outsideWorkspace: boolean
  /** The call names paths and every one is inside it. Not the negation of the above. */
  insideWorkspace: boolean
  /** The shell danger classifier recognised the command. */
  dangerous: boolean
  /** The subset of `dangerous` that cannot be undone. */
  catastrophic: boolean
  /** Every command in the call only reads; false when there is no command to judge. */
  readOnly: boolean
  /** A resolved path looks like a credential. */
  touchesSecret: boolean
  /** Where the call's effect lands — the tool's own per-call answer (`AgentTool.classify`). */
  effect: CallEffect
  /** The tool says this call cannot be undone. */
  irreversible: boolean
  /** The tool says this call waits on a person. */
  needsHuman: boolean
}

/**
 * One class per effect, generated, so a new effect is a rule vocabulary entry the moment the
 * contract names it. The `effect:` prefix keeps the value out of the glob namespace: a bare
 * `files` would also be a perfectly good bash command pattern.
 */
const EFFECT_HINTS: Record<CallEffect, string> = {
  read: 'The tool says this call only observes',
  view: 'Only changes UI the person is looking at — a drawing, a camera, a pane',
  session: 'Changes state this conversation owns and deletes with it — a card, a game move',
  files: 'Writes or deletes files on disk',
  host: "Changes the agent's durable state — global memory, skills, loops, plugins, config",
  external: 'Reaches past the machine — processes, remote data, messages — or is undeclared',
}

const EFFECT_CLASSES = (Object.keys(EFFECT_HINTS) as CallEffect[]).map((effect) => ({
  value: `effect:${effect}` as `effect:${CallEffect}`,
  hint: EFFECT_HINTS[effect],
  appliesTo: ['tool'] as readonly CapabilityKind[],
  test: (call: ClassifiedCall) => call.effect === effect,
}))

export interface ResourceClass {
  value: string
  /** Why a reader would pick it — shown in the editor, so it must stand alone. */
  hint: string
  /** The kinds whose rules can meaningfully name it. */
  appliesTo: readonly CapabilityKind[]
  /**
   * How it is decided for a live call, or `null` when the class is a property of an artifact
   * and arrives already resolved as the resource being looked up.
   */
  test: ((call: ClassifiedCall) => boolean) | null
}

const TOOL_KINDS: readonly CapabilityKind[] = ['tool']
const ARTIFACT_KINDS: readonly CapabilityKind[] = ['plugin', 'mcp', 'agent']
const EVERY_KIND: readonly CapabilityKind[] = ['tool', 'skill', 'plugin', 'mcp', 'agent']

export const RESOURCE_CLASSES = [
  {
    value: '*',
    hint: 'Everything this permission selects',
    appliesTo: EVERY_KIND,
    // Handled before any class is consulted — every matcher short-circuits on it — but listed
    // so the editor's vocabulary is the whole vocabulary rather than the whole vocabulary
    // minus the one value every rule starts with.
    test: () => true,
  },
  {
    value: 'outside-workspace',
    hint: 'A path resolved outside the workspace root',
    appliesTo: TOOL_KINDS,
    test: (call) => call.outsideWorkspace,
  },
  {
    value: 'inside-workspace',
    // The positive form is NOT redundant with the negative one. Silence already allows, so
    // `ask`/`deny` on it says nothing new — but it is the only way to write the exception in
    // `tool:write * deny` followed by `tool:write inside-workspace allow`, which otherwise
    // has to be spelled as a list of paths that goes stale the day a directory is added.
    // "Names paths" includes the directory a shell call runs in, which is the honest reading:
    // a command executing inside the workspace is inside it. What it excludes is a call that
    // names nothing at all — a delegation, a bare resource — which is neither.
    hint: 'The call names paths and every one is within the workspace',
    appliesTo: TOOL_KINDS,
    test: (call) => call.insideWorkspace,
  },
  {
    value: 'dangerous',
    hint: 'A shell command the danger classifier recognises',
    appliesTo: TOOL_KINDS,
    test: (call) => call.dangerous,
  },
  {
    value: 'catastrophic',
    hint: 'Destroys something no backup brings back — a disk, a home, the machine',
    appliesTo: TOOL_KINDS,
    test: (call) => call.catastrophic,
  },
  {
    value: 'read-only',
    // The answer already existed — `isReadOnlyCommand` decides whether a shell call counts as
    // a mutation — and no rule could ask for it. "This role may look but not touch" had to be
    // written as a denial of every writing tool, which a new tool quietly escapes.
    hint: 'Every command in the call only reads',
    appliesTo: TOOL_KINDS,
    test: (call) => call.readOnly,
  },
  {
    value: 'secrets',
    hint: 'A path that looks like a credential — dotenv, a key, a cloud profile',
    appliesTo: TOOL_KINDS,
    test: (call) => call.touchesSecret,
  },
  {
    value: 'mutates',
    hint: 'A call that changes anything durable — every effect but read and view',
    appliesTo: TOOL_KINDS,
    test: (call) => !NON_MUTATING_EFFECTS.includes(call.effect),
  },
  {
    value: 'irreversible',
    hint: 'The tool says this call cannot be undone — a delete, a DROP, a kill',
    appliesTo: TOOL_KINDS,
    test: (call) => call.irreversible,
  },
  {
    value: 'needs-human',
    hint: 'The call waits on a person — a card, masked input, a question',
    appliesTo: TOOL_KINDS,
    test: (call) => call.needsHuman,
  },
  ...EFFECT_CLASSES,
  {
    value: 'bundled',
    hint: 'Ships with Localix and runs unless a rule says otherwise',
    appliesTo: ARTIFACT_KINDS,
    test: null,
  },
  {
    value: 'opt-in',
    hint: 'Ships with Localix, imports code, waits to be allowed',
    appliesTo: ARTIFACT_KINDS,
    test: null,
  },
  {
    value: 'untrusted',
    hint: 'Did not ship with Localix, so it waits to be allowed',
    appliesTo: ARTIFACT_KINDS,
    test: null,
  },
] as const satisfies readonly ResourceClass[]

/** Every class name, as a type — so a consumer cannot invent one the matcher never heard of. */
export type ResourceClassName = (typeof RESOURCE_CLASSES)[number]['value']

const BY_VALUE = new Map<string, ResourceClass>(
  RESOURCE_CLASSES.map((entry) => [entry.value, entry]),
)

/** The class a resource names, or `undefined` when it is an ordinary pattern. */
export const resourceClassOf = (resource: string): ResourceClass | undefined =>
  BY_VALUE.get(resource)

/**
 * Does this resource name a class the live call answers?
 *
 * `undefined` means "not a call class" — the caller falls through to pattern matching, which
 * is what an agent id, a command glob or a path is. A TRUST class lands here too and answers
 * `undefined` for the same reason: nothing about a call can decide whether a plugin shipped
 * with the app.
 */
export function matchesResourceClass(resource: string, call: ClassifiedCall): boolean | undefined {
  const entry = BY_VALUE.get(resource)
  return entry?.test ? entry.test(call) : undefined
}

/** The classes a rule of this kind can name — what the editor offers for that row. */
export const resourceClassesFor = (kind: CapabilityKind): ResourceClass[] =>
  RESOURCE_CLASSES.filter((entry) => (entry.appliesTo as readonly CapabilityKind[]).includes(kind))
