import { z } from 'zod'

/**
 * The wire shape of a COMPOSER TIP — what the waiting band says, when it applies, and
 * what one click on it does.
 *
 * Its own module rather than a section of the capability contract: a tip is composed
 * FROM that document but is not part of describing what a scope can do, and the two
 * change for different reasons. `capabilitySnapshotSchema` imports the tip; nothing
 * here imports the snapshot.
 */

/**
 * The named facts about the LIVE SESSION a tip may be gated on.
 *
 * A server composing tips knows what a scope HAS; it cannot know what is happening in
 * the composer right now — that a run has gone long, that messages are queued behind
 * it, that the context is nearly full. Those are the facts that decide whether a tip
 * is advice or noise, so the vocabulary is declared here and the client answers it:
 * the server says WHICH fact a tip needs, the client says whether it holds.
 *
 * Adding a member is a two-sided change on purpose — a signal nobody resolves would
 * silently make its tips uneligible forever, which is the failure mode this enum
 * exists to make visible. The client resolves every member: `tipSignals.ts` reads
 * them off session state, and `run-long` is timed by the tip hook itself, which is
 * already holding that clock.
 */
export const TIP_SIGNALS = [
  /** The current run has been streaming long enough that the user is waiting. */
  'run-long',
  /** Messages are queued behind the running turn. */
  'queue-nonempty',
  /** The session is close to its next context checkpoint. */
  'context-tight',
  /** A long conversation — enough turns that forking is real advice. */
  'session-long',
  /** Recurring loops are armed on this session. */
  'loops-active',
  /** Background monitors are watching for something that will wake this session. */
  'monitors-active',
  /** This is one of the user's first conversations. */
  'first-session',
] as const
export const tipSignalSchema = z.enum(TIP_SIGNALS)
export type TipSignal = z.infer<typeof tipSignalSchema>

/**
 * WHEN a tip is about what is happening right now — a gate the client can evaluate
 * without understanding any of it.
 *
 * Every field is DATA, never a predicate: a regexp source, tool names, signal names.
 * That is the whole point of sending them. The client used to hold the predicates, so
 * it also held the vocabulary they were written in — plugin names, tool names, which
 * of them were worth mentioning — and none of that is knowledge a composer can have
 * about a workspace whose plugins it does not ship.
 *
 * Conditions are ANDed, and a more specific gate WINS: the client ranks eligible tips
 * by how much of the moment they name (see `pickStreamTip`), so a tip that matches the
 * streaming tool and a signal is preferred over one that matches nothing in particular.
 */
export const composerTipGateSchema = z.object({
  /** Case-insensitive RegExp SOURCE, tested against the latest user message. */
  textPattern: z.string().optional(),
  /** Matches while one of these tools is the one currently streaming. */
  tools: z.array(z.string()).optional(),
  /** Every one of these session facts must hold. */
  signals: z.array(tipSignalSchema).optional(),
  /** None of these session facts may hold. */
  notSignals: z.array(tipSignalSchema).optional(),
})
export type ComposerTipGate = z.infer<typeof composerTipGateSchema>

/**
 * A QUICK ACTION on a tip: the one click that acts on what the tip just said.
 *
 * A tip that ends in "…in Settings → Plugins" has already lost most of its readers to
 * the navigation. Both kinds reuse a path the product already has — the composer bus
 * that stages text, and the URI navigation every agent action, search hit and `/open`
 * result goes through — so a tip opens exactly what a link in a message would, and a
 * destination that does not resolve in this build is simply not offered.
 */
export const composerTipActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('insert'),
    label: z.string(),
    /** Staged in the composer for the user to edit and send — never sent for them. */
    text: z.string(),
  }),
  z.object({
    kind: z.literal('navigate'),
    label: z.string(),
    /**
     * A canonical `localix://` destination — a UI surface (`localix://ui/settings/…`)
     * or a registered resource (`localix://resource/vault/items`), resolved by the
     * client's navigation registry exactly as a link inside a message would be.
     */
    uri: z.string(),
    description: z.string().optional(),
  }),
])
export type ComposerTipAction = z.infer<typeof composerTipActionSchema>

/**
 * ONE tip for the composer's waiting band, composed from THIS scope's catalogs.
 *
 * A tip is content about what this workspace can do, so it is built where that is
 * known: a plugin nobody installed is never advertised, a tool the scope denies is
 * never taught, and a skill saved five minutes ago is offered without anyone editing
 * a list. A tip with no `when` is generic and always eligible.
 */
export const composerTipSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** At most a couple — a waiting band is not a toolbar. */
  actions: z.array(composerTipActionSchema).max(2).optional(),
  when: composerTipGateSchema.optional(),
})
export type ComposerTip = z.infer<typeof composerTipSchema>
