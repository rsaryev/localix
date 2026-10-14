/**
 * Per-session composer drafts, kept across session switches, reloads and relaunches.
 *
 * The chat composer is one shared input that doesn't remount on session switch, so without
 * this a half-typed message would LEAK into the next chat you open (and be lost for the one
 * you left). They used to live in memory only, so every page reload — the port handoff on a
 * cold start, a runtime respawn — and every quit threw the half-typed message away.
 *
 * Now each draft is persisted to localStorage behind a short debounce (flushed on quit and
 * pagehide through `quitFlush`), restored on load, and bounded: at most {@link MAX_DRAFTS}
 * drafts, the most recently typed kept, and a draft over {@link MAX_PERSISTED_CHARS} stays
 * in memory only rather than filling the store. A deleted session's draft is dropped with it
 * (`forget`). Empty text drops the key, so `get` of a never-typed session returns ''.
 */
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'
import { createPendingWrite } from './quitFlush'

const STORAGE_KEY = 'localix_composer_drafts_v1'
export const MAX_DRAFTS = 50
export const MAX_PERSISTED_CHARS = 32_000
const SAVE_DEBOUNCE_MS = 400

interface StoredDraft {
  text: string
  /** Last edit, epoch ms: the eviction order once there are more than MAX_DRAFTS. */
  at: number
}

let drafts: Map<string, StoredDraft> | null = null

function load(): Map<string, StoredDraft> {
  if (drafts) return drafts
  drafts = new Map()
  const raw = loadJSON<unknown>(STORAGE_KEY)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const draft = value as Partial<StoredDraft> | null
      if (typeof draft?.text === 'string' && draft.text && typeof draft.at === 'number') {
        drafts.set(id, { text: draft.text, at: draft.at })
      }
    }
  }
  return drafts
}

function persist(): void {
  const live = load()
  const kept = [...live.entries()]
    .filter(([, draft]) => draft.text.length <= MAX_PERSISTED_CHARS)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_DRAFTS)
  saveJSON(STORAGE_KEY, kept.length > 0 ? Object.fromEntries(kept) : null)
}

const pendingSave = createPendingWrite('composer-drafts', SAVE_DEBOUNCE_MS, persist)

export const composerDrafts = {
  get(sessionId: string): string {
    return load().get(sessionId)?.text ?? ''
  },
  set(sessionId: string, text: string): void {
    const live = load()
    if ((live.get(sessionId)?.text ?? '') === text) return
    if (text) live.set(sessionId, { text, at: Date.now() })
    else live.delete(sessionId)
    pendingSave.schedule()
  },
  /** Drop a deleted session's draft. */
  forget(sessionId: string): void {
    composerDrafts.set(sessionId, '')
  },
}

/** Tests: drop the in-memory copy (NOT a flush) so the next read loads from storage again. */
export function reloadComposerDraftsForTests(): void {
  drafts = null
}
