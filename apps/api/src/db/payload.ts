import type { AgentChatMessage } from '@localixai/agent/agents/chat'
import type { ParticipantRef } from './participant'
import type { MessageProviderMeta, MessageTiming } from '../contracts/message-timing'
import type { Recovery } from '@localixai/agent/agents'
import type { PermissionMode } from '../contracts/permission-modes'

/**
 * Durable, model-invisible presentation metadata for transcript events owned by
 * the application rather than by the assistant.  The payload still uses one of
 * the agent transport's legal roles; the UI projects these rows to `system`.
 */
export interface StoredSystemNotice {
  kind:
    | 'model_change'
    | 'reasoning_change'
    | 'connection_change'
    /**
     * A run the previous process was in the middle of. The boot sweep reclassifies the row
     * (`agent_runs.status='interrupted'`, `error_code='PROCESS_RESTART'`) and stops the session,
     * but until this notice existed nothing SAID so: the assistant row kept whatever the last
     * 120ms-2s flush had written, so the user came back to a silently truncated answer with no
     * error and no spinner — indistinguishable from a complete reply.
     */
    | 'run_interrupted'
    /**
     * A run that stopped because it reached the person's turn limit
     * (`contracts/turn-budget.ts`). Its own kind rather than prose in the assistant row:
     * the row above is an unfinished answer, and the line saying so is the system speaking
     * about what IT did — the finalizer refuses to fabricate anything in the model's voice.
     */
    | 'turn_limit'
    /**
     * A run that ended in an error the SAME request might survive — a dropped connection, a
     * provider blip, an overloaded upstream. The reason already lands in the assistant row;
     * this row exists for the half the transcript could not say: that trying again is a
     * reasonable thing to do, and that there is a button for it.
     */
    | 'run_failed'
    /**
     * The person CONTINUED a turn that did not finish (`chat/turn-resume.ts`): the agent was told
     * what happened in a note only it reads, and this line marks where the conversation picked up.
     */
    | 'run_continued'
    /**
     * SOMEONE JOINED OR LEFT the conversation.
     *
     * The visible row is UI-only, like every notice. Its resolved system context binding is
     * reduced into the current room snapshot on the volatile tail, so agents see membership
     * without rewriting the cached transcript prefix.
     */
    | 'participants_change'
    /**
     * A CHAIN OF HANDOFFS hit its bound and the floor went back to the person.
     *
     * Without it the conversation simply went quiet mid-collaboration and the person could not
     * tell a finished discussion from a stopped one.
     */
    | 'handoff_limit'
    /**
     * THE CONVERSATION'S PERMISSION MODE CHANGED (`capabilities/permission-modes.ts`).
     *
     * Without it a model moved out of plan mode mid-conversation saw only that its writes stopped
     * being refused, and one moved INTO it kept proposing edits the next turn would deny.
     */
    | 'permission_mode_change'
    /**
     * A STEP OF THE CONVERSATION'S PLAN (`features/plans`): presented, changes requested,
     * approved, set aside, completed. One line per transition, written by the plans service, so
     * the person and every participant read the same history of the plan — a participant that
     * did not present it otherwise learned of an approval only from the implementing turn.
     */
    | 'plan_presented'
    | 'plan_changes_requested'
    | 'plan_approved'
    | 'plan_dismissed'
    | 'plan_resumed'
    | 'plan_completed'
    /**
     * A ONE-LINE RECAP of the session so far (`features/chat/recap`), written when the person
     * comes back after a break or asks for it with `/recap`. A record for the reader of the
     * transcript only: it never becomes model context, so unlike every other kind it carries
     * no system context binding (`carriesModelContext`).
     */
    | 'session_recap'
  tone: SystemNoticeTone
  text: string
  detail?: string
  /**
   * The mode a `permission_mode_change` switched TO. Without it the client drew every mode line
   * with the same shield in the same tone, so a switch to Autonomous looked like a switch back to
   * Default. Optional because rows written before it carry only the prose; those keep the
   * generic look.
   */
  mode?: PermissionMode
  /**
   * The participant handle a per-participant notice (a model or reasoning change) is about. It
   * keys the notice's model-facing slot, so a later change replaces the earlier one.
   */
  participant?: string
  /**
   * What the reader can DO about this, when there is anything — first is primary.
   *
   * A typed vocabulary (`features/notifications/recovery.ts`) rather than free text or a
   * client-side guess by `kind`: the host is the one that knows whether a retry is reasonable
   * (it classified the error, and it knows whether a side-effecting call was in flight), and
   * the client must never be handed an instruction it has to interpret. `retry` means "re-run
   * the turn this reply belongs to" — the regenerate path, which keeps the failed attempt as a
   * sibling branch. A spent quota offers `open-settings:providers` instead: a Retry there is a
   * promise it cannot keep. Rows written before the list stored the bare string `'retry'`;
   * migration `20261006T000000_system_notice_tone` rewrites them to `['retry']`.
   */
  recovery?: readonly Recovery[]
}

/**
 * The ONE tone vocabulary (`StatusTone` in the mini app SDK says the same five words). `muted`
 * was this union's word for `neutral` and it had no `error`, so a run that failed for good
 * rendered in warning amber beside an error row in the Event Center. Stored `muted` rows are
 * rewritten to `neutral` by the same migration: the codec keeps no compatibility branch.
 */
export type SystemNoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

export interface StoredCommandOutput {
  /** Canonical command token shown as the compact result header (`/help`, `/clear`, …). */
  command: string
  tone: 'neutral' | 'success' | 'warning' | 'error'
}

/**
 * A persisted message. The assistant's structured content lives in `items`
 * (the normalized AgentItem list on AgentChatMessage) — the single source of
 * truth for rendering and LLM reconstruction; the legacy contentBlocks+toolParts
 * split is gone.
 */
export interface StoredMessagePayload extends AgentChatMessage {
  /**
   * On-disk format version. A property of the STORED form, not of the value in memory: it is
   * stamped by {@link serializeMessagePayload} and required by
   * {@link deserializeMessagePayload}, so a payload a writer just built legitimately has none
   * yet and no construction site states it. Named in one character because it rides every
   * message row and every wire frame.
   *
   * Not patchable either: it is part of {@link MessageIdentity}, so `StoredMessagePatch`
   * declares it `?: never`.
   */
  v?: number
  /**
   * Ephemeral optimistic UI row ids represented by this persisted user turn.
   * A queued delivery may merge several compatible prompts into one row, so the
   * correlation is plural. Model conversion ignores this presentation metadata.
   */
  clientMessageIds?: string[]
  /** System-generated messages (for example a wake's hidden prompt row) hidden from the UI. */
  isInternal?: boolean
  /** Immutable link to the previous assistant row when mid-run steering split an execution.
   * Presentation only: model history still reads the rows in their stored order. */
  continuedFromMessageId?: string
  /**
   * Provenance of a non-user-typed turn — an OPAQUE tag (the domain `WakeSource`
   * union in chat/contracts narrows it). Orthogonal to `isInternal` (visibility):
   * this records WHERE the turn came from (loop / mini app / sleep / media / …) for
   * display + analytics. The storage layer deliberately does NOT enumerate values.
   */
  origin?: string
  /**
   * Mini apps whose tools the turn answering this row carries — the mini app that woke it. The
   * typed counterpart rides each context binding (`MessageContextBinding.miniApp`); both are read
   * by `runtime/run/surface-tools.ts`, never persisted onto the session.
   */
  miniApps?: string[]
  /**
   * UI-ONLY marker: rendered in the transcript but EXCLUDED from the model context
   * (the inverse of `isInternal`, which hides from the UI but feeds the model).
   * Used for human-facing notes the model should not act on — e.g. a mode-switch
   * marker. Filtered out when assembling the per-run effective history.
   */
  uiOnly?: boolean
  /**
   * A Claude Code `UserPromptSubmit` hook (or a mod's `prompt.submit`) refused this prompt. The
   * person still sees it as their message; the model never reads it, except when a Retry of the
   * turn it started submits it again and the hooks decide again (`chat/runtime/history/intake.ts`).
   */
  promptBlocked?: true
  /** Compact one-line application event, persisted across reloads. */
  systemNotice?: StoredSystemNotice
  /** Multi-line slash-command result rendered as system chrome, never as agent prose. */
  commandOutput?: StoredCommandOutput
  /**
   * Marks a `/clear` or topic boundary: the model's view of the conversation starts after the most
   * recent one. The rows before it stay in the transcript for the person.
   */
  contextBoundary?: boolean
  /**
   * The person asked to keep this message in the model's view. A context checkpoint never
   * evicts or compresses it, and one that already left the view is shown again, verbatim.
   */
  pinned?: true
  /**
   * The ticked boxes of a reply's checklist (GFM `- [ ]` items), keyed `<text item id>:<source
   * offset>` — where each box sits in its text, which a settled reply never changes. The person's
   * marks, like `pinned`: message state that rides `message.updated`, and never sent to the model.
   */
  taskStates?: Record<string, boolean>
  /**
   * What a Claude Code `MessageDisplay` hook asked to show in place of a text item, keyed by the
   * item id. Display only: `content` and the items keep the original, which is what the model
   * reads back, what a reply hands on, and what copy and export take.
   */
  displayTexts?: Record<string, string>
  /**
   * UI-only: origin annotation for messages injected by a slash command that
   * forwarded to the agent (e.g. `/loop 5m <task>` → the first immediate run, or
   * `/mode yolo <task>`). Rendered as a small badge in the timeline so the user can
   * tell the message was command-originated rather than a direct prompt.
   */
  commandOrigin?: { command: string; label: string }
  /**
   * WHO SAID THIS. Fixed at insert and never patched (see {@link MessageIdentity}), because a
   * conversation whose authorship can be rewritten is not a record of anything.
   *
   * Required, not optional: a message with no author is the bug this field exists to prevent,
   * and an optional field is one a writer forgets silently — the same failure the patch type
   * below was built to make unwritable. Every construction site therefore states it, and `tsc`
   * lists them all when a new one appears.
   */
  from: ParticipantRef
  /** Presentation captured at insert; never re-resolved by handle or changed by streaming. */
  authorSnapshot?: { handle: string }
  /**
   * WHAT PEOPLE AND AGENTS PUT ON THIS MESSAGE, rather than said about it.
   *
   * A STATE of the message, not events in the conversation: one entry per (author, emoji), so
   * reacting twice with the same mark is reacting once and a retried turn cannot inflate a
   * count. Kept on the message it is about — a reaction with no message is meaningless, and a
   * separate table would have to be joined by every reader of a transcript.
   *
   * It exists because agreeing is a real contribution with no cheap way to make it: measured in
   * a live four-member conversation, about twenty of a four-member room's forty-nine replies were restatements of a
   * colleague, half its cost and most of its noise.
   */
  reactions?: { emoji: string; from: ParticipantRef; at: string }[]
  /**
   * WHO IT IS FOR, when the message is addressed rather than said to the room. Absent is the
   * ordinary case — a 1-1 chat has one counterpart and a broadcast in a group has no single
   * recipient — so this carries the exception: a message aimed at one participant, which a
   * group scheduler reads to decide who answers.
   */
  to?: ParticipantRef
  /**
   * The recipient's handle, frozen at insert — the sibling of `authorSnapshot`, for the same
   * reason: the room's projection names the recipient in the line it shows everyone else, and
   * re-resolving a handle would both mis-attribute a renamed agent and change the bytes of an
   * already-cached prefix.
   */
  toSnapshot?: { handle: string }
  /**
   * THIS TURN ENDED IN AN ERROR, and its `content` is that error rather than anything the agent
   * said.
   *
   * Stated structurally because the alternative is reading the prose, and a reader that has to
   * recognise error text will eventually mistake a reply ABOUT an error for one. It matters most
   * in a group, where the other members are shown what their colleagues said: an agent whose
   * provider was misconfigured must not appear to have contributed "Agent is unavailable".
   *
   * Absent on every successful turn, which is why it is a flag and not a status.
   */
  failed?: true
  /** Timing telemetry for this assistant message (model/tool/idle/hitl breakdown). */
  timing?: MessageTiming
  /** Which provider + API key produced this message (footer badge). */
  providerMeta?: MessageProviderMeta
  /**
   * How the last model turn of this message ran, stamped at each turn's end: what the usage
   * ledger row is derived from (`usage/ledger-projector.ts`), so the ledger needs nothing but
   * the message.
   */
  turnEnd?: {
    finishReason?: string
    keyId?: string
    keyLabel?: string
    keyMasked?: string
    providerId?: string
    modelId?: string
    providerConnectionId?: string
  }
}

// The codec — version, patch type, merge, serialize, deserialize — lives in `payload-codec.ts`
// and is re-exported so importers keep taking the payload's whole vocabulary from one place.
export {
  MESSAGE_PAYLOAD_VERSION,
  mergeMessagePayload,
  serializeMessagePayload,
  deserializeMessagePayload,
  type StoredMessagePatch,
} from './payload-codec'
