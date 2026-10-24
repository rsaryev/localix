/**
 * Environment names Claude Code treats as credentials when they would travel toward a remote
 * MCP server: in a server's `url` and `headers` they read as empty, set or not, and a
 * `:-default` on them is ignored (mcp.md, "Credential variables that read as empty"). A stdio
 * server is local, so its `command`, `args` and `env` still expand them.
 *
 * One predicate for every MCP config Localix expands — a person's own servers and a plugin's.
 */
const CREDENTIAL_NAME =
  /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH/i

export function isCredentialEnvName(name: string): boolean {
  return CREDENTIAL_NAME.test(name)
}
