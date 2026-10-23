/**
 * Something outside Localix that a mini app needs — Docker, git, a cluster's credential helper —
 * and the one fact about it a person can act on.
 *
 * Without this, "Docker is not installed", "Docker is installed but not running" and "Docker said
 * something odd" all reached the screen as one sentence with a Retry under it, and Retry fixes none
 * of the first two. Every mini app with an external dependency had to rediscover that, and none
 * had: the only install link in the whole product was a URL inside an error string.
 *
 * So a failure that IS a missing prerequisite says so as data — which thing, which of the two
 * states, where to get it, and the command that starts it — and the host turns that into the right
 * way out: a link for `missing`, a command PASTED into the terminal for `stopped` / `signed-out`
 * (the person reads it and presses Enter; nothing is launched on their behalf).
 *
 * Zero imports and pure data, so the backend that classifies a failure and the browser that renders
 * it share this one module (`@localixai/mini-app-sdk/prerequisite`).
 */

export type PrerequisiteState =
  /** Not on this machine (or not on the PATH the app can see). The way out is installing it. */
  | 'missing'
  /** Installed, but the service behind it is not answering. The way out is starting it. */
  | 'stopped'
  /** Installed and running, but not authenticated. The way out is signing in. */
  | 'signed-out'

export interface Prerequisite {
  /** Stable id within the mini app — `docker`, `git`, `gh`. Keys the recovery actions. */
  id: string
  /** What a person calls it: `Docker`, `Git`, `GitHub CLI`. */
  name: string
  state: PrerequisiteState
  /** Where to get it. Offered for `missing`. */
  installUrl?: string
  /**
   * The shell command that resolves a `stopped` or `signed-out` state on THIS machine
   * (`open -a Docker`, `colima start`, `gh auth login`). Pasted, never executed.
   */
  command?: string
}

/** The headline for a prerequisite failure — what is wrong, in the person's words. */
export function prerequisiteTitle(prerequisite: Prerequisite): string {
  switch (prerequisite.state) {
    case 'missing':
      return `${prerequisite.name} is not installed`
    case 'stopped':
      return `${prerequisite.name} is not running`
    case 'signed-out':
      return `Not signed in to ${prerequisite.name}`
  }
}

/** The one sentence under the headline: what to do about it. */
export function prerequisiteHint(prerequisite: Prerequisite): string {
  switch (prerequisite.state) {
    case 'missing':
      return `Install ${prerequisite.name}, then try again. If it is installed, make sure it is on your shell's PATH.`
    case 'stopped':
      return prerequisite.command
        ? `Start ${prerequisite.name} with \`${prerequisite.command}\`, then try again.`
        : `Start ${prerequisite.name}, then try again.`
    case 'signed-out':
      return prerequisite.command
        ? `Sign in with \`${prerequisite.command}\`, then try again.`
        : `Sign in to ${prerequisite.name}, then try again.`
  }
}

/** Label of the action that resolves the state — the button a person looks for. */
export function prerequisiteActionLabel(prerequisite: Prerequisite): string | null {
  if (prerequisite.state === 'missing')
    return prerequisite.installUrl ? `Install ${prerequisite.name}` : null
  if (!prerequisite.command) return null
  return prerequisite.state === 'stopped' ? `Start ${prerequisite.name}` : 'Sign in'
}

/**
 * Whether a thrown spawn failure means "that program is not on this machine" — the test that
 * decides a `missing` prerequisite.
 *
 * Reads the `code` as well as the text: Bun says `Executable not found in $PATH: "docker"`, Node's
 * child_process says `spawn docker ENOENT`, a shell says `docker: command not found` — and the one
 * reliable fact, `code: 'ENOENT'` on a spawn, is exactly what a message-only classifier never saw.
 * An `open` ENOENT is some FILE missing, not the program, so only a spawn's counts.
 */
export function isMissingExecutable(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; syscall?: unknown; message?: unknown }
    if (e.code === 'ENOENT') {
      if (typeof e.syscall === 'string') return e.syscall.startsWith('spawn')
      if (typeof e.message === 'string' && /executable|spawn/i.test(e.message)) return true
    }
  }
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return /executable not found in \$path|command not found|is not recognized as an internal or external command|spawn \S+ enoent/i.test(
    text,
  )
}

const STATES: ReadonlySet<string> = new Set<PrerequisiteState>(['missing', 'stopped', 'signed-out'])

/**
 * Read a prerequisite back off a wire body. A response is untrusted JSON: anything that is not the
 * exact shape yields `null`, so a malformed body degrades to an ordinary failure instead of a
 * button with `undefined` in it.
 */
export function parsePrerequisite(value: unknown): Prerequisite | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || !v.id) return null
  if (typeof v.name !== 'string' || !v.name) return null
  if (typeof v.state !== 'string' || !STATES.has(v.state)) return null
  const installUrl =
    typeof v.installUrl === 'string' && v.installUrl.startsWith('https://')
      ? v.installUrl
      : undefined
  const command = typeof v.command === 'string' && v.command.trim() ? v.command : undefined
  return {
    id: v.id,
    name: v.name,
    state: v.state as PrerequisiteState,
    ...(installUrl ? { installUrl } : {}),
    ...(command ? { command } : {}),
  }
}
