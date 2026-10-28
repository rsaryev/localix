# Manage credentials with Vault

Vault stores credentials under stable aliases so supported runtimes can use them without embedding
values in configuration. Use it to rotate a credential, inspect its bindings, or authorize a
controlled agent action.

**Storage boundary:** the current backend encrypts values locally; the same operating-system account
can access both the ciphertext and its key.

## What you can do

| Task                   | Mechanism                                                                                         | Boundary                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Add a credential       | Create a user-managed Vault item with a type, alias, and value.                                   | Creation is create-only; an existing alias returns a conflict.                         |
| Use a stable reference | User-managed items expose `secret:<alias>`; mini app strings can interpolate `${secret:<alias>}`. | Provider-managed items do not expose a reusable reference.                             |
| Rotate a value         | Replace the encrypted payload while keeping the item and alias stable.                            | Rotation requires the current version and rejects stale writes.                        |
| Edit metadata          | Change supported type, backend, or metadata fields.                                               | The service writes a new immutable encrypted version even when the value is unchanged. |
| Review use             | Open an item to inspect bindings, version metadata, and audit activity.                           | Read routes return metadata, not plaintext values.                                     |
| Remove an item         | Delete an unbound item, or explicitly force deletion after reviewing bindings.                    | Forced deletion removes the item and all encrypted versions.                           |

## Add or rotate an item

Open **Vault** from the workspace rail and select **Add item**. Choose a type, enter a unique alias
such as `service-token`, and put the credential in the masked value field. Select **Add item** to
save it; the item's **Copy reference** action copies `secret:service-token`, not the value.

To replace a value, select the item and choose **Item actions → Rotate value**. Enter the
replacement and select **Create version**. The alias stays unchanged. Provider- and system-managed
items omit rotation and deletion from this menu; manage their value lifecycle through the owning
connection.

The form clears its value field when a create or rotation request is sent, including when the
request later fails. Re-enter the value before retrying. If the version changed meanwhile, refresh
the item before attempting another rotation.

## How it works

### Terms

| Term            | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| Vault item      | Metadata plus one encrypted primary value.                                      |
| Alias           | The stable name used by `secret:<alias>` references.                            |
| Version         | An immutable encrypted payload and its creation metadata.                       |
| Binding         | A record that another configuration or runtime depends on an item.              |
| Exposure shield | Process-local redaction of resolved values in recorded agent output and errors. |

### Storage and versioning

The `local-aes` backend encrypts each value with AES-256-GCM. Localix creates a random master key at
`~/.localix/vault/.masterkey` and requests owner-only file permissions. Item metadata and encrypted
versions live in the configured SQLite database; the key directory is not the value store. Keep the
database and master key together for backup and restoration. A malformed or unreadable existing key
is refused rather than silently replaced.

Current `v2.` ciphertext uses authenticated data binding the user, item, version, and Vault format.
Moving that ciphertext between records fails authentication. The cipher still reads legacy
unprefixed tokens, which do not carry this context binding.

Rotation and metadata edits append a version, then advance the item's current-version pointer. The
API exposes version metadata for inspection but has no route to reveal or restore an older plaintext
value.

Deleting a Vault item does not revoke a credential at its provider or remove copies outside Vault.
The binding guard checks registered consumers; it does not scan arbitrary files or external systems
for `secret:<alias>` references. An empty binding list therefore does not prove that nothing still
depends on the alias.

### Runtime access

| Consumer                         | Plaintext access                                                           | Control                                                      |
| -------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Vault workspace                  | Accepts a value on create or rotate.                                       | Read responses omit plaintext.                               |
| Provider or mini app server code | Resolves a reference for the requested operation.                          | The trusted server process briefly holds the resolved value. |
| Mini app interpolation           | Replaces `${secret:<alias>}` before the supported mini app operation runs. | The mini app's backend receives the resolved value.          |
| Agent `Vault` tool               | Lists, reads metadata, creates, updates metadata, rotates, or deletes.     | Each call is classified, so a scope can `ask` on the writes. |

Agent create and rotate actions collect values through a masked secret prompt. Delete requires
explicit approval. Those three actions are declined when no human-reachable interactive session is
available; metadata updates remain non-interactive, and the tool classifies each call so a read-only
rule keeps `list`/`get` while denying the rest.

After a runtime resolves a value, the exposure shield tracks its exact raw, URL-encoded, and Base64
forms for that Vault user in the current process. The bounded cache holds at most 256 variant
strings per user; newer registrations can evict older entries. It redacts matches from recorded
results, errors, tool-input records, and progress events; it does not alter the input sent to the
trusted consumer.

### References and agent inputs

Use `secret:service-token` in a consumer that accepts a Vault reference. In a mini app field that
supports interpolation, `${secret:service-token}` substitutes the value inside a larger string.
These spellings do not make arbitrary tools resolve secrets. Interpolation inserts the literal
value; it does not URL-encode or shell-escape it. A missing referenced item fails resolution rather
than substituting an empty value.

The agent can inspect the item's metadata with this `Vault` input:

```json
{ "action": "get", "key": "service-token" }
```

To request rotation, it uses the version returned by `get` and explains the request:

```json
{
  "action": "rotate",
  "key": "service-token",
  "expected_version": 3,
  "reason": "Replace the expiring service credential."
}
```

Enter the replacement value in the masked prompt. The tool schema rejects a `value` field; the agent
receives the storage outcome. Metadata such as the title, description, and tags is visible to the
agent through `list` and `get`, so keep credential values in the encrypted value field.

Approval is not a guarantee that a mutation succeeds. A stale version must be read again before
retrying. The agent's delete action also respects bindings and cannot force removal; use the Vault
workspace to review bindings before an explicit forced deletion. Masked input and deletion approval
use the shared five-minute decision deadline.

### HTTP boundary

Vault routes are scoped to the request's self-asserted Localix user id and return
`Cache-Control: no-store`. The local API does not implement an authentication boundary; keep it on
loopback or place real authentication in front of it before any network exposure. Their
responsibilities are deliberately narrow:

| Operation                            | Result                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------- |
| List or get                          | Item metadata, current version metadata, and reference when available. |
| Create                               | A new item and first encrypted version.                                |
| Rotate                               | A new encrypted version guarded by `expectedVersion`.                  |
| Patch metadata                       | Updated metadata and a new encrypted version.                          |
| List versions, bindings, or activity | Audit metadata without plaintext.                                      |
| Delete                               | Permanent removal, with optional version and force guards.             |

## Configuration

| Surface         | Use                                                                      |
| --------------- | ------------------------------------------------------------------------ |
| Vault rail item | Create, rotate, inspect, and delete items.                               |
| Alias           | Use letters, digits, `_`, `.`, or `-`; maximum length is 128 characters. |
| Value           | Store at most 8,192 characters in the primary encrypted field.           |

Item types and sources are typed metadata. They help consumers classify a credential; they do not
select a different implemented storage backend today. The source filter separates **Personal**,
**Providers**, **Plugins** (a Claude Code plugin's sensitive options), **Mini apps** (a mini app's
secret settings, shown with source **Mini app**) and **System** items.

## Limits

- Local encryption protects stored values from casual database inspection. It does not provide
  hardware-backed custody or protect against the same operating-system account.
- There is no implemented external Vault backend. Schema fields for backend and payload references
  do not make an external service available.
- Trusted provider and mini app code, and the commands of an enabled plugin, can receive plaintext
  after resolution. Install and run that code with the same care as other local code.
- The exposure shield is process-local and exact-match based. Values whose trimmed length is below
  12 characters are not registered. Older variants can be evicted, and values resolved outside the
  process are unknown to it.
- Encoded forms beyond the tracked raw, URL-encoded, and Base64 variants are not guaranteed to be
  redacted.
- Version history is an audit trail, not a restore interface. Deleting an item also deletes its
  encrypted versions.
- A forced delete can break recorded bindings. The Vault workspace requires the alias to confirm
  that operation.

## Related guides

- [Providers](providers.md)
- [Build a mini app](../extending/mini-apps.md)
- [Human-in-the-loop controls](hitl.md)
- [Privacy and local data](../getting-started/privacy.md)

## Source of truth

- [Vault service and versioning](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/service.ts)
- [Exposure shield and cache bounds](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/exposure-shield.ts)
- [Vault master-key loading](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/master-key.ts)
- [Vault database storage](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/store.ts)
- [Vault HTTP routes](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/routes.ts)
- [Encryption and authenticated-data format](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/cipher.ts)
- [Agent Vault tool and approval boundary](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/agent-tool.ts)
- [Mini app secret interpolation](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/secret-interpolate.ts)
- [Vault workspace UI](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/secrets/ui/VaultWorkspace.tsx)
