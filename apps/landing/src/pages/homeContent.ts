import type { SectionItem } from '@/components/SectionNav'
import type { FeatureRow } from './homeContentTypes'

export type { FeatureRow, PluginShowcase } from './homeContentTypes'
export * from './homeBundledPlugins'
export * from './homeContentPlatform'
export * from './homeContentExternal'

export const SECTIONS: SectionItem[] = [
  { id: 'intro', label: 'Localix' },
  { id: 'conversations', label: 'Agents together' },
  { id: 'context', label: 'Connected context' },
  { id: 'external', label: 'External agents' },
  { id: 'space', label: 'Project Space' },
  { id: 'browser', label: 'Agent browser' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'craft', label: 'Design' },
  { id: 'autonomy', label: 'Long-running work' },
  { id: 'control', label: 'Models and control' },
  { id: 'board', label: 'Kanban board' },
]

export const SECTION_GUIDES = {
  conversations: { slug: 'features--conversations', label: 'Explore conversations with agents' },
  context: { slug: 'features--workspace', label: 'Explore workspace and context' },
  external: { slug: 'features--external-agents', label: 'Explore external agent sessions' },
  space: { slug: 'features--project-space', label: 'Explore Project Space' },
  browser: {
    slug: 'features--visual-feedback',
    label: 'Explore the agent browser and Visual Feedback',
  },
  plugins: { slug: 'extending--plugins', label: 'Explore the plugin system' },
  craft: { slug: 'extending--ui-kit', label: 'Explore the design kit' },
  autonomy: { slug: 'features--loops', label: 'Explore loops and monitors' },
  control: { slug: 'features--capabilities', label: 'Explore capabilities and permissions' },
  board: { slug: 'features--task-board', label: 'Explore the Kanban board' },
} as const

/**
 * The homepage opens on several agents in one conversation, then the surfaces they share with
 * you: connected context, the Project Space board, and the agent-driven preview. After those come
 * the platform that builds the rest, the design that holds it together, and the work that runs
 * while you are away (`homeContentPlatform.ts`). Every statement stays inside what its owning guide
 * documents. None states a speed, a duration, or a team size, because the repository measures none
 * of them, and none promises a permission MODE per participant: the mode belongs to the whole
 * conversation, while rules, role, and model belong to each agent.
 */
export const CONVERSATION_FEATURES: FeatureRow[] = [
  {
    kicker: 'Add agents as you go',
    title: 'One conversation, as many agents as the work needs',
    body: 'Add a participant from the composer, address one with @handle or everyone with @all, and remove one with a button. The session, its title, and its transcript carry on unchanged.',
    slug: 'features--conversations',
    anchor: 'changing-participants',
  },
  {
    kicker: 'Agents invite agents',
    title: 'Let the agent bring in a colleague',
    body: 'An agent can invite an installed agent and hand over the turn. Your next message outranks a handoff chain, and a chain stops after 12 handoffs without you.',
    slug: 'features--conversations',
    anchor: 'passing-work-between-agents',
  },
  {
    kicker: 'A role for each',
    title: 'Give each agent its own role, rules, and model',
    body: 'Start from shipped roles such as lead, backend, frontend, design, qa, and devops, or define your own. Each agent keeps its own ordered allow, ask, and deny rules and its own model.',
    slug: 'features--capabilities',
    anchor: 'what-you-can-do',
  },
  {
    kicker: 'You stay in charge',
    title: 'See who is answering, and stop it',
    body: 'The strip shows who is answering and who is next in line. Approvals are asked of you and a denial stays denied in every mode. Lock the participants before the first message, or stop the run at any moment.',
    slug: 'features--conversations',
    anchor: 'fixing-the-participants',
  },
]

export const CONTEXT_FEATURES: FeatureRow[] = [
  {
    kicker: 'Visible context',
    title: 'Know what the next message carries',
    body: 'Open tabs, selections, and the caret line with its current errors join as dismissible chips. Link files, diffs, sessions, terminals, and plugin resources, and see each item’s estimated size before you send.',
    slug: 'features--workspace',
    anchor: 'explicit-and-automatic-context',
  },
  {
    kicker: 'Addressable resources',
    title: 'Open, search, link, and return',
    body: 'Localix resource links connect search results, agent actions, composer context, and workbench tabs so the same database object, task, file, or live resource resolves to the same place.',
    slug: 'features--workspace',
    anchor: 'addressable-resource-links',
  },
  {
    kicker: 'Long sessions',
    title: 'Keep a long session inside the request budget',
    body: 'Near the end of the window, older turns fold into short cards by fixed rules, with no model call and no rewritten history. Pinned messages stay whole, and trimmed tool output stays one recall away.',
    slug: 'features--context-checkpoints',
    anchor: 'request-budget',
  },
  {
    kicker: 'Integrated terminal',
    title: 'Turn command output into a working surface',
    body: 'Persistent PTY terminals keep scrollback, recognize file and URL links, surface command outcomes, and protect multiline paste.',
    slug: 'features--workspace',
    anchor: 'terminal-as-a-working-surface',
  },
]

export const SPACE_FEATURES: FeatureRow[] = [
  {
    kicker: 'One board, two editors',
    title: 'The agent works the board the way you do',
    body: 'The agent reads and edits the board with the same operations as the toolbar, align and arrange included. Its changes glow on screen, and a count shows what happened off screen.',
    slug: 'features--project-space',
    anchor: 'what-you-can-do',
  },
  {
    kicker: 'Live cards',
    title: 'References, not copies',
    body: 'Files, folders, images, and PDFs sit on the board as cards that re-read the file when it changes. Drop a session, message, terminal, or tool call and it lands as a card with Open.',
    slug: 'features--project-space',
    anchor: 'app-links',
  },
  {
    kicker: 'From chat to board',
    title: 'Keep an answer where you can see it',
    body: 'Send part of a chat answer to the board and its trees, steps, and pros and cons stay rendered there. Paste Mermaid, a screenshot, a URL, or a code block and it becomes an element.',
    slug: 'features--project-space',
    anchor: 'what-you-can-do',
  },
  {
    kicker: 'Plain file',
    title: 'A board your repository can hold',
    body: 'The board is one file under .localix/project-space, so it can be committed and reviewed with the project. The store re-reads the file before every write, so a hand edit is not overwritten.',
    slug: 'features--project-space',
    anchor: 'how-it-works',
  },
]

export const BROWSER_FEATURES: FeatureRow[] = [
  {
    kicker: 'Compact pages',
    title: 'Read a page as a tree, not a screenshot',
    body: 'The agent gets an indented text tree with a ref for every element, capped at 800 nodes, instead of raw HTML or a new screenshot after each step.',
    slug: 'features--visual-feedback',
    anchor: 'let-the-agent-drive-the-preview',
  },
  {
    kicker: 'Batched actions',
    title: 'Act in batches that settle once',
    body: 'Clicks, typing, key presses, and scrolls run as one validated batch and return a short diff of what changed. A stale ref is found again by selector, then by role and name.',
    slug: 'features--visual-feedback',
    anchor: 'let-the-agent-drive-the-preview',
  },
  {
    kicker: 'Check the result',
    title: 'Verify before it says done',
    body: 'The agent reads console errors, screenshots the page or one element, and resizes the frame to a CSS viewport, in the same preview you are looking at.',
    slug: 'features--visual-feedback',
    anchor: 'resize-through-the-agent-tool',
  },
  {
    kicker: 'Visual Feedback',
    title: 'Point at the result instead of describing it',
    body: 'Pick an element, a region, or several, and attach the screenshot, selector, styles, and the source location where the page exposes one. It works in a Localix preview with the probe connected.',
    slug: 'features--visual-feedback',
    anchor: 'capture-and-source-resolution',
  },
]
