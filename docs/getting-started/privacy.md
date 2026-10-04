# Understand Localix data flow

Localix keeps its API, database, workspace tools, and product state on the machine where it runs.
Model requests, remote extensions, network tools, Git remotes, and desktop update checks can still
send data to external services.

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

| Mechanism                            | Trigger                                                                                                               | Data sent                                                                                          | Boundary                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Model request                        | A session calls its selected model.                                                                                   | The assembled prompt, selected context, tool results, request metadata, and supported attachments. | Exact fields vary by provider and model capability.                                                               |
| Provider authentication and catalogs | You connect an OAuth provider or browse models whose metadata is not cached.                                          | Authentication protocol fields, tokens, and public model-catalog requests.                         | A catalog request can occur without sending a chat prompt.                                                        |
| MCP, hooks, and plugins              | You enable and invoke a remote server, HTTP hook, or network-capable plugin.                                          | Protocol messages, hook event payloads, configured credentials, and plugin-selected data.          | Destinations and payloads depend on configuration and plugin code.                                                |
| Agent and user network tools         | A run fetches a URL, searches the web, contacts a package registry, uses a Git remote, or executes a network command. | The query, request, command, credential, or selected content required by that action.              | Localix has no central outbound-domain allowlist.                                                                 |
| Desktop updater                      | A packaged desktop build exposes the updater bridge.                                                                  | A request for the configured update manifest. A bundle downloads only after an install action.     | The first check runs after 30 seconds and repeats hourly; ordinary local builds do not publish updater artifacts. |

**Settings → General → Updates** sends the same manifest request on demand and shows the running
version. A check that cannot reach the manifest reports no newer version rather than an error.

The desktop UI also calls the Localix API over loopback. Those requests cross a process boundary but
remain on the same machine unless you deliberately expose or proxy the API.

### Local storage

| Data                                                          | Default location                                                                     | Protection and scope                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions, projects, tasks, transcripts, and configuration     | `~/.localix/localix.db`                                                              | SQLite rows are plaintext. Plugin config and non-OAuth MCP config can contain credentials, environment tokens, or authorization headers; use supported secret references. The database, WAL, and SHM files receive owner-only permissions on a best-effort basis.                                                     |
| Documents, tables, media, and other row-backed blobs          | Beside the configured database                                                       | Changing `LOCALIX_DB_FILE` moves this database-adjacent storage.                                                                                                                                                                                                                                                      |
| Provider credentials and secret values                        | `~/.localix/vault`                                                                   | Values use AES-256-GCM. The 32-byte master key is stored at `~/.localix/vault/.masterkey`.                                                                                                                                                                                                                            |
| MCP OAuth credentials                                         | `~/.localix/mcp-oauth`                                                               | Sensitive fields use AES-256-GCM; server URLs remain readable for status and invalidation.                                                                                                                                                                                                                            |
| Memories, plugin state, temporary files, and runtime state    | Subdirectories under `~/.localix`                                                    | Format and sensitivity depend on the feature that wrote the file.                                                                                                                                                                                                                                                     |
| UI preferences and recent selections                          | Browser `localStorage` and `sessionStorage`                                          | Stored in the desktop webview or browser profile, outside SQLite.                                                                                                                                                                                                                                                     |
| Desktop shell state: window zoom, theme, WebCrypto master key | The app config directory (`~/Library/Application Support/ai.localix.tauri` on macOS) | Plain files owned by the desktop shell, not the API. On macOS 15 and later the 16-byte key that wraps the `CryptoKey` objects websites store in the built-in browser lives in `webcrypto-master-key` with owner-only permissions, instead of the login keychain, so the browser never asks for the keychain password. |
| API and desktop boot logs                                     | Beside the database and in the operating-system temporary directory                  | Logs can contain diagnostics; the API log file is created with owner-only permissions.                                                                                                                                                                                                                                |

Project files stay in the directories you select. Generated artifacts create additional files;
opening a project does not copy it into the database.

## Configuration

| Setting                   | Effect                                                     | Boundary                                                                                          |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `LOCALIX_DB_FILE`         | Changes the SQLite file and database-adjacent blob root.   | It does not move the vault, MCP OAuth store, or other machine-level state.                        |
| `LOCALIX_DAEMON_LOG`      | Changes the API runtime log path.                          | The destination can contain startup and runtime diagnostics.                                      |
| `~/.localix/wire-dump.on` | Enables model-wire dumps under `~/.localix/tmp/wire-dump`. | Dumps contain previews from the model-facing message list; this is an explicit diagnostic switch. |

Use the [secrets guide](../features/secrets.md) for vault references and rotation. Use the
[sessions guide](../features/sessions-and-projects.md) for the redacted export format.

## Limits

- Local storage is not the same as operating-system isolation. A process running as the same user
  can read the database, the vault master key, and the browser's WebCrypto master key.
- On macOS 13 and 14 WebKit keeps the browser's WebCrypto master key in the login keychain. The
  signed release reads it without a prompt; an unsigned or ad-hoc build can be asked for the
  keychain password.
- Vault encryption protects stored values from casual plaintext inspection. It cannot protect a
  value after an enabled consumer resolves and sends it.
- The SQLite transcript and most product configuration are not encrypted by Localix.
- Plugin backend code is trusted native code in the API process. Localix does not centrally inspect
  or constrain every destination it can contact.
- Provider, MCP, plugin, Git, package-registry, and fetched-URL retention is outside Localix.
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
- [SQLite permissions and adjacent storage](https://github.com/rsaryev/localix/blob/main/apps/api/src/db/connection.ts)
- [Vault cipher](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/cipher.ts)
- [Vault master key](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/secrets/master-key.ts)
- [MCP OAuth storage](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/oauth/store.ts)
- [Browser WebCrypto master key](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/webcrypto_key.rs)
- [Desktop shell preferences](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/prefs.rs)
- [Native plugin trust boundary](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/native.ts)
- [API log location](https://github.com/rsaryev/localix/blob/main/apps/api/src/index.ts)
- [Model-wire dump switch](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/wire-dump.ts)
- [Desktop update cadence](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/hooks/useDesktopUpdate.ts)
- [Updater endpoint and bundle configuration](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/tauri.conf.json)
