/**
 * REPRESENTATIVE CALLS FOR EVERY CORE TOOL, each with the class written out by hand.
 *
 * The defect a mode matrix invites is the tautology: derive the expected verdict from the very
 * `classify` the gate calls, and a tool that misclassifies a write as a read passes every cell,
 * because the expectation and the gate are wrong together. So the class of each call below is
 * stated here, from the tool's own documentation of what the call does, and the matrix first
 * checks the tool AGREES with it — a disagreement is a finding, not a fixture to update.
 *
 * `facts` names what the call's arguments reveal (a path outside the workspace, a destructive or
 * catastrophic command), also by hand: those are the inputs the presets' baseline rows and the
 * bypass floor ask about, and the matrix checks `extractCallFacts` sees them the same way.
 *
 * One row per distinct class a tool can answer, so every branch of every classify table that a
 * mode treats differently is exercised at least once.
 */
import type { CallClass } from '@localixai/agent/agents'

export const WORKSPACE = '/tmp/localix-modes-e2e/workspace'

export interface CallFactsExpected {
  outside?: boolean
  dangerous?: boolean
  catastrophic?: boolean
}

export interface CallCase {
  tool: string
  label: string
  input: Record<string, unknown>
  cls: CallClass
  facts?: CallFactsExpected
}

const READ: CallClass = { effect: 'read' }
const VIEW: CallClass = { effect: 'view' }
const SESSION: CallClass = { effect: 'session' }
const FILES: CallClass = { effect: 'files' }
const HOST: CallClass = { effect: 'host' }
const EXTERNAL: CallClass = { effect: 'external' }

const row = (
  tool: string,
  label: string,
  input: Record<string, unknown>,
  cls: CallClass,
  facts?: CallFactsExpected,
): CallCase => ({ tool, label, input, cls, ...(facts ? { facts } : {}) })

const PLAN_FILE = `${WORKSPACE}/.localix/plans/LOCALIX-1/PLAN.md`

const question = { questions: [{ question: 'Which database?', options: ['pg', 'sqlite'] }] }

export const CORE_CALL_CASES: readonly CallCase[] = [
  row('ask', 'a blocking question', question, { effect: 'read', needsHuman: true }),
  row(
    'ask',
    'a queued question',
    { ...question, wait: false },
    { effect: 'session', needsHuman: true },
  ),

  row('bash', 'a read-only command', { command: 'ls -la' }, READ),
  row(
    'bash',
    'a read-only command in the background',
    { command: 'tail -f log.txt', background: true },
    SESSION,
  ),
  row('bash', 'a build', { command: 'make build' }, EXTERNAL),
  row(
    'bash',
    'a destructive command',
    { command: 'git push --force origin main' },
    { effect: 'external', irreversible: true },
    { dangerous: true },
  ),
  row(
    'bash',
    'a catastrophic command',
    { command: 'rm -rf ~' },
    { effect: 'external', irreversible: true },
    { dangerous: true, catastrophic: true },
  ),
  row('bash', 'a terminal screen read', { action: 'screen', id: 'term-1' }, READ),
  row(
    'bash',
    'a terminal close',
    { action: 'close', id: 'term-1' },
    { effect: 'external', irreversible: true },
  ),

  row('read', 'a workspace file', { path: `${WORKSPACE}/src/a.ts` }, READ),
  row('read', 'a file outside the workspace', { path: '/etc/hosts' }, READ, { outside: true }),
  row('read', 'a workspace image', { path: `${WORKSPACE}/shot.png` }, READ),
  row('search', 'a content search', { pattern: 'TODO' }, READ),
  row('research', 'a web search', { query: 'bun sqlite wal' }, READ),
  row('history_search', 'a history search', { query: 'cache layer' }, READ),
  row('context_budget', 'the budget', {}, READ),
  row('tool_output', 'a stored output', { action: 'get', id: 'out-1' }, READ),

  row(
    'write',
    'a workspace file',
    { files: [{ path: `${WORKSPACE}/src/a.ts`, content: 'x' }] },
    FILES,
  ),
  row(
    'write',
    'a file outside the workspace',
    { files: [{ path: '/etc/motd', content: 'x' }] },
    FILES,
    { outside: true },
  ),
  row(
    'write',
    'a batch with one file outside the workspace',
    {
      files: [
        { path: `${WORKSPACE}/src/a.ts`, content: 'x' },
        { path: '/etc/motd', content: 'x' },
      ],
    },
    FILES,
    { outside: true },
  ),
  row(
    'edit',
    'a workspace file',
    { edits: [{ path: `${WORKSPACE}/src/a.ts`, old_string: 'a', new_string: 'b' }] },
    FILES,
  ),
  // The conversation's plan file is its own state: plan mode lets the agent keep it current.
  row('write', 'the plan file', { files: [{ path: PLAN_FILE, content: '# Plan' }] }, SESSION),
  row(
    'edit',
    'the plan file',
    { edits: [{ path: PLAN_FILE, old_string: 'a', new_string: 'b' }] },
    SESSION,
  ),
  // One other target makes the whole call a file write: a plan edit cannot carry a source edit.
  row(
    'edit',
    'the plan file and a source file',
    {
      edits: [
        { path: PLAN_FILE, old_string: 'a', new_string: 'b' },
        { path: `${WORKSPACE}/src/a.ts`, old_string: 'a', new_string: 'b' },
      ],
    },
    FILES,
  ),

  row('fork', 'start a fork', { task: 'investigate', title: 'Investigate' }, SESSION),
  row('fork', 'list forks', { action: 'list' }, READ),
  row('fork', 'message a fork', { action: 'message', run: 'sub-1', message: 'go' }, SESSION),
  row(
    'fork',
    'stop a fork',
    { action: 'stop', run: 'sub-1' },
    { effect: 'session', irreversible: true },
  ),
  row(
    'fork',
    'close a fork',
    { action: 'close', run: 'sub-1' },
    { effect: 'session', irreversible: true },
  ),

  row('loops', 'list', { action: 'list' }, READ),
  row('loops', 'reschedule its own loop', { action: 'reschedule', id: 'loop-1' }, SESSION),
  row('loops', 'add', { action: 'add', prompt: 'tick', cadence: '*/5 * * * *' }, HOST),
  row('loops', 'run now', { action: 'run', id: 'loop-1' }, HOST),
  row(
    'loops',
    'remove',
    { action: 'remove', id: 'loop-1' },
    { effect: 'host', irreversible: true },
  ),

  row('plugin_build', 'a build', { name: 'demo' }, EXTERNAL),

  row('memory', 'get', { action: 'get', key: 'role' }, READ),
  row(
    'memory',
    'set in the session scope',
    { action: 'set', key: 'k', value: 'v', scope: 'session' },
    SESSION,
  ),
  row('memory', 'set in the project scope', { action: 'set', key: 'k', value: 'v' }, HOST),
  row('memory', 'delete', { action: 'delete', key: 'k' }, { effect: 'host', irreversible: true }),

  row('skill', 'list', { action: 'list' }, READ),
  row(
    'skill',
    'save in the project',
    { action: 'save', name: 'demo', description: 'd', content: 'c', scope: 'project' },
    FILES,
  ),
  row(
    'skill',
    'delete',
    { action: 'delete', name: 'demo' },
    { effect: 'files', irreversible: true },
  ),

  row('jobs', 'list', { action: 'list' }, READ),
  row('jobs', 'send input', { action: 'send_input', job_id: 'bg-1', input: 'y' }, EXTERNAL),
  row(
    'jobs',
    'stop',
    { action: 'stop', job_id: 'bg-1' },
    { effect: 'session', irreversible: true },
  ),

  row('browser', 'a screenshot', { action: 'take_screenshot' }, VIEW),
  row('browser', 'open a url in the pane', { action: 'open', url: 'http://localhost:3000' }, VIEW),
  row(
    'browser',
    'drive the page',
    { action: 'steps', steps: [{ action: 'click', ref: 'e1' }] },
    EXTERNAL,
  ),
  row(
    'browser',
    'search history',
    { action: 'history', history_operation: 'search', query: 'x' },
    READ,
  ),
  row(
    'browser',
    'clear history',
    { action: 'history', history_operation: 'clear' },
    { effect: 'host', irreversible: true },
  ),

  row(
    'set_topic',
    'start a topic',
    { title: 'T', goal: 'G', previousTopicSummary: 'None.' },
    SESSION,
  ),

  row('skip_answer', 'pass the turn', {}, READ),

  row('agents', 'list', { action: 'list' }, READ),
  row(
    'agents',
    'create',
    {
      action: 'create',
      agents: [{ handle: 'qa', description: 'd', instructions: 'i', leadership_priority: 0 }],
    },
    { effect: 'host' },
  ),

  row('configure', 'inspect', { action: 'inspect', target: { kind: 'summary' } }, READ),
  row(
    'configure',
    'propose',
    { action: 'propose', change: { kind: 'tool.enable', name: 'browser' } },
    { effect: 'host', needsHuman: true },
  ),

  row('vault', 'list', { action: 'list' }, READ),
  row(
    'external_agent_sessions',
    'transcript',
    { action: 'transcript', key: 'codex:s1', from: 25 },
    READ,
  ),
  row('vault', 'update', { action: 'update', key: 'API_KEY', description: 'x' }, HOST),
  row(
    'vault',
    'create',
    { action: 'create', key: 'API_KEY' },
    { effect: 'host', needsHuman: true },
  ),
  row(
    'vault',
    'delete',
    { action: 'delete', key: 'API_KEY' },
    { effect: 'host', needsHuman: true, irreversible: true },
  ),

  row('plan', 'present', { action: 'present', title: 'Cache', body: '## Goal' }, SESSION),
  row('plan', 'read', { action: 'read' }, READ),
  row('plan', 'complete', { action: 'complete', summary: 'Done' }, SESSION),
]
