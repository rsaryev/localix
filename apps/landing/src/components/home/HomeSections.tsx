import { Link } from 'react-router'
import { docPages } from '../../generated/docs'
import { type Release, releases } from '../../generated/releases'
import { REPOSITORY_URL, X_URL } from '../../lib/site'
import { SOURCE_DOCS, usePrimaryDownload } from '../DownloadChooser'
import { groupByCategory, groupBySection } from '../../pages/docs/docGroups'
import './sections.css'

const CHANGELOG_URL = `${REPOSITORY_URL}/blob/main/CHANGELOG.md`
const pages = (count: number) => `${count} ${count === 1 ? 'page' : 'pages'}`

/** The statement fold: what Localix is, in a heading and three plain sentences. */
export function Statement() {
  return (
    <section className="statement home-shell" aria-labelledby="statement-title">
      <h2 id="statement-title" className="statement-text lx-reveal">
        One desktop app for you and your agents
      </h2>
      <p className="statement-lede lx-reveal">
        An AI agent and its subagents work in your editor, terminals and browser, next to you. Use
        any model, or run one on your own computer. Claude Code plugins, skills and agents run as
        they are.
      </p>
    </section>
  )
}

interface RosterRow {
  name: string
  count: number
  to: string
}

const rowOf = (name: string, group: { pages: { slug: string }[] }): RosterRow => ({
  name,
  count: group.pages.length,
  to: `/docs/${group.pages[0]!.slug}`,
})

/**
 * The docs as three short columns, counted from the docs themselves: the parts before Features
 * (where to start), Features by category, and the parts after it (building on Localix).
 */
function rosterColumns() {
  const sections = groupBySection(docPages)
  const at = sections.findIndex((section) => section.title === 'Features')
  const plain = (list: typeof sections) => list.map((section) => rowOf(section.title, section))
  const features = at < 0 ? [] : groupByCategory(sections[at]!.pages)
  return [
    { title: 'Start', rows: plain(at < 0 ? sections : sections.slice(0, at)) },
    { title: 'Features', rows: features.map((group) => rowOf(group.title, group)) },
    { title: 'Extend', rows: at < 0 ? [] : plain(sections.slice(at + 1)) },
  ].filter((column) => column.rows.length > 0)
}

export function DocsRoster() {
  return (
    <section className="roster home-shell" aria-labelledby="roster-title">
      <header className="lx-section-head">
        <h2 id="roster-title">Documentation</h2>
        <p className="lx-section-aside">{pages(docPages.length)}</p>
      </header>
      <div className="roster-columns">
        {rosterColumns().map((column) => (
          <div key={column.title} className="roster-column lx-reveal">
            <h3 className="roster-title">{column.title}</h3>
            <ul className="roster-list">
              {column.rows.map((row) => (
                <li key={row.name}>
                  <Link to={row.to} className="roster-row">
                    <span className="roster-name">{row.name}</span>
                    <span className="roster-count">{pages(row.count)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function changes(release: Release) {
  return (['added', 'changed', 'fixed', 'removed'] as const)
    .filter((group) => release[group] > 0)
    .map((group) => `${release[group]} ${group}`)
    .join(' · ')
}

/** A changelog date ("2026-11-03") as people read it ("Nov 3, 2026"), the same on every machine. */
function readableDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * The latest releases, read from the changelog when the site is built: a short list, each with its
 * version and date on the left, what it brings, and how much changed in small type under it.
 */
export function ReleaseDates() {
  const recent = releases.slice(0, 5)
  return (
    <section className="dates home-shell" aria-labelledby="dates-title">
      <header className="lx-section-head">
        <h2 id="dates-title">Releases</h2>
        <a
          className="lx-section-aside"
          href={CHANGELOG_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          Full changelog →
        </a>
      </header>
      <ol className="dates-list">
        {recent.map((release) => (
          <li key={release.version} className="dates-row lx-reveal">
            <p className="dates-when">
              <span className="dates-version">{`v${release.version}`}</span>
              <time dateTime={release.date}>{readableDate(release.date)}</time>
            </p>
            <div>
              <p className="dates-summary">{release.summary}</p>
              <p className="dates-changes">{changes(release)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

const FOOTER_LINKS = [
  { label: 'GitHub', href: REPOSITORY_URL },
  { label: 'X', href: X_URL },
  { label: 'Changelog', href: CHANGELOG_URL },
  { label: 'Security', href: `${REPOSITORY_URL}/blob/main/SECURITY.md` },
]

/**
 * The download, in the page's own pill: the installer this device can run, or the source-build
 * guide when there is none (or no release yet).
 */
function DownloadPill() {
  const primary = usePrimaryDownload()
  return primary?.url ? (
    <a className="lx-pill" href={primary.url}>
      {primary.action}
    </a>
  ) : (
    <Link className="lx-pill" to={SOURCE_DOCS}>
      Build from source
    </Link>
  )
}

/** The first run in three steps, as the getting-started guide walks it. */
const SETUP_STEPS = [
  {
    title: 'Download',
    text: 'The app for Macs with Apple silicon. On other systems, build it from source.',
  },
  {
    title: 'Connect a model',
    text: 'In the model picker under the chat, sign in or paste an API key, or pick a model that runs on your computer.',
  },
  {
    title: 'Open a folder',
    text: 'Add a project folder and say what you want done. The agent works in it, next to you.',
  },
]

/** The close: setting up in three steps, the two ways in, and the footer. */
export function Close() {
  return (
    <section id="download" className="close" aria-labelledby="close-title">
      <div className="close-body home-shell">
        <header className="lx-section-head">
          <h2 id="close-title">Set up Localix</h2>
          <p className="lx-section-aside">Free · MIT license</p>
        </header>
        <ol className="setup-steps">
          {SETUP_STEPS.map((step, index) => (
            <li key={step.title} className="setup-step lx-reveal">
              <span className="setup-step-number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
        <div className="close-actions">
          <DownloadPill />
          <a className="lx-pill lx-pill-quiet" href={REPOSITORY_URL}>
            Source on GitHub
          </a>
        </div>
      </div>
      <footer className="close-strip home-shell">
        <p>
          <span>Localix</span> is MIT-licensed and open source.
        </p>
        <nav aria-label="Footer">
          <Link to="/docs">Docs</Link>
          {FOOTER_LINKS.map(({ label, href }) => (
            <a key={label} href={href}>
              {label}
            </a>
          ))}
        </nav>
      </footer>
    </section>
  )
}
