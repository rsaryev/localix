/**
 * What the Claude Code session hook scenarios (`scenarios-cc-session-hooks-*.mjs`) share. Every
 * hook is an sh script that appends the JSON it read on stdin to
 * `<root>/cc-session-out/<plugin>/<tag>.jsonl` (and its env to `<tag>.env`).
 */
import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'

import { script } from './scenario-helpers.mjs'
import { jsonLines, writeTree } from './scenarios-cc-helpers.mjs'

/** An sh line printing one JSON output object on stdout. */
export const emit = (output) => `printf '%s\\n' '${JSON.stringify(output)}'`
export const context = (event, text) => ({
  hookSpecificOutput: { hookEventName: event, additionalContext: text },
})
/** Lets the second pass of a Stop/SubagentStop through. */
export const SECOND_PASS_OK = `case "$input" in *'"stop_hook_active":true'*) exit 0 ;; esac`

/** Everything a model request read besides its system prompt: reminders and message starts. */
export const reads = (request) =>
  [...(request?.reminders ?? []), ...(request?.messages ?? []).map((m) => m.text)].join('\n')

/** Everything the person's view of the session holds, as text: replies, notices, errors. */
export const shown = (session) => JSON.stringify(session.messages.map((message) => message.payload))

/** A new chat, with each prompt said in turn; returns the session as it last settled. */
export async function chat(rt, title, prompts, options) {
  let session = await rt.createSession({ title })
  for (const prompt of prompts) session = await rt.say(session.id, prompt, options)
  return session
}

/**
 * A plugin whose hooks are sh scripts. `on(event, tag, body, { matcher, ...handlerFields })` adds
 * one handler; `seen(tag)` is every input it read, oldest first. `run(body)` installs the plugin,
 * runs `body` and always removes it again: the scenarios share one API.
 */
export function hookPlugin(rt, name) {
  const dir = path.join(rt.root, 'cc-session', name)
  const out = path.join(rt.root, 'cc-session-out', name)
  const files = {}
  const hooks = {}
  const plugin = {
    out,
    on(event, tag, body = '', { matcher, ...fields } = {}) {
      files[`hooks/${tag}.sh`] = [
        'input=$(cat)',
        `printf '%s\\n' "$input" >> "${out}/${tag}.jsonl"`,
        `env > "${out}/${tag}.env"`,
        `OUT="${out}"`,
        body,
      ].join('\n')
      const command = `sh "\${CLAUDE_PLUGIN_ROOT}/hooks/${tag}.sh"`
      return plugin.group(event, { matcher, hooks: [{ type: 'command', command, ...fields }] })
    },
    group(event, group) {
      ;(hooks[event] ??= []).push(group)
      return plugin
    },
    file(rel, text) {
      files[rel] = text
      return plugin
    },
    seen: (tag) => jsonLines(path.join(out, `${tag}.jsonl`)),
    env: (tag) =>
      Object.fromEntries(
        readFileSync(path.join(out, `${tag}.env`), 'utf8')
          .split('\n')
          .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
      ),
    async run(body) {
      mkdirSync(out, { recursive: true })
      writeTree(dir, {
        '.claude-plugin/plugin.json': JSON.stringify({ name, version: '1.0.0' }),
        'hooks/hooks.json': JSON.stringify({ hooks }),
        ...files,
      })
      await rt.api('/plugins/install', { source: dir, enable: true })
      try {
        return await body()
      } finally {
        await rt.api('/plugins/remove', { name })
      }
    },
  }
  return plugin
}

/**
 * A throwaway project in the run's root (realpath, as a hook reads it): the API can still write
 * its cache there after the project is deleted, and the root goes with the runtime.
 */
export async function withProject(rt, name, body) {
  const dir = realpathSync(await mkdtemp(path.join(rt.root, 'cc-session-project-')))
  const project = await rt.api('/projects', { name, workingDir: dir })
  try {
    return await body(project, dir)
  } finally {
    await rt.call(`/projects/${project.id}`, undefined, 'DELETE')
    await rm(dir, { recursive: true, force: true })
  }
}

/** The requests of a delegated child or verifier: another session, carrying its task marker. */
export const childRuns = (rt, parent, marker) =>
  rt
    .requests({ speaker: 'localix' })
    .filter(
      (r) =>
        r.stream &&
        r.sessionId &&
        r.sessionId !== `LOCALIX-${parent.seq}` &&
        r.messages.some((m) => m.text.includes(marker)),
    )

export const HELPER = '---\nname: helper\ndescription: Helps.\n---\n\nYou help.\n'
/** Delegate the marked task to `agent` and wait for the parent to settle. */
export const delegate = (rt, title, agent, marker, childSteps) => {
  const task = `${marker} help. ${script({ localix: childSteps })}`
  const steps = [{ tool: 'delegate', args: { task, title, agent, wait: true } }, 'Finished.']
  return chat(rt, title, [`Delegate. ${script({ localix: steps })}`], { timeoutMs: 90_000 })
}
