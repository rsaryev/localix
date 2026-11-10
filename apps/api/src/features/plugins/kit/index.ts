/**
 * The plugin kit boundary: the only folder that imports `@rsaryev/llx-plugin` (rule X7,
 * `docs/internals/plugins-and-mini-apps.md`). Everything Localix knows about the Claude Code
 * plugin format and its semantics comes from the kit through this file; the rest of the API calls
 * what it exports, never the kit itself. In-memory ports for other features' tests are in
 * `./testing`.
 */
export { createHostPorts, type HostPortsDeps, type LocalixKitPorts } from './ports/host-ports'
export type { McpCallByName, ModelBackend } from './ports/session-ports'
