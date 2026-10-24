/**
 * `$.ui.copy`: the text on the machine's clipboard, through the platform's own copy command, as
 * Claude Code answers it: `{ isCopied: true }`, or `{ isCopied: false, reason: 'no-clipboard' }`
 * where the machine has none Localix can reach.
 */

const COPY_COMMANDS: Record<string, string[][]> = {
  darwin: [['pbcopy']],
  win32: [['clip']],
  linux: [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']],
}

export async function copyToClipboard(
  text: string,
  platform: string = process.platform,
): Promise<{ isCopied: true } | { isCopied: false; reason: 'no-clipboard' }> {
  for (const argv of COPY_COMMANDS[platform] ?? []) {
    try {
      const proc = Bun.spawn(argv, { stdin: new Blob([text]), stdout: 'ignore', stderr: 'ignore' })
      if ((await proc.exited) === 0) return { isCopied: true }
    } catch {
      // Not installed here: the next command, or none.
    }
  }
  return { isCopied: false, reason: 'no-clipboard' }
}
