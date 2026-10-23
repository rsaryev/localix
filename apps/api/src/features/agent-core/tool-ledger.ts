import type { AgentTool, RunShape } from '@localixai/agent/agents'
import { declaresTool, exposureLevel, type RunProfile } from './run-shape'
import { namesTool } from './tool-name-match'
import { builtinToolExposure, isProtocolTool } from './tool-names'

/**
 * The LEDGER: for every tool a run could have, one verdict with one reason.
 *
 * "Does this run get tool X" used to be answered by seven unrelated mechanisms — per-shape
 * allowlists, an `interactiveOnly` flag, descriptor capabilities against the client surface,
 * capability rules, and ad-hoc `return undefined` in the host's port builders — and none of
 * them recorded WHY. A tool simply was not there, and the model, the Capabilities screen and
 * the effective-config report each reconstructed the answer their own way. The symptom
 * was: a model-routing switch removed a tool, and the agent told the user the tool
 * "does not exist".
 *
 * The ledger is the one decision function. Five layers, in this order, each owned by a
 * different party, and MONOTONE — a lower layer can never return what an upper one took:
 *
 *   shape      — may this run SHAPE carry the tool at all? Declared by the tool (`exposure`).
 *   authority  — does the HOST have the power/service the tool needs? Runtime facts.
 *   model      — can this run's MODEL read what the tool produces (`requiresModelInput`)?
 *   policy     — did the USER switch it off? Capability rules, global → project → agent.
 *   economy    — is it on the wire or behind `activate_tools`? A wire decision, not a denial;
 *                applied later by run assembly through {@link markDeferred}.
 *
 * Only a `policy` reason carries a remedy: shape, authority and model cannot be lifted by a click,
 * so they are never proposed to the model — which is what keeps a sub-session from being
 * told about a tool it can structurally never hold.
 *
 * Pure: no I/O, no clock. Every consumer READS a ledger; none re-derives a verdict.
 */

export interface PolicyDenial {
  /**
   * The rule that denies the tool. No scope beside it: rules belong to the agent taking the
   * turn and to nothing else, so "where do I change this" has one answer and the remedy does
   * not have to carry it.
   */
  rule: { action: string; resource: string; effect: string; message?: string }
}

export type WithholdReason =
  | { layer: 'shape'; kind: 'never' | 'not-declared'; shape: RunShape }
  | { layer: 'authority'; kind: 'missing'; capability: string }
  | { layer: 'model'; kind: 'modality'; needs: string }
  | { layer: 'policy'; kind: 'rule'; denial: PolicyDenial | null }
  | { layer: 'policy'; kind: 'disabled-plugin'; plugin: string }

/** How a `policy` reason can be lifted — the input the `configure` tool turns into a proposal. */
export interface RemedyRef {
  remedyId: 'tool.enable' | 'plugin.enable' | 'mini-app.enable'
  target: string
}

export type ToolVerdict =
  | { state: 'live' }
  | { state: 'deferred'; source: string }
  | { state: 'withheld'; reason: WithholdReason; remedy?: RemedyRef }

export type ToolLedger = ReadonlyMap<string, ToolVerdict>

/** Everything the ledger needs about the run — facts, never decisions. */
export interface RunFacts {
  profile: RunProfile
  /**
   * Host authority as capability names, or `undefined` when the caller has no surface (bare
   * registries, focused tests) — then the authority layer does not judge, exactly as the
   * former `!policy.toolSurface ||` short-circuit behaved.
   */
  authority: readonly string[] | undefined
  /** Names the effective capability rules switch off, with the denying rule when known. */
  disabledTools: ReadonlySet<string>
  toolDenials?: ReadonlyMap<string, PolicyDenial>
  /**
   * What this run's model reads (`text`, `image`, …), or `undefined` when the model is unknown —
   * then the model layer does not judge, as the authority layer does without a surface.
   */
  modelInput?: readonly string[]
}

/** A tool the run could carry. `tool` is absent when the host never built its port. */
export interface ToolCandidate {
  name: string
  tool?: AgentTool
  /** A host-side reason the port is absent, e.g. `preview.control`; defaults to `host:<name>`. */
  missingCapability?: string
}

const remedyFor = (name: string, _denial: PolicyDenial | null): RemedyRef => ({
  remedyId: 'tool.enable',
  target: name,
})

function shapeVerdict(facts: RunFacts, candidate: ToolCandidate): ToolVerdict | null {
  const { profile } = facts
  const withheld = (kind: 'never' | 'not-declared'): ToolVerdict => ({
    state: 'withheld',
    reason: { layer: 'shape', kind, shape: profile.shape },
  })
  // `never` is decided by the tool's OWN declaration and beats any role declaration. The
  // profile could not have applied it for a plugin tool — the catalog does not know the
  // name — so this is where a declared-but-impossible plugin tool is refused.
  const level = exposureLevel(profile.shape, candidate.name, candidate.tool?.exposure)
  if (level === 'never') return withheld('never')
  if (declaresTool(profile, candidate.name)) return null
  // A list may name an MCP tool by Claude Code's address or a whole server (`tool-name-match.ts`).
  const tool = candidate.tool
  if (tool && profile.declaredTools?.some((entry) => namesTool(entry, tool))) return null
  // Only a chat's OPEN toolset admits plugin tools it never declared — the same rule the
  // registry applied before the ledger existed.
  if (profile.openToolset && level === 'default') return null
  // A child that inherits the conversation's tools takes the dynamic ones a chat would; its
  // built-ins stay its own shape's.
  if (
    profile.inheritsConversation &&
    !builtinToolExposure(candidate.name) &&
    exposureLevel('chat', candidate.name, tool?.exposure) === 'default'
  )
    return null
  return withheld('not-declared')
}

/** Switched off by name, or — for an MCP tool — by its Claude Code address or its server's `*`. */
function isDisabled(facts: RunFacts, candidate: ToolCandidate): boolean {
  if (facts.disabledTools.has(candidate.name)) return true
  const tool = candidate.tool
  if (!tool) return false
  for (const entry of facts.disabledTools)
    if (entry.startsWith('mcp_') && namesTool(entry, tool)) return true
  return false
}

function authorityVerdict(facts: RunFacts, candidate: ToolCandidate): ToolVerdict | null {
  if (!candidate.tool) {
    return {
      state: 'withheld',
      reason: {
        layer: 'authority',
        kind: 'missing',
        capability: candidate.missingCapability ?? `host:${candidate.name}`,
      },
    }
  }
  const required = candidate.tool.availability?.requiredCapabilities ?? []
  if (required.length === 0 || facts.authority === undefined) return null
  const held = new Set(facts.authority)
  const missing = required.find((capability) => !held.has(capability))
  return missing
    ? { state: 'withheld', reason: { layer: 'authority', kind: 'missing', capability: missing } }
    : null
}

/**
 * MODEL — can this run's model use what the tool produces? A tool declares the input it needs
 * the model to read (`requiresModelInput`); a text-only model handed a picture-only tool spends a
 * turn on a picture it is then told it cannot see. After authority, before policy: a click cannot
 * give a model eyes, so, like shape and authority, it carries no remedy.
 */
function modelVerdict(facts: RunFacts, candidate: ToolCandidate): ToolVerdict | null {
  const needs = candidate.tool?.requiresModelInput
  if (!needs?.length || facts.modelInput === undefined) return null
  const missing = needs.find((modality) => !facts.modelInput!.includes(modality))
  return missing
    ? { state: 'withheld', reason: { layer: 'model', kind: 'modality', needs: missing } }
    : null
}

function policyVerdict(facts: RunFacts, candidate: ToolCandidate): ToolVerdict | null {
  // A chat turn must always be able to finish and route its successor. Treating this protocol
  // primitive like an optional capability caused an agent to enable it for "the next turn",
  // after the current turn had already become impossible to finish correctly.
  if (isProtocolTool(candidate.name)) return null
  if (!isDisabled(facts, candidate)) return null
  const denial = facts.toolDenials?.get(candidate.name) ?? null
  return {
    state: 'withheld',
    reason: { layer: 'policy', kind: 'rule', denial },
    remedy: remedyFor(candidate.name, denial),
  }
}

/** The layers, in the only order that keeps the ledger monotone. */
const STAGES = [shapeVerdict, authorityVerdict, modelVerdict, policyVerdict] as const

export function verdictFor(facts: RunFacts, candidate: ToolCandidate): ToolVerdict {
  for (const stage of STAGES) {
    const verdict = stage(facts, candidate)
    if (verdict) return verdict
  }
  return { state: 'live' }
}

/** One verdict per candidate, in candidate order. */
export function resolveToolSurface(
  facts: RunFacts,
  candidates: readonly ToolCandidate[],
): ToolLedger {
  const ledger = new Map<string, ToolVerdict>()
  for (const candidate of candidates) {
    // A name can arrive twice (a plugin tool shadowing a built-in is refused elsewhere; a
    // duplicate candidate here is a wiring mistake) — the first verdict stands.
    if (!ledger.has(candidate.name)) ledger.set(candidate.name, verdictFor(facts, candidate))
  }
  return ledger
}

/**
 * The economy layer, applied by run assembly once it knows which live tools ride behind
 * `activate_tools`. Only a `live` verdict can become `deferred`: deferral is a wire decision
 * about a tool the run HAS, never a way to hide one it does not.
 */
export function markDeferred(ledger: ToolLedger, sourceByTool: ReadonlyMap<string, string>) {
  const next = new Map(ledger)
  for (const [name, source] of sourceByTool) {
    if (next.get(name)?.state === 'live') next.set(name, { state: 'deferred', source })
  }
  return next as ToolLedger
}

export const isLive = (ledger: ToolLedger, name: string): boolean =>
  ledger.get(name)?.state === 'live'

/** The withheld tools a click could bring back — the only ones the model is ever told about. */
export function remediableWithholds(
  ledger: ToolLedger,
): Array<{ name: string; reason: WithholdReason; remedy: RemedyRef }> {
  const out: Array<{ name: string; reason: WithholdReason; remedy: RemedyRef }> = []
  for (const [name, verdict] of ledger) {
    if (verdict.state === 'withheld' && verdict.remedy)
      out.push({ name, reason: verdict.reason, remedy: verdict.remedy })
  }
  return out
}

/** The model's word for a run shape — the one "# Runtime role" also uses. */
const SHAPE_WORD: Record<string, string> = {
  chat: 'chat',
  subagent: 'sub-agent',
  automation: 'unattended',
}

/**
 * One sentence per reason, for the MODEL — every reader of this function hands its result to
 * one (the withheld stub, `# Unavailable tools`, `configure` inspect).
 *
 * It used to name internal identifiers: `the host capability "config.proposals"` and `rule
 * tool:vault *`. Neither is anything a model can act on or repeat to a person, and the rule
 * syntax invited it to propose rules instead of the one remedy the sentence sits beside. The
 * identifiers stay on the ledger row for the settings screen and the composition dump.
 */
export function describeWithholdReason(reason: WithholdReason): string {
  switch (reason.layer) {
    case 'shape':
      return reason.kind === 'never'
        ? `not available to a ${SHAPE_WORD[reason.shape] ?? reason.shape} run`
        : `not in this ${SHAPE_WORD[reason.shape] ?? reason.shape} role's tool list`
    case 'authority':
      return 'the host does not provide it in this run'
    case 'model':
      return `this run's model cannot read ${reason.needs === 'image' ? 'images' : reason.needs}`
    case 'policy':
      if (reason.kind === 'disabled-plugin') return `its plugin "${reason.plugin}" is disabled`
      return "switched off by this agent's rules"
  }
}
