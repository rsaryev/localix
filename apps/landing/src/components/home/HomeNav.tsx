import { Link } from 'react-router'
import { REPOSITORY_URL } from '../../lib/site'

/**
 * The homepage's bar: three links and the download, on the right. No logo: the page opens on the
 * flying bird itself, and a second one in the corner only repeats it.
 */
export function HomeNav() {
  return (
    <header className="lx-nav">
      <div className="home-shell lx-nav-row">
        <nav aria-label="Site navigation" className="lx-nav-links">
          <Link to="/docs" className="focus-ring">
            Docs
          </Link>
          <a href={`${REPOSITORY_URL}/blob/main/CHANGELOG.md`} className="lx-nav-wide focus-ring">
            Changelog
          </a>
          <a href={REPOSITORY_URL} className="focus-ring">
            GitHub
          </a>
          <a href="#download" className="lx-pill lx-pill-small focus-ring">
            Download
          </a>
        </nav>
      </div>
    </header>
  )
}
