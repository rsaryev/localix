/**
 * Tab-scoped persistence for the wizard's current step (and the furthest step
 * reached so far).
 *
 * The wizard otherwise keeps its step purely in React state — fine until a step
 * navigates the WHOLE TAB away and back. The OAuth providers do exactly that:
 * signing in to OpenRouter redirects to its consent page and returns to
 * `http://localhost:5050/?code=…&state=…#/setup`, a full-page reload that
 * remounts the wizard. Without persistence it remounts at step 0 and the user
 * "starts over" (and the Provider step — the only `/setup` consumer that
 * exchanges the returned `?code` — never mounts, so the sign-in silently never
 * completes). Restoring the step lands them back on Provider, which both keeps
 * their place AND mounts the OAuth-completion handler. The furthest-reached
 * step is persisted alongside so revisit-later navigation (jump forward to an
 * already-seen step) survives the same reload.
 *
 * Stored as step IDS, not indexes: the registry grows and reorders between
 * releases, so an index written by an older build would resume on a DIFFERENT
 * step than the user left — and for the OAuth return that means landing away
 * from Provider and dropping the sign-in. An unknown id (renamed, removed, or a
 * legacy numeric value) resolves to the first step instead of guessing.
 *
 * `sessionStorage` (not `localStorage`): scoped to the tab and cleared when it
 * closes, so an abandoned wizard never resurrects in a brand-new tab. Explicitly
 * cleared when onboarding finishes or is skipped so "Replay setup" starts fresh.
 */
const STEP_KEY = 'localix_onboarding_step'
const FURTHEST_KEY = 'localix_onboarding_furthest'

/** Index of the stored step id within `stepIds`; 0 when absent or unrecognised. */
function readStoredIndex(key: string, stepIds: readonly string[]): number {
  try {
    const raw = sessionStorage.getItem(key)
    if (raw == null) return 0
    const index = stepIds.indexOf(raw)
    return index >= 0 ? index : 0
  } catch {
    // Storage blocked (private mode, disabled cookies): start at the first step. There is nothing
    // to report — the wizard works, it just cannot remember where it was.
    return 0
  }
}

function write(key: string, stepId: string): void {
  try {
    sessionStorage.setItem(key, stepId)
  } catch {
    /* sessionStorage unavailable (private-mode quota) — progress just won't persist. */
  }
}

export function loadOnboardingStep(stepIds: readonly string[]): number {
  return readStoredIndex(STEP_KEY, stepIds)
}

export function saveOnboardingStep(stepId: string): void {
  write(STEP_KEY, stepId)
}

/** The furthest step index the user has reached; never less than the current step. */
export function loadOnboardingFurthest(stepIds: readonly string[]): number {
  return Math.max(readStoredIndex(FURTHEST_KEY, stepIds), loadOnboardingStep(stepIds))
}

export function saveOnboardingFurthest(stepId: string): void {
  write(FURTHEST_KEY, stepId)
}

export function clearOnboardingStep(): void {
  try {
    sessionStorage.removeItem(STEP_KEY)
    sessionStorage.removeItem(FURTHEST_KEY)
  } catch {
    /* nothing was stored to begin with — see `write`. */
  }
}
