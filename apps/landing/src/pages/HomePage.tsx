import { Link } from 'react-router'
import { DownloadChooser } from '@/components/DownloadChooser'
import { DemoFilm } from '@/components/home/DemoFilm'
import { HOME_SHELL } from '@/lib/shell'
import '../components/home/films.css'

const HEADLINE = 'The Agentic Development Environment'
/** The word set on a white chip, as llx.sh sets "lightweight". */
const CHIP_WORD = 'Agentic'

/**
 * One screen, as on llx.sh: the copy on the left (a heavy headline with one word on a chip, the
 * sentence, the download and a mono line under it), and the demo film on the right, where llx
 * replays its terminal. Everything else lives in the docs.
 */
export function HomePage() {
  const words = HEADLINE.split(' ')
  return (
    <section id="intro" className={`${HOME_SHELL} hero`} aria-labelledby="hero-title">
      <div className="hero-copy">
        <h1 id="hero-title" className="hero-title">
          {words.map((word, index) => (
            <span key={word}>
              {word === CHIP_WORD ? <span className="hero-chip">{word}</span> : word}
              {index < words.length - 1 ? ' ' : null}
            </span>
          ))}
        </h1>
        <p className="hero-lede">
          A team of AI agents works with you in one desktop app: your editor, terminals and browser.
          Any model, or run one on your own computer. Your Claude Code plugins, skills, agents,
          hooks and mods run as they are.
        </p>
        <DownloadChooser className="hero-download w-auto" />
        <p className="hero-under">
          macOS on Apple silicon · <Link to="/docs">Read the docs</Link>
        </p>
      </div>
      <div id="demo" className="hero-demo">
        <DemoFilm />
        <p className="demo-caption">
          <span>
            <code>/workflows</code> builds and tests a 2048 game
          </span>
          <span>Recorded in Localix</span>
        </p>
      </div>
    </section>
  )
}
