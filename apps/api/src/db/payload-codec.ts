import type { StoredMessagePayload } from './payload'

// The message payload's WIRE side: the version it is written at, what a writer is allowed to
// change, and the two functions that cross the JSON boundary. Separate from `payload.ts`, which
// describes the SHAPE — a reader that only needs the type should not pull in the codec's rules.

/**
 * The format this build writes, and the ONLY one it reads.
 *
 * A monotonic integer, bumped whenever the stored shape changes in a way an older reader
 * would misread. There is deliberately no compatibility window: this payload has ~20 optional
 * application fields, so a row from a different build type-checks perfectly and reads with
 * fields silently missing — which is the failure this exists to stop, and the same class the
 * `StoredMessagePatch` type was built to prevent on the write side. A product with no format
 * consumers outside itself normalizes old rows with a migration instead of carrying a branch
 * that tests almost never walk.
 */
export const MESSAGE_PAYLOAD_VERSION = 1

/**
 * The payload's IDENTITY: the fields fixed when the row is INSERTed and never patched
 * afterwards. `id` mirrors the row's primary key (it is already a separate argument to
 * every writer, so a payload that also carries it is a second, forgeable copy); `role` is
 * what the row IS; `from` is who said it, which no later edit may reassign; `v` is the format
 * the codec wrote, which only the codec may state.
 */
type MessageIdentity = 'id' | 'role' | 'from' | 'continuedFromMessageId' | 'v'

/**
 * A PATCH to a stored message payload — the ONLY shape `repository.updateMessage` accepts.
 *
 * WHY THIS TYPE EXISTS, and why it excludes exactly these two fields.
 *
 * Four bugs in this repo have been the same bug: a write that REBUILT a stored record from
 * whatever the writer happened to know, instead of MERGING into it — silently deleting every
 * field the rebuilder had never heard of (MCP credentials, skill frontmatter, a child
 * session payload, or an extension-owned entity's `createdAt`). All four type-checked, because
 * every dropped field is OPTIONAL: a literal that omits them is a perfectly valid value of
 * the record type. There is no type error, no failing assertion, and no symptom until
 * someone notices their data is gone.
 *
 * The invariant that would have caught them is PROVENANCE — "this value came from a read" —
 * and TypeScript cannot express it: the derived literal and the invented one are the same
 * type. So we do not try. We change what the writer will ACCEPT:
 *
 *   - `StoredMessagePayload` REQUIRES `id: string` and `role: 'user' | 'assistant'`.
 *   - This type declares both as `?: never`.
 *   ⇒ A WHOLE record — an object literal, a spread of one (`{ ...message.payload, review }`),
 *     or a variable typed as one — is NOT ASSIGNABLE. `tsc` rejects it at the call site.
 *
 * A caller therefore cannot hand the writer a rebuilt record even if it wants to; the only
 * thing it can express is the DELTA it actually authored. The rest of the row is supplied by
 * the writer, from the row. The class is no longer forbidden — it is unwritable.
 *
 * DELETION is spread semantics, deliberately: a key PRESENT with value `undefined` clears the
 * field (`{ review: undefined }` un-reviews a message), because the merge is `{ ...stored,
 * ...patch }` and `JSON.stringify` drops `undefined`. A key that is ABSENT leaves the stored
 * value alone. So "don't touch what I wasn't asked to change" is a conditional spread
 * (`...(name ? { name } : {})`), never a bare `{ name: maybeUndefined }`.
 *
 * A GENUINE whole-record write stays expressible — it is `repository.insertMessage`, which
 * takes the whole `PersistedMessage` and is sound precisely because the row cannot exist yet.
 * Creation is the one place a record may be built from thin air.
 */
export type StoredMessagePatch = {
  [K in Exclude<keyof StoredMessagePayload, MessageIdentity>]?: StoredMessagePayload[K]
} & {
  id?: never
  role?: never
  from?: never
  continuedFromMessageId?: never
}

/**
 * Fold a patch into the row that was read. Identity is re-pinned from the STORED row, so
 * even a patch that smuggled `id`/`role` through an `any` cannot re-key the record.
 */
export function mergeMessagePayload(
  stored: StoredMessagePayload,
  patch: StoredMessagePatch,
): StoredMessagePayload {
  const { continuedFromMessageId: _immutableContinuation, ...changes } = patch
  // `v` is re-pinned from the CONSTANT, not from the stored row: a merge produces a value
  // this build is about to write, so it carries this build's format even if the row it was
  // read from carried an older one (which the reader would have refused anyway).
  return {
    ...stored,
    ...changes,
    id: stored.id,
    role: stored.role,
    from: stored.from,
    continuedFromMessageId: stored.continuedFromMessageId,
    v: MESSAGE_PAYLOAD_VERSION,
  }
}

/** Stamped here, never by a caller — see {@link MessageIdentity}. */
export function serializeMessagePayload(payload: StoredMessagePayload): string {
  return JSON.stringify({ ...payload, v: MESSAGE_PAYLOAD_VERSION })
}

/**
 * Read a stored payload, refusing any version but the current one.
 *
 * The two directions are different problems and get different errors. An OLDER version means
 * this database still holds rows the normalizing migration did not reach — recoverable, and
 * the message says how. A NEWER version means the file was written by a build ahead of this
 * one, which no amount of migrating fixes; the only recovery is the newer build, or the
 * pre-migration snapshot the connection layer keeps beside the database.
 *
 * Both halt the read. A payload silently accepted at the wrong version is read with fields
 * missing and no symptom until someone notices their data is gone.
 */
export function deserializeMessagePayload(payloadJson: string): StoredMessagePayload {
  const payload = JSON.parse(payloadJson) as StoredMessagePayload
  const stored = payload.v
  if (stored === MESSAGE_PAYLOAD_VERSION) return payload
  if (typeof stored !== 'number' || stored < MESSAGE_PAYLOAD_VERSION) {
    throw new Error(
      `Message payload version ${JSON.stringify(stored ?? null)} predates this build ` +
        `(which reads version ${MESSAGE_PAYLOAD_VERSION}). Migration ` +
        '20260820T010000_stamp_message_payload_version stamps stored rows; this row was not ' +
        'reached by it, or was written through a seam that bypasses the codec.',
    )
  }
  throw new Error(
    `Message payload version ${stored} was written by a NEWER build of Localix ` +
      `(this one reads version ${MESSAGE_PAYLOAD_VERSION}). Downgrading is not supported: ` +
      'update the app, or restore a pre-migration snapshot from the `backups/migrations` ' +
      'directory beside the database file.',
  )
}
