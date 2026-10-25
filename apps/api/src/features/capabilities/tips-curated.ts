import type { ComposerTip } from './contracts'
import { insertAction, settingsAction, storeAction, vaultAction } from './tips-actions'

/**
 * The hand-written half of the composer tip pool: what the PRODUCT can do, stated
 * once, next to the capability that makes each statement true.
 *
 * Each entry names the capability it talks about instead of assuming it. A tip about
 * background commands is a lie in a scope where `bash` is denied, and the client has
 * no way to tell: it sees a sentence, not a tool roster. So the gate lives here, next
 * to the sentence it qualifies, and `composerTips` drops the entry before it ships.
 *
 * Tips about the live SESSION rather than the workspace live in `tips-session.ts` —
 * same shape, different question, so neither file grows into a pile.
 *
 * Text stays one calm sentence — this band appears while someone is waiting, not
 * while they are reading.
 */
export interface CuratedTip extends ComposerTip {
  /**
   * Ship only when at least one of these tools is in the scope's enabled surface.
   * Absent = the tip is about the product itself and always applies.
   */
  requiresAnyTool?: readonly string[]
}

/** The tools that write to files — what "review every diff" is about. */
const EDIT_TOOLS = ['write', 'edit'] as const

/**
 * Which BUILT-IN slash commands are worth teaching during a wait.
 *
 * ONLY the editorial decision lives here; the command's name and description do NOT —
 * those come from `SLASH_COMMANDS`, the catalog the parser and the composer menu
 * already share, so a reworded command rewords its tip and a removed one removes it.
 * A name here that the catalog does not have produces no tip and is therefore dead
 * weight, so `tips.test.ts` fails on one rather than letting it sit.
 *
 * Absent on purpose: `/help` (meta), and `/skills`, `/mcp`, `/plugin`, whose subject is already
 * covered by tips generated from those catalogs — and covered better, because those
 * name the user's own skills and plugins instead of a list command.
 */
export const TEACHABLE_COMMANDS: readonly string[] = [
  'loop',
  'fork',
  'open',
  'usage',
  'memory',
  'model',
]

export const CURATED_TIPS: readonly CuratedTip[] = [
  // ── About the tool that is streaming right now ────────────────────────────
  {
    id: 'bash-background',
    text: 'A long command can run in the background — it keeps streaming in the runtime panel.',
    requiresAnyTool: ['bash'],
    when: { tools: ['bash'] },
    actions: [insertAction('Run that in the background and keep going.', 'Ask for background')],
  },
  {
    id: 'inspector-diffs',
    text: 'The agent is editing files — the Inspector panel shows every diff as it lands.',
    requiresAnyTool: EDIT_TOOLS,
    when: { tools: [...EDIT_TOOLS] },
  },
  {
    id: 'edit-undo',
    text: 'Any edit can be reverted from the file it landed in — nothing here is one-way.',
    requiresAnyTool: EDIT_TOOLS,
    when: { tools: [...EDIT_TOOLS] },
  },
  {
    id: 'jobs-panel',
    text: 'Background jobs keep running between turns — ask for their status at any time.',
    requiresAnyTool: ['jobs'],
    when: { tools: ['bash', 'jobs'] },
  },
  {
    id: 'search-scope',
    text: 'Point the agent at a directory and its search narrows to it — fewer files, better answers.',
    requiresAnyTool: ['search'],
    when: { tools: ['search'] },
  },
  {
    id: 'research-sources',
    text: 'Research answers carry their sources — open one to check what the agent read.',
    requiresAnyTool: ['research'],
    when: { tools: ['research'] },
  },
  // ── About what the user asked for ─────────────────────────────────────────
  {
    id: 'live-preview',
    text: 'The agent can open a live preview and click through the app to check its own work.',
    requiresAnyTool: ['browser'],
    when: { textPattern: '\\b(html|css|tailwind|frontend|landing|layout|page|button|form)\\w*' },
    actions: [insertAction('Open a preview and verify it yourself.', 'Ask to verify')],
  },
  {
    id: 'research-current',
    text: 'Ask the agent to research a library before it writes — it reads current sources, not memory.',
    requiresAnyTool: ['research'],
    when: { textPattern: '\\b(library|framework|sdk|docs|documentation|version|upgrade)\\w*' },
  },
  {
    id: 'test-the-fix',
    text: 'Ask for the test that would have caught it — a fix with no test is a fix you re-make.',
    requiresAnyTool: ['bash'],
    when: { textPattern: '\\b(bug|broken|crash|fails?|failing|regression|error)\\w*' },
  },
  {
    id: 'secrets-stay-out',
    text: 'Keep tokens in the vault instead of the chat — the agent uses them without reading them.',
    requiresAnyTool: ['vault'],
    when: { textPattern: '\\b(token|secret|password|api[_-]?key|credential)\\w*' },
    actions: [vaultAction('Open Vault')],
  },
  // ── The product itself ────────────────────────────────────────────────────
  {
    id: 'queue-while-running',
    text: 'You can queue your next message while the agent works — type and press Enter.',
  },
  {
    id: 'branch-edit',
    text: 'Edit any of your past messages to fork the conversation into a new branch.',
  },
  {
    id: 'reasoning-effort',
    text: 'Hard problem? Raise the reasoning effort in the composer for deeper thinking.',
  },
  {
    id: 'drag-files-in',
    text: 'Drop a file on the composer to attach it — documents, images and PDFs all read.',
  },
  {
    id: 'memory-remember',
    text: 'Tell the agent to remember a preference — it persists into later sessions.',
    requiresAnyTool: ['memory'],
    actions: [insertAction('Remember this for next time: ', 'Teach it something')],
  },
  {
    id: 'recurring-runs',
    text: 'Anything you repeat can be put on a schedule — ask for it to run every morning.',
    requiresAnyTool: ['loops'],
  },
  {
    id: 'vault-secrets',
    text: 'Keep tokens in the vault — the agent uses them without ever reading the value.',
    requiresAnyTool: ['vault'],
    actions: [vaultAction('Open Vault')],
  },
  {
    id: 'agent-rules',
    text: 'Each agent carries its own rules — narrow what one may touch without touching the others.',
    actions: [settingsAction('permissions', 'Open Permissions')],
  },
  {
    id: 'tools-surface',
    text: 'Turning a tool off removes it from the roster the model sees — not just from the menu.',
    actions: [storeAction('agent', 'Open Agents')],
  },
]
