import type { ComponentType } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Section } from './Reveal'
import {
  BrowserScene,
  DecisionScene,
  ExternalScene,
  ModelsScene,
  PluginAppScene,
  PluginScene,
  TeamScene,
} from './FeatureScenes'
import './features.css'
import './feature-scenes.css'
import './feature-scenes-more.css'

interface Feature {
  title: string
  line: string
  docs: string
  Scene: ComponentType
  /** Spans the whole row, under the 3×2 grid, at every width. */
  wide?: boolean
}

/**
 * What Localix is, in six short claims and one full-width row, each shown working in a miniature
 * and linked to the guide that backs it. Every line is held to its page: nothing here says more
 * than the docs do.
 */
export const FEATURES: readonly Feature[] = [
  {
    title: 'Agent teams',
    line: 'Specialists share one chat; a clear request goes straight to the right one.',
    docs: '/docs/features--group-routing',
    Scene: TeamScene,
  },
  {
    title: 'A fast Browser',
    line: 'Agents drive any page step by step and check the result.',
    docs: '/docs/features--workspace#the-browser',
    Scene: BrowserScene,
  },
  {
    title: 'Decision models',
    line: 'Small, cheap models make the quick calls across the app.',
    docs: '/docs/features--decision-models',
    Scene: DecisionScene,
  },
  {
    title: 'Mini apps, built by the agent',
    line: 'Describe any app with /plugin create, from a meal log to a dashboard, wired to the agent, models and embeddings. Claude Code plugins load as they are.',
    docs: '/docs/extending--build-with-the-agent',
    Scene: PluginScene,
  },
  {
    title: 'Your coding agents',
    line: 'Claude Code, Codex, Gemini CLI and more, linked to your chats.',
    docs: '/docs/features--external-agents',
    Scene: ExternalScene,
  },
  {
    title: 'Any model',
    line: 'Sign in or bring a key, or run models on this computer.',
    docs: '/docs/features--providers',
    Scene: ModelsScene,
  },
  {
    title: 'Mini apps as Mac apps',
    line: 'Install a mini app as its own app: a Dock icon, a window of its own, and the agent beside it.',
    docs: '/docs/features--plugin-apps',
    Scene: PluginAppScene,
    wide: true,
  },
]

export function Features() {
  return (
    <Section id="features" className="py-16 md:py-24">
      <ul className="features-grid">
        {FEATURES.map(({ title, line, docs, Scene, wide }) => (
          // The whole card is the link to its guide: one target, named by its title and line.
          <li key={title} className={wide ? 'feature-wide' : undefined}>
            <Link to={docs} className="feature-card group/cue focus-ring">
              <div className="feature-stage">
                <Scene />
              </div>
              <h2 className="feature-title section-title">
                {title}
                <ArrowRight aria-hidden className="feature-arrow arrow-cue" />
              </h2>
              <p className="feature-line copy">{line}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  )
}
