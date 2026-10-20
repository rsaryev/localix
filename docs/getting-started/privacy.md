# Understand Localix data flow

Localix keeps its API, database, workspace tools, and product state on the machine where it runs.
Model requests, model-list checks, remote extensions, network tools, Git remotes, and desktop update
checks can still send data to external services.

## Terminology

| Term                | Meaning here                                                    |
| ------------------- | --------------------------------------------------------------- |
| Local state         | Data persisted by Localix on the machine running its API or UI. |
| Provider connection | Configuration and credentials for a model provider.             |
| Plugin              | An installed package that can contribute Localix capabilities.  |
| MCP server          | A configured local or remote Model Context Protocol endpoint.   |

## What you can do

| Control                                | Effect                                                             | Boundary                                                                        |
| -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Choose a provider connection and model | Selects the service that receives model requests.                  | The provider controls its own retention, training, and account policies.        |
| Choose a mode and permission rules     | Gates tool calls before Localix runs them.                         | These rules are application policy, not an operating-system or network sandbox. |
| Disable a plugin or MCP server         | Removes that extension from gathered capabilities.                 | Enabled native plugin backends run as trusted in-process code.                  |
| Use a secret reference where supported | Resolves a vault value at the consuming server boundary.           | The reference can remain in configuration; support depends on that consumer.    |
| Export a redacted session              | Omits supported tool payloads and attachment data from the export. | The stored local session remains unchanged.                                     |

The repository declares no first-party remote analytics or crash-reporting SDK in its checked
package manifests. That narrow claim does not mean Localix has no outbound traffic.

## How it works

### Outbound boundaries

| Mechanism                    | Trigger                                                                                                               | Data sent                                                                                                              | Boundary                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model request                | A session calls its selected model.                                                                                   | The assembled prompt, selected context, tool results, request metadata, and supported attachments.                     | Exact fields vary by provider and model capability.                                                                                                                                                                          |
| Group routing                | In a group conversation, a message of yours that names nobody, or an agent's reply, while OpenRouter is connected.    | The last eight visible messages (first and last 250 characters of each), participants' handles and agent descriptions. | Sent to `~typesafe/jev-latest` on OpenRouter. There is no separate switch: disconnecting OpenRouter stops it, and routing then uses the embedding model on this computer. See [Group routing](../features/group-routing.md). |
| Provider authentication      | You connect an OAuth provider.                                                                                        | Authentication protocol fields and tokens.                                                                             | Browsing the model catalog sends no request; it is served from the app and the last model-list check.                                                                                                                        |
| Model-list check             | Shortly after startup and hourly; or **Check for new models** in Settings → System.                                   | One unauthenticated `GET` for models.dev's public catalog. No credential, prompt, or account data.                     | The source is listed below. The normalized list is stored under `~/.localix/model-catalog/`.                                                                                                                                 |
| MCP, hooks, and plugins      | You enable and invoke a remote server, HTTP hook, or network-capable plugin.                                          | Protocol messages, hook event payloads, configured credentials, and plugin-selected data.                              | Destinations and payloads depend on configuration and plugin code.                                                                                                                                                           |
| Agent and user network tools | A run fetches a URL, searches the web, contacts a package registry, uses a Git remote, or executes a network command. | The query, request, command, credential, or selected content required by that action.                                  | Localix has no central outbound-domain allowlist.                                                                                                                                                                            |
| Desktop updater              | A packaged desktop build exposes the updater bridge.                                                                  | A request for the configured update manifest. A bundle downloads only after an install action.                         | The first check runs after 30 seconds and repeats hourly; ordinary local builds do not publish updater artifacts.                                                                                                            |

**Settings → System → Updates** sends the same manifest request on demand and shows the running
version. A check that cannot reach the manifest reports no newer version rather than an error.

A model-list check requests one public document:

| Source     | URL                                    |
| ---------- | -------------------------------------- |
| models.dev | `https://models.dev/api.json?type=all` |

The request carries no API key, cookie, or Localix identifier; its user agent is `localix`. It is
conditional on the stored copy's `ETag`, so an unchanged catalog answers `304 Not Modified`.
`LOCALIX_MODEL_CATALOG_REFRESH=0` stops the automatic checks; the stored list is still used, and a
manual check still fetches.

The desktop UI also calls the Localix API over loopback. Those requests cross a process boundary but
remain on the same machine unless you deliberately expose or proxy the API.

### Local API access

The API defaults to loopback and has no request authentication. `x-user-id` is a self-asserted data
scope; omission or a blank value uses the configured default user. Ownership checks use that
resolved identity, so the header is not a trusted multi-user login boundary.

Host and browser-origin checks restrict which pages can drive the API. Allowed page origins include
the packaged app, explicitly configured `LOCALIX_UI_ORIGINS`, and the API's own HTTP origin when it
serves the UI. Allowed Host names include loopback names and a configured concrete bind host. Other
local processes can still make requests without a browser origin; these checks are not process
authentication.

Keep the API on loopback or put authentication in front of it before exposing it to untrusted
network callers. The [webhook guide](../features/webhook.md) describes the same request boundary for
inbound external messages.

### Local storage

| Data                                                          | Default location                                                                     | Protection and scope                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions, projects, tasks, transcripts, and configuration     | `~/.localix/localix.db`                                                              | Most SQLite rows are plaintext; Vault value payloads are encrypted. Plugin config and non-OAuth MCP config can contain credentials, environment tokens, or authorization headers; use supported secret references. The database, WAL, and SHM files receive owner-only permissions on a best-effort basis. |
| Documents, tables, media, and other row-backed blobs          | Beside the configured database                                                       | Changing `LOCALIX_DB_FILE` moves this database-adjacent storage.                                                                                                                                                                                                                                           |
| Vault metadata and encrypted credential versions              | The configured SQLite database                                                       | Item metadata is readable; primary values use AES-256-GCM in version rows. The key is stored separately.                                                                                                                                                                                                   |
| Vault master key                                              | `~/.localix/vault/.masterkey`                                                        | A 32-byte key, requested with owner-only file permissions. Preserve it with database backups; the database alone cannot decrypt Vault versions.                                                                                                                                                            |
| MCP OAuth credentials                                         | `~/.localix/mcp-oauth`                                                               | Sensitive fields use AES-256-GCM; server URLs remain readable for status and invalidation.                                                                                                                                                                                                                 |
| Refreshed model list                                          | `~/.localix/model-catalog/models.dev.json`                                           | Public model metadata only. An entry in another format is discarded and rebuilt.                                                                                                                                                                                                                           |
| Memories, plugin state, temporary files, and runtime state    | Subdirectories under `~/.localix`                                                    | Format and sensitivity depend on the feature that wrote the file.                                                                                                                                                                                                                                          |
| UI preferences and recent selections                          | Browser `localStorage` and `sessionStorage`                                          | Stored in the desktop webview or browser profile, outside SQLite.                                                                                                                                                                                                                                          |
| Desktop shell state: window zoom, theme, WebCrypto master key | The app config directory (`~/Library/Application Support/ai.localix.tauri` on macOS) | On macOS 15+, the shell supplies a 16-byte WebCrypto wrapping key from `webcrypto-master-key` when initialization succeeds. Failure falls back to WebKit's keychain path.                                                                                                                                  |
| API and desktop boot logs                                     | Beside the database and in the operating-system temporary directory                  | Logs can contain diagnostics; the API log file is created with owner-only permissions.                                                                                                                                                                                                                     |

Project files stay in the directories you select. Generated artifacts create additional files;
opening a project does not copy it into the database.

## Configuration

| Setting                           | Effect                                                     | Boundary                                                                                          |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `LOCALIX_DB_FILE`                 | Changes the SQLite file and database-adjacent blob root.   | It does not move the vault, MCP OAuth store, or other machine-level state.                        |
| `LOCALIX_DAEMON_LOG`              | Changes the API runtime log path.                          | The destination can contain startup and runtime diagnostics.                                      |
| `~/.localix/wire-dump.on`         | Enables model-wire dumps under `~/.localix/tmp/wire-dump`. | Dumps contain previews from the model-facing message list; this is an explicit diagnostic switch. |
| `LOCALIX_MODEL_CATALOG_REFRESH=0` | Turns off the automatic model-list checks.                 | Stored lists are still restored; **Check for new models** still fetches when you click it.        |

Use the [secrets guide](../features/secrets.md) for vault references and rotation. Use the
[sessions guide](../features/sessions-and-projects.md) for the redacted export format.

## Limits

- Local storage is not the same as operating-system isolation. The database and file-backed keys are
  accessible to processes with sufficient local account privileges; system keychain access depends
  on the operating system's checks.
- On macOS 13 and 14 WebKit keeps the browser's WebCrypto master key in the login keychain. Release
  signing is intended to avoid repeated prompts; development builds or shell-key fallback can still
  use the keychain and prompt.
- Vault encryption protects stored values from casual plaintext inspection. It cannot protect a
  value after an enabled consumer resolves and sends it.
- The SQLite transcript, Vault metadata, and most product configuration are not encrypted by
  Localix.
- Plugin backend code is trusted native code in the API process. Localix does not centrally inspect
  or constrain every destination it can contact.
- Provider, MCP, plugin, Git, package-registry, and fetched-URL retention is outside Localix.
- Back up the database and `vault/.masterkey` together to preserve encrypted Vault values. Changing
  `LOCALIX_DB_FILE` relocates the encrypted versions with the database, but does not move that key.
- Removing the application does not promise removal of the database, vault, browser preferences,
  launcher, or logs. Back up related state together before any destructive reset.

## Related guides

- [Providers](../features/providers.md)
- [Secrets](../features/secrets.md)
- [Permissions](../features/permissions.md)
- [MCP](../features/mcp.md)
- [Plugins](../extending/plugins.md)

## Source of truth

- [Home and database paths](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/env.ts)
- [Host and browser-origin checks](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/local-origin-guard.ts)
- [Self-asserted request identity](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/request-identity.ts)
- [SQLite permissions and adjacent storage](https://github.com/rsaryev/localix/blob/main/apps/api/src/db/connection.ts)
- [Vault database and key ownership](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/store.ts)
- [Vault version persistence](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/store-internals.ts)
- [Vault cipher](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/cipher.ts)
- [Vault master key](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/master-key.ts)
- [MCP OAuth storage](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/oauth/store.ts)
- [Browser WebCrypto master key](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/webcrypto_key.rs)
- [Desktop shell preferences](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/prefs.rs)
- [Native plugin trust boundary](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/native.ts)
- [API log location](https://github.com/rsaryev/localix/blob/main/apps/api/src/index.ts)
- [Model-wire dump switch](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/wire-dump.ts)
- [Desktop update cadence](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/hooks/useDesktopUpdate.ts)
- [Model-list source](https://github.com/rsaryev/localix/blob/main/packages/engine-models/src/catalog/source.ts)
- [Model-list schedule and switch](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/catalog/refresh-schedule.ts)
- [Updater endpoint and bundle configuration](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/tauri.conf.json)
