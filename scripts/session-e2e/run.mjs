/**
 * Run the session E2E scenarios.
 *
 *   bun run test:sessions                       # scripted model, isolated API: every scenario
 *   bun run test:sessions --grep 'solo'         # scenarios whose name matches
 *   bun run test:sessions --keep                # keep the temporary root (logs, database)
 *   bun run test:sessions --port 5262           # another port, if 5261 is taken
 *
 *   # Behaviour on a REAL model, through an API you already run and a connection you chose:
 *   bun run test:sessions --real --api http://127.0.0.1:5051 \
 *     --connection <provider-connection-id> --model openai/gpt-6-luna
 *
 * Not part of the normal suite or CI. The isolated API is always stopped; an attached run removes
 * the sessions and agents it created. The exit code is the number of failed scenarios.
 */
import { attachRuntime, startRuntime } from './harness.mjs'
import { BEHAVIOR } from './behavior.mjs'
import { SCENARIOS } from './scenarios.mjs'

function option(name) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? (process.argv[at + 1] ?? '') : undefined
}

const real = process.argv.includes('--real')
const grep = option('grep')
const keep = process.argv.includes('--keep')
const port = Number(option('port') ?? 5261)
const pool = real ? BEHAVIOR : SCENARIOS
const selected = pool.filter((scenario) => !grep || new RegExp(grep, 'i').test(scenario.name))
if (selected.length === 0) {
  console.error(`No scenario matches ${grep}`)
  process.exit(1)
}

let runtime
if (real) {
  const base = option('api')
  const connectionId = option('connection')
  const modelId = option('model')
  if (!base || !connectionId || !modelId) {
    console.error('--real needs --api, --connection and --model')
    process.exit(1)
  }
  console.log(`[session-e2e] attaching to ${base} on ${modelId}…`)
  runtime = await attachRuntime({ base, connectionId, modelId, keep })
} else {
  console.log(`[session-e2e] starting an isolated API on port ${port}…`)
  runtime = await startRuntime({ port, keep })
  console.log(`[session-e2e] root: ${runtime.root}`)
}

const failures = []
const unmet = []
// A scenario marked `known: '<the gap>'` asserts Claude Code's behaviour where Localix still
// differs: its failure is listed, not counted, and a pass says the marker can go.
const gaps = []
try {
  for (const scenario of selected) {
    const started = Date.now()
    const expectations = []
    const expect = (label, ok, detail) => expectations.push({ label, ok, detail })
    try {
      const session = await scenario.run(runtime, expect)
      console.log(`  ✓ ${scenario.name} (${Date.now() - started} ms)`)
      for (const { label, ok, detail } of expectations) {
        console.log(`      ${ok ? '·' : '!'} ${label}${ok ? '' : `: ${JSON.stringify(detail)}`}`)
        if (!ok) unmet.push(`${scenario.name}: ${label}`)
      }
      if (real && session)
        for (const row of runtime.transcript(session))
          console.log(`      ${row.from}: ${row.text.replace(/\s+/g, ' ').slice(0, 400)}`)
      if (scenario.known)
        console.log(`      ! passes now — remove its known gap: ${scenario.known}`)
    } catch (error) {
      const trace = String(error?.stack ?? error)
      if (scenario.known) {
        gaps.push(scenario.name)
        console.log(
          `  ~ ${scenario.name} (known gap: ${scenario.known})\n    ${trace.split('\n')[0]}`,
        )
        continue
      }
      failures.push(scenario.name)
      console.log(`  ✗ ${scenario.name}\n    ${trace.split('\n').join('\n    ')}`)
    }
  }
} finally {
  await runtime.stop()
}
console.log(
  `[session-e2e] ${selected.length - failures.length - gaps.length} passed, ${failures.length} failed` +
    (gaps.length ? `, ${gaps.length} known gap(s)` : '') +
    (unmet.length ? `, ${unmet.length} behaviour expectation(s) unmet` : '') +
    (keep && !real ? ` — logs kept in ${runtime.root} (requests.jsonl, api.log)` : ''),
)
process.exit(failures.length)
