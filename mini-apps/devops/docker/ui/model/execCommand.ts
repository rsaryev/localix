import { spawnInTerminal } from './terminalSpawn'
import { shellQuote } from '@localixai/mini-app-sdk/ui/utilities'

/**
 * Build the shell command that opens an interactive session inside a container.
 * Runs `docker exec -it` and prefers `bash` when the image has it, falling back to
 * `sh` (Alpine and other minimal images ship only `sh`). The returned string is
 * handed verbatim to a PTY that itself runs `sh -lc '<command>'`, so the inner
 * shell selection uses double quotes to nest cleanly inside that single argument.
 *
 * The id is shell-quoted. Today's callers pass a Docker hex id, so nothing can break
 * out — but that is the CALLER's good manners, not this function's contract, and the
 * signature takes any string. `dockerManifestCommands` in this same folder already
 * quotes for exactly this reason.
 */
export function buildExecCommand(containerId: string): string {
  return `docker exec -it ${shellQuote(containerId)} sh -c "command -v bash >/dev/null 2>&1 && exec bash || exec sh"`
}

/** Open an interactive `docker exec` shell for a container in `sessionId`'s terminal. */
export async function execIntoContainer(
  sessionId: string,
  containerId: string,
  name: string,
): Promise<void> {
  await spawnInTerminal(sessionId, buildExecCommand(containerId), `exec: ${name}`)
}
