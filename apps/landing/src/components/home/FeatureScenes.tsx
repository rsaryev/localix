import type { CSSProperties } from 'react'

/**
 * Looping miniatures of real Localix surfaces, one per feature row — drawn here rather than
 * imported, because the landing does not ship the app's UI. Each is decorative (`aria-hidden`):
 * the row's own words say what it shows. Motion is transform and opacity only, and a reduced-motion
 * visitor sees each scene's finished frame (features.css).
 */

const letters = (text: string, className: string) =>
  [...text].map((letter, i) => (
    <span key={i} className={className} style={{ '--i': i } as CSSProperties}>
      {letter}
    </span>
  ))

/** A group chat: an untagged message, then the specialist it belongs to takes it. */
export function TeamScene() {
  return (
    <div aria-hidden className="fs fs-team">
      <div className="fs-strip">
        {['Localix', 'Frontend', 'QA'].map((name) => (
          <span key={name} className={`fs-party ${name === 'Frontend' ? 'fs-party-pick' : ''}`}>
            <span className="fs-avatar">{name[0]}</span>
            {name}
          </span>
        ))}
      </div>
      <div className="fs-bubble fs-bubble-you">make the tiles the same size</div>
      <div className="fs-bubble fs-bubble-agent">
        <span className="fs-avatar">F</span>
        <span className="fs-reply">On it — one size at every width.</span>
      </div>
    </div>
  )
}

/** A page driven step by step: a field fills, a suggestion is picked, Search is pressed. */
export function BrowserScene() {
  return (
    <div aria-hidden className="fs fs-browser">
      <div className="fs-chrome">
        <span className="fs-dot" />
        <span className="fs-dot" />
        <span className="fs-address">flights.example/search</span>
      </div>
      <div className="fs-form">
        <span className="fs-field">
          <span className="fs-label">Where to?</span>
          <span className="fs-value">{letters('London', 'fs-letter')}</span>
        </span>
        <span className="fs-suggest">London, United Kingdom</span>
        <span className="fs-button">Search</span>
      </div>
      <span className="fs-cursor" />
      <span className="fs-steps">
        <span>1</span>
        <span>2</span>
        <span>3</span>
      </span>
    </div>
  )
}

const OPTIONS = [
  { label: 'frontend', p: 0.91 },
  { label: 'design', p: 0.07 },
  { label: 'leader', p: 0.02 },
]

/** One typed question: three probability bars fill and the leading option is picked. */
export function DecisionScene() {
  return (
    <div aria-hidden className="fs fs-decision">
      <span className="fs-question">Who takes this turn?</span>
      {OPTIONS.map((option, i) => (
        <span key={option.label} className={`fs-option ${i === 0 ? 'fs-option-pick' : ''}`}>
          <span className="fs-option-label">{option.label}</span>
          <span className="fs-track">
            <span className="fs-bar" style={{ '--p': option.p, '--i': i } as CSSProperties} />
          </span>
          <span className="fs-p">{option.p.toFixed(2)}</span>
        </span>
      ))}
      <span className="fs-latency">0.3 s</span>
    </div>
  )
}

/** A described plugin assembling: the command, then its board tile by tile. */
export function PluginScene() {
  return (
    <div aria-hidden className="fs fs-plugin">
      <span className="fs-command">{letters('/plugin create chess', 'fs-letter')}</span>
      <div className="fs-board">
        {Array.from({ length: 32 }, (_, i) => (
          <span
            key={i}
            className={`fs-tile ${(i + Math.floor(i / 8)) % 2 ? 'fs-tile-dark' : ''}`}
            style={{ '--i': i } as CSSProperties}
          />
        ))}
      </div>
      <span className="fs-built">Built · 12 tests</span>
    </div>
  )
}

const CLIS = ['Claude Code', 'Codex', 'Gemini CLI', 'opencode']

/** A coding CLI linked to a chat: the agent pill, and its terminal beside the conversation. */
export function ExternalScene() {
  return (
    <div aria-hidden className="fs fs-external">
      <div className="fs-cli-list">
        {CLIS.map((name, i) => (
          <span key={name} className={`fs-cli ${i === 0 ? 'fs-cli-pick' : ''}`}>
            {name}
          </span>
        ))}
      </div>
      <div className="fs-terminal">
        <span className="fs-prompt">❯ claude</span>
        <span className="fs-term-line">Reading src/board.ts</span>
        <span className="fs-term-line fs-term-done">✓ Edited 2 files</span>
      </div>
    </div>
  )
}

const PROVIDERS = ['Anthropic', 'OpenAI', 'GitHub Copilot', 'OpenRouter']

/** The model picker: a provider is signed in, then a local model fits this computer. */
export function ModelsScene() {
  return (
    <div aria-hidden className="fs fs-models">
      <div className="fs-providers">
        {PROVIDERS.map((name, i) => (
          <span key={name} className={`fs-provider ${i === 3 ? 'fs-provider-pick' : ''}`}>
            {name}
          </span>
        ))}
      </div>
      <div className="fs-local">
        <span className="fs-local-name">Gemma 4 · on this computer</span>
        <span className="fs-slider">
          <span className="fs-slider-fill" />
          <span className="fs-slider-knob" />
        </span>
        <span className="fs-slider-ends">
          <span>Fastest</span>
          <span>Smartest</span>
        </span>
      </div>
    </div>
  )
}
