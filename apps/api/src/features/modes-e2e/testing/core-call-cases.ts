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
  row('AskUserQuestion', 'a blocking question', question, { effect: 'read', needsHuman: true }),

  row('Bash', 'a read-only command', { command: 'ls -la' }, READ),
  row(
    'Bash',
    'a read-only command in the background',
    { command: 'tail -f log.txt', background: true },
    SESSION,
  ),
  row('Bash', 'a build', { command: 'make build' }, EXTERNAL),
  row(
    'Bash',
    'a destructive command',
    { command: 'git push --force origin main' },
    { effect: 'external', irreversible: true },
    { dangerous: true },
  ),
  row(
    'Bash',
    'a catastrophic command',
    { command: 'rm -rf ~' },
    { effect: 'external', irreversible: true },
    { dangerous: true, catastrophic: true },
  ),
  row('Bash', 'a terminal screen read', { action: 'screen', id: 'term-1' }, READ),
  row(
    'Bash',
    'a terminal close',
    { action: 'close', id: 'term-1' },
    { effect: 'external', irreversible: true },
  ),

  row('Read', 'a workspace file', { path: `${WORKSPACE}/src/a.ts` }, READ),
  row('Read', 'a file outside the workspace', { path: '/etc/hosts' }, READ, { outside: true }),
  row('Read', 'a workspace image', { path: `${WORKSPACE}/shot.png` }, READ),
  row('Search', 'a content search', { pattern: 'TODO' }, READ),
  row('Research', 'a web search', { query: 'bun sqlite wal' }, READ),
  row('GlobalSearch', 'a search', { query: 'cache layer' }, READ),
  row('ContextBudget', 'the budget', {}, READ),
  row('ToolOutput', 'a stored output', { action: 'get', id: 'out-1' }, READ),

  row(
    'Write',
    'a workspace file',
    { files: [{ path: `${WORKSPACE}/src/a.ts`, content: 'x' }] },
    FILES,
  ),
  row(
    'Write',
    'a file outside the workspace',
    { files: [{ path: '/etc/motd', content: 'x' }] },
    FILES,
    { outside: true },
  ),
  row(
    'Write',
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
    'Edit',
    'a workspace file',
    { edits: [{ path: `${WORKSPACE}/src/a.ts`, old_string: 'a', new_string: 'b' }] },
    FILES,
  ),
  // The conversation's plan file is its own state: plan mode lets the agent keep it current.
  row('Write', 'the plan file', { files: [{ path: PLAN_FILE, content: '# Plan' }] }, SESSION),
  row(
    'Edit',
    'the plan file',
    { edits: [{ path: PLAN_FILE, old_string: 'a', new_string: 'b' }] },
    SESSION,
  ),
  // One other target makes the whole call a file write: a plan edit cannot carry a source edit.
  row(
    'Edit',
    'the plan file and a source file',
    {
      edits: [
        { path: PLAN_FILE, old_string: 'a', new_string: 'b' },
        { path: `${WORKSPACE}/src/a.ts`, old_string: 'a', new_string: 'b' },
      ],
    },
    FILES,
  ),

  row('Agent', 'start a subagent', { description: 'Investigate', prompt: 'investigate' }, SESSION),
  row('SendMessage', 'message a subagent', { to: 'sub-1', message: 'go' }, SESSION),
  row(
    'TaskStop',
    'stop a subagent or a background job',
    { task_id: 'sub-1' },
    { effect: 'session', irreversible: true },
  ),

  row('Loops', 'list', { action: 'list' }, READ),
  row('Loops', 'reschedule its own loop', { action: 'reschedule', id: 'loop-1' }, SESSION),
  row('Loops', 'add', { action: 'add', prompt: 'tick', cadence: '*/5 * * * *' }, HOST),
  row('Loops', 'run now', { action: 'run', id: 'loop-1' }, HOST),
  row(
    'Loops',
    'remove',
    { action: 'remove', id: 'loop-1' },
    { effect: 'host', irreversible: true },
  ),

  row('Skill', 'get', { action: 'get', name: 'demo' }, READ),
  row(
    'Skill',
    'save in the project',
    { action: 'save', name: 'demo', description: 'd', content: 'c', scope: 'project' },
    FILES,
  ),

  row('Jobs', 'list', { action: 'list' }, READ),
  row('Jobs', 'send input', { action: 'send_input', job_id: 'bg-1', input: 'y' }, EXTERNAL),

  row('Browser', 'a screenshot', { action: 'take_screenshot' }, VIEW),
  row('Browser', 'open a url in the pane', { action: 'open', url: 'http://localhost:3000' }, VIEW),
  row(
    'Browser',
    'drive the page',
    { action: 'steps', steps: [{ action: 'click', ref: 'e1' }] },
    EXTERNAL,
  ),
  row(
    'Browser',
    'search history',
    { action: 'history', history_operation: 'search', query: 'x' },
    READ,
  ),
  row(
    'Browser',
    'clear history',
    { action: 'history', history_operation: 'clear' },
    { effect: 'host', irreversible: true },
  ),

  row('Store', 'search', { action: 'search', query: 'review' }, READ),
  row('Store', 'get', { action: 'get', ref: { kind: 'plugin', id: 'a@b' } }, READ),
  row(
    'Store',
    'install',
    { action: 'install', ref: { kind: 'plugin', id: 'a@b' }, scope: 'user' },
    { effect: 'host', needsHuman: true },
  ),
  row(
    'Store',
    'remove',
    { action: 'remove', ref: { kind: 'plugin', id: 'a@b' }, scope: 'user' },
    { effect: 'host', needsHuman: true, irreversible: true },
  ),
  row(
    'Store',
    'enable',
    { action: 'enable', ref: { kind: 'plugin', id: 'a@b' }, scope: 'project' },
    { effect: 'host', needsHuman: true },
  ),
  row(
    'Store',
    'create an agent',
    { action: 'create', kind: 'agent', scope: 'user', values: { name: 'qa', description: 'd' } },
    { effect: 'host', needsHuman: true },
  ),

  row('Configure', 'inspect', { action: 'inspect', target: { kind: 'summary' } }, READ),
  row(
    'Configure',
    'propose',
    { action: 'propose', change: { kind: 'tool.enable', name: 'Browser' } },
    { effect: 'host', needsHuman: true },
  ),

  row('Vault', 'list', { action: 'list' }, READ),
  row(
    'ExternalAgentSessions',
    'transcript',
    { action: 'transcript', key: 'codex:s1', from: 25 },
    READ,
  ),
  row('Vault', 'update', { action: 'update', key: 'API_KEY', description: 'x' }, HOST),
  row(
    'Vault',
    'create',
    { action: 'create', key: 'API_KEY' },
    { effect: 'host', needsHuman: true },
  ),
  row(
    'Vault',
    'delete',
    { action: 'delete', key: 'API_KEY' },
    { effect: 'host', needsHuman: true, irreversible: true },
  ),

  row('Plan', 'present', { action: 'present', title: 'Cache', body: '## Goal' }, SESSION),
  row('Plan', 'read', { action: 'read' }, READ),
  row('Plan', 'complete', { action: 'complete', summary: 'Done' }, SESSION),
]
