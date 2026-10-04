import type { ReloadClass } from './contracts'

/**
 * Static hot-reload classification for each settings field — how soon a change
 * takes effect once saved. Advisory diagnostics metadata (this feature never
 * applies settings), following the plan's open decision #10:
 *   - permissions + kill switches           → immediate
 *   - runtime toggles + tool surface          → next-run (re-read at run start)
 *   - session defaults / prompt identity      → new-session (frozen snapshot)
 *
 * Keys are the top-level `agentSettings` / `projectSettings` field names. A field
 * absent from the map falls back to `next-run` via {@link classifyReload}.
 */
export const RELOAD_CLASSES: Record<string, ReloadClass> = {
  // Permission + policy — re-evaluated on every tool call.
  permissions: 'immediate',
  contextExclusions: 'immediate',
  // Live UI-driven toggles read per interaction.
  gitBlame: 'immediate',
  editorScrollbarMarkers: 'immediate',
  bracketPairColorization: 'immediate',
  editorSave: 'immediate',
  followAgentEdits: 'immediate',
  // Read at the start of each run.
  disabledTools: 'next-run',
  maxTurns: 'next-run',
  modelRouting: 'next-run',
  skillOverrides: 'next-run',
  // Session identity/defaults. A session's explicit model selection is
  // authoritative; project model settings seed only newly created root chats.
  modelId: 'new-session',
  providerConnectionId: 'new-session',
  // Baked into the frozen root-session prompt snapshot.
  customSystemPrompt: 'new-session',
}

export function classifyReload(field: string): ReloadClass {
  return RELOAD_CLASSES[field] ?? 'next-run'
}
