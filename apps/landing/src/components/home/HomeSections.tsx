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

/** One row per part of the docs, with how many pages it holds, counted from the docs themselves. */
function rosterRows() {
  return groupBySection(docPages).flatMap((section) => {
    const groups =
      section.title === 'Features'
        ? groupByCategory(section.pages)
        : [{ title: '', pages: section.pages }]
    return groups.map((group) => ({
      // Only a category needs its part of the docs beside it; a part with none names itself.
      label: group.title ? section.title : '',
      name: group.title || section.title,
      count: group.pages.length,
      to: `/docs/${group.pages[0]!.slug}`,
    }))
  })
}

export function DocsRoster() {
  const rows = rosterRows()
  return (
    <section className="roster home-shell" aria-labelledby="roster-title">
      <header className="lx-section-head">
        <h2 id="roster-title">Documentation</h2>
        <p className="lx-section-aside">{pages(docPages.length)}</p>
      </header>
      <ul className="roster-list">
        {rows.map((row) => (
          <li key={`${row.label}-${row.name}`} className="lx-reveal">
            <Link to={row.to} className="roster-row">
              <span className="roster-label">{row.label}</span>
              <span className="roster-name">{row.name}</span>
              <span className="roster-count">{pages(row.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function changes(release: Release) {
  return (['added', 'changed', 'fixed', 'removed'] as const)
    .filter((group) => release[group] > 0)
    .map((group) => `${release[group]} ${group}`)
    .join(' · ')
}

/** The latest releases, read from the changelog when the site is built. */
export function ReleaseDates() {
  const recent = releases.slice(0, 6)
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
      <table className="dates-table">
        <thead>
          <tr>
            <th scope="col">Release</th>
            <th scope="col">Date</th>
            <th scope="col">What it brings</th>
            <th scope="col">Entries</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((release) => (
            <tr key={release.version} className="lx-reveal">
              <th scope="row">{`v${release.version}`}</th>
              <td>
                <time dateTime={release.date}>{release.date}</time>
              </td>
              <td>{release.summary}</td>
              <td>{changes(release)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

/** The close: a last word, the two ways in, the footer, and the wordmark cropped by the page. */
export function Close() {
  return (
    <section id="download" className="close" aria-labelledby="close-title">
      <div className="close-row home-shell">
        <div>
          <h2 id="close-title">Get Localix</h2>
          <p className="close-fine">
            Free and open source under the MIT license. The installer is for Macs with Apple
            silicon. On other systems, build it from source.
          </p>
        </div>
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
