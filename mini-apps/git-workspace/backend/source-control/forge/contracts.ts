/**
 * Forge (code-host) contracts — VCS/host-neutral. A "forge" is the platform a
 * repo is hosted on (GitHub today; GitLab/Bitbucket later). These shapes are the
 * only thing the UI + routes speak; the concrete `gh`-CLI wire format never
 * escapes the backend impl. Keep greppable — see docs/internals/subsystems/source-control.md.
 */

/** Which forge a repository is hosted on (the port is neutral; only GitHub is wired in v1). */
export type ForgeKind = 'github'

/**
 * Availability of forge features for a working directory. Nothing here is an
 * error — the UI renders a quiet hint from these flags rather than a toast:
 *   installed=false → the host CLI isn't on PATH,
 *   installed=true & authed=false → CLI present but not logged in,
 *   authed=true & hasRemote=false → logged in but this repo has no forge remote.
 */
export interface ForgeStatus {
  forge: ForgeKind
  /** The host CLI binary is available (`gh` on PATH). */
  installed: boolean
  /** The CLI is authenticated (`gh auth status` ok). */
  authed: boolean
  /** This working dir resolves to a repo with a forge remote (`gh repo view` ok). */
  hasRemote: boolean
  /** `owner/repo` when resolvable, else null. Display only. */
  nameWithOwner: string | null
  /**
   * Without `gh` the CLI cannot say whether this is a GitHub repo, so git's own remotes answer:
   * true when one points at github.com. Lets the panel offer "Install GitHub CLI" where it would
   * actually help, instead of the section silently not existing.
   */
  githubRemote?: boolean
}

/** Rolled-up CI state for a pull request (from the per-check `statusCheckRollup`). */
export type ForgeCheckRollup = 'passing' | 'failing' | 'pending' | 'none'

/** Open pull request state (gh only lists OPEN by default; kept explicit for clarity). */
export type ForgePrState = 'OPEN' | 'CLOSED' | 'MERGED'

/** One pull request as the UI consumes it. */
export interface ForgePullRequest {
  number: number
  title: string
  state: ForgePrState
  /** The PR's source branch (`headRefName`) — used to pin the current branch's PR first. */
  headRefName: string
  /** Web URL — a row click opens this in the browser. */
  url: string
  isDraft: boolean
  /** Author login, or null when unknown. */
  author: string | null
  /** Rolled-up CI verdict across all checks. */
  checks: ForgeCheckRollup
}
