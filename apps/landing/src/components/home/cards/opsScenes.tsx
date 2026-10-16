import type { CSSProperties } from 'react'
import { Container, Database, Globe, Play, RotateCw, Send } from 'lucide-react'
import { Window } from './chrome'
import { Code } from './highlight'

const order = (i: number) => ({ '--i': i }) as CSSProperties

const query = ['SELECT title, status', 'FROM release_checks', 'ORDER BY id;']
const rows = [
  ['Review the layout', 'done', 'ok'],
  ['Write release notes', 'ready', 'info'],
]

/** The query is written line by line, Run is pressed, and the rows arrive. */
export function DatabaseScene() {
  return (
    <Window tabs={[{ icon: Database, label: 'release_studio', active: true }]}>
      <div className="sc-db">
        <div className="sc-sql k-mono" data-lang="sql">
          {query.map((line, i) => (
            <span key={line} style={order(i)}>
              <i className="k-gutter">{i + 1}</i>
              <Code lang="sql">{line}</Code>
            </span>
          ))}
        </div>
        <div className="sc-db-bar">
          <span className="sc-db-status">2 rows · &lt;1 ms</span>
          <span className="k-btn sc-run">
            <Play className="size-2.5 fill-current" /> Run
          </span>
        </div>
        <div className="sc-grid">
          <span className="sc-grid-head">#</span>
          <span className="sc-grid-head">
            title <small>text</small>
          </span>
          <span className="sc-grid-head">
            status <small>text</small>
          </span>
          {rows.map(([title, status, tone], i) => (
            <div key={title} className="sc-grid-row" style={order(i)}>
              <span>{i + 1}</span>
              <span>{title}</span>
              <span>
                <i className="k-dot" data-tone={tone} /> {status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Window>
  )
}

const response = ['{', '  "release": "v1.4",', '  "status": "ready",', '  "checks": 3', '}']

/** Send is pressed, the request loads, the status settles, and the body arrives line by line. */
export function ApiScene() {
  return (
    <Window tabs={[{ icon: Globe, label: 'API Client', active: true }]}>
      <div className="sc-api">
        <div className="sc-url">
          <b className="k-mono">GET</b>
          <code className="k-mono">localhost:5160/release.json</code>
          <span className="sc-send">
            <Send className="size-3" />
          </span>
          <i className="sc-loading" />
        </div>
        <div className="sc-api-tabs">
          <span data-active>Response</span>
          <span>Headers</span>
          <span className="k-swap sc-api-status">
            <span>waiting…</span>
            <span className="k-mono">200 OK</span>
          </span>
        </div>
        <div className="sc-json k-mono">
          {response.map((line, i) => (
            <span key={line} style={order(i)}>
              <i className="k-gutter">{i + 1}</i>
              <Code lang="json">{line}</Code>
            </span>
          ))}
        </div>
      </div>
    </Window>
  )
}

const logs = [
  ['12:04:28', 'GET /health 200'],
  ['12:04:29', 'GET /api/releases 200'],
  ['12:04:30', 'SIGTERM received'],
  ['12:04:31', 'Starting api…'],
  ['12:04:31', 'Listening on :3000'],
  ['12:04:32', 'GET /health 200'],
]

/** Restart is pressed; the container restarts, comes back up, and the log appends line by line. */
export function DevOpsScene() {
  return (
    <Window
      tabs={[
        { icon: Container, label: 'DevOps' },
        { icon: Container, label: 'api', active: true },
      ]}
    >
      <div className="sc-ops">
        <div className="sc-ops-head">
          <span className="k-swap sc-ops-state">
            <span data-tone="warn">
              <i className="k-dot" /> Restarting
            </span>
            <span data-tone="ok">
              <i className="k-dot" /> Running
            </span>
          </span>
          <b>api</b>
          <span className="k-mono">node:22-alpine</span>
          <span className="sc-restart">
            <RotateCw className="size-2.5" /> Restart
          </span>
        </div>
        <div className="sc-log k-mono">
          <div className="sc-log-lines">
            {logs.map(([time, line], i) => (
              <span key={i} data-new={i > 2 || undefined}>
                <i className="k-gutter">{i + 18}</i>
                <time>{time}</time> {line}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Window>
  )
}
