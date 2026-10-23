# `@localixai/uri`

This package is internal to the Localix workspace. It owns the `localix://` address grammar: UI
destinations, resources, settings anchors and the addresses of capabilities (skills, plugins, mini
apps, MCP servers, agents).

## Consumers

The API, the UI, the mini app SDK (which re-exports it as `@localixai/mini-app-sdk/navigation` for
mini apps) and the plugins feature. It belongs to neither plugins nor mini apps, so both can name an
address without knowing the other (rule X1, `docs/internals/plugins-and-mini-apps.md`).

## Entry points

| Entry point      | Contract                                                                   |
| ---------------- | -------------------------------------------------------------------------- |
| `@localixai/uri` | Parse and build `localix://` URIs; settings anchors; capability addresses. |

## Limits

Pure string functions with no dependencies: it never resolves an address to what it opens. The UI's
navigation host and the API's resource readers do that.
