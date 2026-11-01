import { Link } from 'react-router'
import { REPOSITORY_URL } from '../../lib/site'

/** The homepage's bar: the logo, three links and the download. */
export function HomeNav() {
  return (
    <header className="lx-nav">
      <div className="home-shell lx-nav-row">
        <Link to="/" className="lx-nav-mark focus-ring" aria-label="Localix home">
          <img src="/logo.svg" alt="" width={30} height={30} />
        </Link>
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
