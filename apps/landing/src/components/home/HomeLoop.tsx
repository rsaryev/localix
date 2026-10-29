import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { type Capture, Shot } from './Shots'
import './loop.css'

interface Card {
  title: string
  text: string
  /** What the app looks like: the whole window, captured for the homepage. */
  capture: Capture
  /** The docs pages that say more, as slugs. */
  docs: { slug: string; label: string }[]
  /** A page outside the docs that the card also points to. */
  external?: { href: string; label: string }
}

/**
 * What each step looks like in the app: one real capture per card, all the same window size, and
 * opened larger on a click. The words come from the docs each card links to. From the agent and its
 * controls, through what it can be given (the Store, Claude Code's plugins), to the mini app
 * platform and what a mini app becomes on a Mac.
 */
const CARDS: Card[] = [
  {
    title: 'Any model, or one on your computer',
    text: 'Sign in or paste an API key, then pick the model for each chat and for background work like titles and recaps. A local model keeps what you send on this computer. A decision model answers a typed question instead of writing text: the browser’s next click, a game’s move, a mini app’s small choices, with the caller’s own fallback when it has no answer.',
    capture: {
      name: 'models',
      alt: 'The model picker: this chat’s model and background workloads, the providers, an API key form and the chosen model’s context, pricing and capabilities',
    },
    docs: [
      { slug: 'features--local-models', label: 'Local models' },
      { slug: 'features--decision-models', label: 'Decision models' },
    ],
  },
  {
    title: 'Editor, terminals and browser in one window',
    text: 'The agent works inside your project folder, with its files, terminals and Git, and you work next to it in the same window. It can open the page it builds in the Browser, beside you. Link Claude Code, Codex, Gemini CLI or another installed coding agent to a chat, and its terminal opens beside the conversation.',
    capture: {
      name: 'workspace',
      alt: 'The workspace: the project’s chats on the left, the page the agent built in the Browser, and the chat on the right',
    },
    docs: [{ slug: 'features--workspace', label: 'The workspace' }],
  },
  {
    title: 'Subagents in parallel',
    text: 'The agent hands a self-contained task to a subagent, a session of its own that works while the agent goes on and answers back when it is done. Each one shows what it was asked and what it answered, and sits under its chat in the sidebar, where you can open it and talk to it directly.',
    capture: {
      name: 'subagents',
      alt: 'Two subagents started from a chat: one still running, one done, each with what it was asked and what it answered',
    },
    docs: [{ slug: 'features--delegation', label: 'Subagents' }],
  },
  {
    title: 'The Store',
    text: 'Find, install and update mini apps, plugins, skills, agents and MCP servers in one tab, from Localix’s own sources and Anthropic’s marketplaces. Search matches by meaning and reaches inside packages. A plugin lists what it adds and what runs on your computer before you say yes. Everything written for Claude Code loads as it is, with no conversion.',
    capture: {
      name: 'store',
      alt: 'The Store searching for git: commands, screens and MCP servers found inside packages, with the packages below',
    },
    docs: [
      { slug: 'features--store', label: 'The Store' },
      { slug: 'extending--claude-code-plugins', label: 'Claude Code plugins' },
    ],
  },
  {
    title: 'Mini apps, with the agent inside',
    text: 'A mini app is an application inside Localix: a screen, tools the agent can call and a guide for using them. Localix’s own mini apps are in the Localix marketplace and install from the Store like any other. Describe one to the agent, with the authoring plugin from the marketplace, and it writes, checks and installs it; through the host it gets decision models, embeddings and search. On macOS it also installs as a Mac app, in the Dock, Cmd+Tab and Spotlight.',
    capture: {
      name: 'mini-apps',
      alt: 'A mini app in Localix, a task board: the add-task bar, filters, progress and the columns of task cards',
    },
    docs: [
      { slug: 'features--mini-apps', label: 'Mini apps' },
      { slug: 'extending--mini-apps', label: 'Build a mini app' },
      { slug: 'features--mini-app-mac-apps', label: 'Mac apps' },
    ],
    external: {
      href: 'https://github.com/rsaryev/localix-marketplace',
      label: 'Localix marketplace',
    },
  },
]

/** The app, step by step, as on llx.sh: each card held at the top while the next slides over it. */
export function HomeLoop() {
  return (
    <section className="loop home-shell" aria-labelledby="loop-title">
      <h2 id="loop-title">One app, the whole loop</h2>
      <div className="loop-stack">
        {CARDS.map((card, index) => (
          <article key={card.title} className="loop-card" style={{ '--n': index } as CSSProperties}>
            <div className="loop-text">
              <h3>{card.title}</h3>
              <p>{card.text}</p>
              <div className="loop-links">
                {card.docs.map((doc) => (
                  <Link key={doc.slug} className="loop-link" to={`/docs/${doc.slug}`}>
                    {doc.label} →
                  </Link>
                ))}
                {card.external && (
                  <a
                    className="loop-link"
                    href={card.external.href}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {card.external.label} →
                  </a>
                )}
              </div>
            </div>
            <div className="loop-panel">
              <Shot capture={card.capture} />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
