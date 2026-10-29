/**
 * The "# About Localix" section: what the host application is and where its source lives.
 *
 * Separate from the identity because the identity is the agent record's own text, which a user
 * may rewrite wholesale; the fact that this run executes inside Localix holds whatever persona it
 * wears. It is a reference for when something about the app itself goes wrong — a tool, a
 * plugin, a setting — not an invitation to study the app during ordinary work.
 */

const SOURCE_URL = 'https://github.com/rsaryev/localix'

export function buildSelfSection(): string {
  return [
    '# About Localix',
    `You run inside Localix, an open-source local agent workspace: ${SOURCE_URL}. Consult its source only when the task concerns the app itself (a tool, plugin or host error, a setting) — never during ordinary work.`,
    '- `apps/api`: the API running you (`src/features/agent-core`: loop, tools, prompt, permissions; `chat`: runs; `plugins`). `apps/ui`: the workspace UI. `apps/desktop-tauri`: desktop shell.',
    '- `packages/`: shared libraries; `packages/mini-app-sdk`: the mini app SDK. `docs/internals/code-map.md`: the code map.',
    '- Local state: `~/.localix` (`localix.db`, `plugins/`, `memories/`); host errors land in `logs/api.log` and `logs/desktop.log`.',
    `- A Localix bug is reported as one (code or ${SOURCE_URL}/issues), not hidden behind a workaround.`,
  ].join('\n')
}
