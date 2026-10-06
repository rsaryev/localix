/* oxlint-disable no-control-regex -- match complete VT reports emitted by a terminal emulator */

/**
 * xterm's onData forwards both human input and automatic replies to the app's VT queries.
 * Focus reports, cursor positions and capability/color replies must still reach the PTY,
 * but do not represent a person interacting with it. Match complete known replies only;
 * a mixed frame containing typed text, Enter, navigation or mouse input stays activity.
 */
const TERMINAL_REPORT =
  /\x1b\[(?:\??\d+;\d+R|[?>][\d;]*c|\??\d+n|[IO])|\x1b\](?:4;\d+|1[0-9]);rgb:[\da-f]+\/[\da-f]+\/[\da-f]+(?:\x07|\x1b\\)/gi

export function hasUserInput(data: string): boolean {
  return data.replace(TERMINAL_REPORT, '').length > 0
}
