/**
 * The Claude Code commands a person may copy from its documentation that Localix cannot run, each
 * with the reason and, where one exists, what to do in Localix instead.
 *
 * This is NOT part of the catalog: a name here is not reserved, so a plugin, a skill or a command
 * of yours called `/review` or `/debug` still runs. It is read last, by the gate that would
 * otherwise answer "unknown command" (`service/command-handlers.ts`).
 */

const SKILL =
  'is a Claude Code bundled skill. Localix does not ship it; install a plugin or add a skill that provides it'

const NO_ACCOUNT =
  'signs in to an Anthropic account, which Localix does not use: it connects to model providers'

const NO_TERMINAL = 'configures the Claude Code terminal, and Localix is not a terminal'

const CLOUD = 'is a Claude Code cloud feature that Localix does not have'

/** Names that share one explanation. The first is the one the reply shows. */
const GAPS: readonly { names: readonly string[]; reply: string }[] = [
  {
    names: ['login', 'logout'],
    reply: `\`/{name}\` ${NO_ACCOUNT}. Add or remove a provider in Settings → Models.`,
  },
  {
    names: ['upgrade', 'usage-credits', 'rate-limit-options', 'privacy-settings', 'passes'],
    reply:
      '`/{name}` manages a Claude subscription, which Localix has none of. `/usage` shows what this chat cost.',
  },
  {
    names: ['vim'],
    reply:
      '`/vim` was removed from Claude Code. Localix’s editors have their own key bindings in Settings → Shortcuts.',
  },
  {
    names: ['terminal-setup', 'tui', 'scroll-speed', 'focus'],
    reply: `\`/{name}\` ${NO_TERMINAL}.`,
  },
  {
    names: ['keybindings'],
    reply:
      '`/keybindings` opens a Claude Code file. Localix’s shortcuts are in Settings → Shortcuts.',
  },
  {
    names: ['voice'],
    reply: '`/voice` is Claude Code’s voice dictation. Localix has no voice input.',
  },
  {
    names: ['ide'],
    reply:
      '`/ide` connects Claude Code to an editor. Localix is the editor: files open in its own workspace.',
  },
  {
    names: ['chrome'],
    reply:
      '`/chrome` configures Claude in Chrome. Localix drives a browser with its own browser tools.',
  },
  {
    names: ['sandbox'],
    reply:
      '`/sandbox` toggles Claude Code’s operating-system sandbox. Localix has none; permissions and Settings → Permissions guard each call.',
  },
  {
    names: [
      'desktop',
      'mobile',
      'remote-control',
      'remote-env',
      'teleport',
      'web-setup',
      'schedule',
      'autofix-pr',
      'ultrareview',
      'background',
    ],
    reply: `\`/{name}\` ${CLOUD}. Localix runs on this computer; \`/loop\` repeats a task on a schedule.`,
  },
  {
    names: ['install-github-app', 'install-slack-app', 'setup-bedrock', 'setup-vertex'],
    reply:
      '`/{name}` sets up a Claude Code service connection. Localix connects to a provider in Settings → Models.',
  },
  {
    names: ['bug', 'feedback'],
    reply:
      '`/{name}` sends a report from Claude Code. Report a Localix problem at https://github.com/rsaryev/localix/issues.',
  },
  {
    names: ['release-notes'],
    reply:
      '`/release-notes` shows Claude Code’s changelog. Localix shows what is new in its update dialog and in `CHANGELOG.md`.',
  },
  {
    names: ['exit', 'quit'],
    reply:
      '`/{name}` ends a terminal session. Close the window or quit the app; running sessions end with it.',
  },
  {
    names: ['tasks', 'bashes'],
    reply: '`/{name}` lists background work. Localix shows it in the strip above the message box.',
  },
  {
    names: ['branch'],
    reply: '`/branch` copies the conversation into a new chat: that is `/fork` in Localix.',
  },
  {
    names: ['checkpoint', 'undo'],
    reply: '`/{name}` rolls the conversation back: that is `/rewind` in Localix.',
  },
  {
    names: ['autocompact'],
    reply:
      '`/autocompact` sets how full the context gets before it is compacted. Localix keeps a context limit per model: Model details → Context limit.',
  },
  {
    names: ['statusline'],
    reply:
      '`/statusline` writes the `statusLine` setting of Claude Code. Localix reads the same setting from your settings file, so edit it there.',
  },
  {
    names: ['color', 'stickers', 'radio', 'powerup', 'heapdump', 'insights', 'team-onboarding'],
    reply: '`/{name}` is specific to the Claude Code terminal app, and Localix has no equivalent.',
  },
  {
    names: ['pr-comments', 'ultraplan'],
    reply: '`/{name}` was removed from Claude Code. Ask the agent directly instead.',
  },
  {
    names: [
      'code-review',
      'review',
      'security-review',
      'simplify',
      'batch',
      'debug',
      'doctor',
      'run',
      'verify',
      'dataviz',
      'update-config',
      'fewer-permission-prompts',
      'skill-doctor',
      'claude-api',
      'deep-research',
      'workflows',
    ],
    reply: `\`/{name}\` ${SKILL}.`,
  },
]

/** The reply to a Claude Code command Localix cannot run, or undefined for any other name. */
export function claudeCodeGapReply(name: string): string | undefined {
  const word = name.trim().replace(/^\/+/, '').toLowerCase()
  const gap = GAPS.find((entry) => entry.names.includes(word))
  return gap?.reply.replaceAll('{name}', word)
}
