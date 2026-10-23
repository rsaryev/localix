/**
 * The `confirm` HITL contract — the payload/response shapes a mini app backend uses
 * when it requests a permission approval through the host's human-in-the-loop
 * controller. Pure types built on the generic HITL bases from `@localixai/agent`.
 * Moved here so mini apps depend on the SDK instead of deep-importing
 * `apps/api/src/features/agent-core/tools/hitl/confirm`.
 */
import type { HumanInLoopRequestBase, HumanInLoopResponseBase } from '@localixai/agent/agents'

export interface ConfirmToolPayload {
  /** What is being approved, verbatim: a shell line, the paths a call touches, a resource. */
  command: string
  /**
   * WHICH of those `command` is, so the card can render it as what it is.
   *
   * Without it every approval was drawn as a terminal: a shell prompt glyph above a working
   * directory, for a call that writes one file and runs no shell. Absent = `command`, which
   * is what every existing producer meant.
   */
  subject?: 'command' | 'path' | 'resource'
  cwd?: string
  /**
   * Why this is being asked, when there is something to say — the message of the rule that
   * matched. Absent when the rule carried none: a card that restates its own title in other
   * words gives the reader a second line and no second fact.
   */
  description?: string
  sourceKind?: 'subagent'
  sourceTitle?: string
  /**
   * How far an approval may reach beyond this one call, NARROWEST FIRST — the only breadths
   * the host will honour, so a client picks one and cannot invent another.
   *
   * Absent or empty: the approval covers this call and the next one asks again — an
   * interpreter, a chained line, a credential path. The card must then offer neither
   * "This session" nor "Always", or it promises what nothing keeps.
   *
   * It replaced three fields (`sessionGrant`, `persistentRule`, `persistentSubject`) that
   * could describe exactly one breadth. A file card needs several — the file, its folder, the
   * folder above — and the person is the one who knows which level is the project.
   */
  grants?: ConfirmGrantOption[]
}

/** One breadth a confirm can be widened to. */
export interface ConfirmGrantOption {
  /** Named back in the answer's `grant`. Opaque to the client. */
  id: string
  /**
   * `program` — every command of one program; `path` — exactly one path; `folder` —
   * anything inside a folder; `resource` — one declared resource; `tool` — the tool, for a
   * call that names nothing.
   */
  kind: 'program' | 'path' | 'folder' | 'resource' | 'tool'
  /** A short name for a picker segment: `git`, `useTheme.ts`, `src`. */
  label: string
  /** What it covers, completing "Won't ask again for …" — `anything inside ~/x/src`. */
  covers: string
  /**
   * For a `path` or `folder`: the absolute path it names. The card renders the subject as
   * breadcrumbs and lets the person pick a segment; this is what a segment is matched against,
   * so the client never parses the opaque `id`.
   */
  target?: string
  /**
   * The rule an `always` answer writes, in the spelling Settings shows (`read(/x/src/*)`).
   * Absent: this breadth can be remembered for the session only.
   */
  rule?: string
}

export type ConfirmToolRequest = HumanInLoopRequestBase<'confirm', ConfirmToolPayload>

export interface ConfirmToolResponsePayload {
  answers: {
    confirmed: boolean
    /**
     * Approval duration, widening in one direction.
     *
     * `once` (default) approves just this call. `session` additionally auto-approves every
     * later ask the chosen `grant` covers in this session — in memory, so a restart or a
     * different session asks again. `always` also writes that grant's `rule` into the asking
     * agent's own list, where it outlives the process and is visible and revocable in Settings.
     */
    scope?: 'once' | 'session' | 'always'
    /**
     * Which offered breadth (`ConfirmGrantOption.id`) a `session`/`always` answer means.
     * Absent: the narrowest offered. An id the card did not offer widens nothing.
     */
    grant?: string
    /**
     * What the person wrote back — sent to the agent with the verdict, so a refusal can say
     * what to do instead. Bounded by the host.
     */
    message?: string
  }
}

export type ConfirmToolResponse = HumanInLoopResponseBase<'confirm', ConfirmToolResponsePayload>
