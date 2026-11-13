import type { Card, LandingContent, Media } from '@/shared/config';

// The landing's words. The design is the template's; this file is the site's. The words of each
// card come from the docs it links to; the stills are the app's own window on the screen, with the
// desktop around it, all of one size, as Localix Terminal's site shows its own.
const DOCS = '/docs';
const GITHUB = 'https://github.com/localixai/localix-studio';
const SOURCE = `${DOCS}/getting-started--installation#how-it-works`;

/** The window's stills, all of one size: what each shows, in words. */
const SHOT = { width: 1720, height: 1134 };
const SHOTS = {
  models:
    'The model picker: this chat’s model and background workloads, the providers, an API key form and the chosen model’s context, pricing and capabilities',
  workspace: 'The workspace: the project’s chats on the left, the page the agent built in the Browser, and the chat on the right',
  editor:
    'A TypeScript file in the editor: the language server’s completion list after channel., offering the object’s properties and methods, under the symbol breadcrumb, with the chat beside it',
  subagents: 'Two subagents started from a chat: one still running, one done, each with what it was asked and what it answered',
  store: 'The Store searching for git: commands, screens and MCP servers found inside packages, with the packages below',
  'mini-apps': 'A mini app in Localix, a task board: the add-task bar, filters, progress and the columns of task cards',
};
const shot = (name: keyof typeof SHOTS): Media => ({ kind: 'image', src: `/shots/${name}.jpg`, alt: SHOTS[name], ...SHOT });

// From the agent and its controls, through what it can be given (the Store, Claude Code's
// plugins), to the mini app platform and what a mini app becomes on a Mac.
const CARDS: Card[] = [
  {
    title: 'Any model, or one on your computer',
    text: 'Sign in or paste an API key, then pick the model for each chat and for background work like titles and recaps. A local model keeps what you send on this computer. With OpenRouter connected, quick choices such as the browser’s next click go to a small, fast decision model instead of the chat’s model, with a fallback when it has no answer.',
    links: [
      { href: `${DOCS}/features--local-models`, label: 'Local models' },
      { href: `${DOCS}/features--decision-models`, label: 'Decision models' },
    ],
    media: shot('models'),
  },
  {
    title: 'Terminals and browser in one window',
    text: 'The agent works inside your project folder, with its files, terminals and Git, and you work next to it in the same window. It can open the page it builds in the Browser, beside you. Link Claude Code, Codex, Gemini CLI or another installed coding agent to a chat, and its terminal opens beside the conversation.',
    links: [{ href: `${DOCS}/features--workspace`, label: 'The workspace' }],
    media: shot('workspace'),
  },
  {
    title: 'An editor that knows your code',
    text: 'Files open in a full code editor, with completion, hover, parameter hints, errors underlined as you type, go to definition and rename across files. Language servers install themselves, for the languages Localix supports, the first time you open one of their files. Predicting your next edit is optional: it is off by default and uses model usage.',
    links: [
      { href: `${DOCS}/features--editor`, label: 'The editor' },
      { href: `${DOCS}/features--lsp`, label: 'Language servers' },
    ],
    media: shot('editor'),
  },
  {
    title: 'Subagents in parallel',
    text: 'The agent hands a self-contained task to a subagent, a session of its own that works while the agent goes on and answers back when it is done. Each one shows what it was asked and what it answered, and sits under its chat in the sidebar, where you can open it and talk to it directly.',
    links: [{ href: `${DOCS}/features--delegation`, label: 'Subagents' }],
    media: shot('subagents'),
  },
  {
    title: 'The Store',
    text: 'Find, install and update mini apps, plugins, skills, agents and MCP servers in one tab, from the Localix marketplace, Localix Community, Anthropic’s marketplaces and any you add under Sources. Search matches by meaning and reaches inside packages. A plugin lists what it adds and what runs on your computer before you say yes. Most of what you wrote for Claude Code loads as it is, with no conversion.',
    links: [
      { href: `${DOCS}/features--store`, label: 'The Store' },
      { href: `${DOCS}/extending--claude-code-plugins`, label: 'Claude Code plugins' },
    ],
    media: shot('store'),
  },
  {
    title: 'Mini apps, with the agent inside',
    text: 'A mini app is an application inside Localix: a screen, tools the agent can call and a guide for using them. Localix’s own mini apps are in the Localix marketplace and install from the Store like any other. Describe one to the agent, with the authoring plugin from the marketplace, and it writes, checks and installs it; through the host it gets decision models, embeddings and search. On macOS it also installs as a Mac app, in the Dock, Cmd+Tab and Spotlight.',
    links: [
      { href: `${DOCS}/features--mini-apps`, label: 'Mini apps' },
      { href: `${DOCS}/extending--mini-apps`, label: 'Build a mini app' },
      { href: `${DOCS}/features--mini-app-mac-apps`, label: 'Mac apps' },
      { href: 'https://github.com/localixai/localix-marketplace', label: 'Localix marketplace' },
    ],
    media: shot('mini-apps'),
  },
];

const landing: LandingContent = {
  hero: {
    title: { rest: 'The Agentic Development Environment' },
    lede: 'An AI agent and its subagents work with you in one desktop app: your editor, terminals and browser. Any model, or run one on your own computer.',
    under: `Open source, MIT license. On other systems, [build it from source](${SOURCE}).`,
    links: [{ label: 'Get started', href: `${DOCS}/getting-started--installation` }],
    tour: {
      label: 'The app’s window on a project, in four stills',
      ...SHOT,
      scenes: [
        { label: 'Workspace', src: '/shots/workspace.jpg', alt: SHOTS.workspace },
        { label: 'Editor', src: '/shots/editor.jpg', alt: SHOTS.editor },
        { label: 'Subagents', src: '/shots/subagents.jpg', alt: SHOTS.subagents },
        { label: 'Mini apps', src: '/shots/mini-apps.jpg', alt: SHOTS['mini-apps'] },
      ],
    },
  },
  loop: {
    title: 'Inside the app',
    aside: 'One desktop app for you and your agents',
    cards: CARDS,
  },
  // 83 pages in nine groups: a column shows its first five.
  docs: { title: 'Documentation', limit: 5 },
  releases: { title: 'Releases', more: { label: 'Full changelog', href: `${GITHUB}/blob/main/CHANGELOG.md` } },
  closing: {
    title: 'Set up Localix',
    aside: 'Free · MIT license',
    steps: [
      { title: 'Download', text: `The app for Macs with Apple silicon. On other systems, [build it from source](${SOURCE}).` },
      { title: 'Connect a model', text: 'In the model picker under the chat, sign in or paste an API key, or pick a model that runs on your computer.' },
      { title: 'Open a folder', text: 'Add a project folder and say what you want done. The agent works in it, next to you.' },
    ],
    links: [
      { label: 'Get started', href: `${DOCS}/getting-started--first-session` },
      { label: 'Source on GitHub', href: GITHUB },
    ],
  },
};

export default landing;
