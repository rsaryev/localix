# Session E2E: real conversations against an isolated API

`bun run test:sessions` boots a real Localix API in a throwaway home, drives conversations through
its HTTP API, and answers every model call with a scripted reply. Each scenario then asserts on what
a person sees (the transcript, the session) and on what the model was sent (the system prompt, the
runtime context, the tool roster), so a run's assembly is checked end to end without a provider,
credentials or cost.

Use it when a change moves how a run is assembled or routed: a policy axis (`chat/policy`), a prompt
section (`agent-core/prompt`), tool gating, membership, handoffs or conversation modes. It is also
the quickest way to reproduce a reported conversation behaviour: script the exchange, keep the logs,
and read exactly what each participant's model was given.

It is not part of `bun run test` or CI, because it boots the whole API (about 30 seconds with plugin
staging). The fast unit and integration tests remain the regression net; this is the end-to-end
check.

```bash
bun run test:sessions                         # every scenario
bun run test:sessions --grep 'solo'           # scenarios whose name matches (a regular expression)
bun run test:sessions --grep 'mid-turn' --keep # keep the temporary root with its logs
bun run test:sessions --port 5262             # another port when 5261 is taken
```

The exit code is the number of failed scenarios. The API is stopped on every exit, including a
failed scenario.

## Isolation

`harness.mjs` starts `scripts/dev-api.mjs`, the same launcher `bun run dev` uses, so plugins are
staged as in development. `HOME` points at a fresh directory under the system temporary directory,
so the API's `~/.localix` (database, vault, workspace and plugin data) belongs to the run. Inherited
`LOCALIX_*`, `PORT` and `BUN_OPTIONS` variables are dropped. In this mode the personal application
and its dev server on 5050/5051 are never contacted. The package cache stays the real one, so
nothing is downloaded again.

The provider connection holds a placeholder key. `provider.mjs` is preloaded into the API process
and answers only requests that carry that key; any other request reaches the real `fetch`.

## Scripting a conversation

A person's message carries the script as a `SCRIPT{…}` JSON object inside an inline code span. A
handle in code is a reference, not an address, so the message does not itself route to the agents it
scripts:

```text
Prepare the release. `SCRIPT{"localix":["@checker, verify the checkout.","Shipped."],"checker":["Verified."]}`
```

- Keys are agent handles. The shipped agent is `localix`; the harness also creates `checker` and
  `writer`, whose instructions carry `[e2e:agent=<handle>]` so the provider knows who is speaking.
- Each model request of an agent takes its next step. A step is reply text, or
  `{"tool":"<name>","args":{…}}` for a tool call. After a tool call, the next request (carrying the
  tool's result) takes the next step. When an agent's steps run out it answers `Done.`.
- `"wait":<ms>` on any step delays that answer, which leaves the scenario time to act while the run
  is in flight: `{"wait":2500,"text":"@checker, verify the build."}`.
- A tool missing from the request's roster is answered with text and logged as `missing`.
- The first `SCRIPT{…}` of the latest message that parses is used, so a step can carry a script for
  a delegated child inside its task.
- A new script in a later message restarts every agent's steps.
- Group routing's decision model (OpenRouter `/systemone`, on a placeholder OpenRouter connection)
  is scripted by the event's own text: `` `ROUTE{"choice":"checker","p":0.95}` `` picks that option
  with that probability; for a person's untagged message `"alone"` and `"which"` (at `"pw"`) answer
  the two coordination questions. Without one every answer is unconfident (0.5), so routing follows
  the address rules alone. Decision requests are logged with `decision` and no `sessionId`.

## What the log records

Each model request is one JSON line in `requests.jsonl`: `sessionId` (the `LOCALIX-<seq>` reference
the runtime context names), `speaker`, `stream` (false for auxiliary calls such as title
generation), `tools`, `system` (the full system prompt), `contextHeadings` (the runtime-context
sections, such as `# Agent directory` or `# Current turn`), `messages` (role and the start of every
other message the model read) and `answered`.

```bash
bun run test:sessions --grep 'handoff' --keep
jq -c '{seq, sessionId, speaker, answered, contextHeadings}' <root>/requests.jsonl
jq -r 'select(.speaker == "checker") | .system' <root>/requests.jsonl | less
```

`api.log` in the same root holds the API's output.

## Behaviour on a real model

A scripted model proves what the runtime does; whether an agent BEHAVES as its prompt asks needs a
real one. `--real` attaches to an API you already run and drives the scenarios in `behavior.mjs`
through a provider connection you choose:

```bash
bun run test:sessions --real --api http://127.0.0.1:5051 \
  --connection <provider-connection-id> --model openai/gpt-6-luna
```

- Nothing is isolated, so the run removes what it creates: its sessions, their delegated children,
  and the `checker` and `writer` agents. It refuses to start when an agent of either name already
  exists. `--keep` leaves them for inspection and prints their ids; remove them afterwards.
- A scenario fails only on what the runtime guarantees (membership, mode, no pending card). What the
  model chose is an expectation, printed with `·` (met) or `!` (unmet) beside the transcript, for a
  person to judge: the same prompt can be answered by a tag one time and by a delegation the next.
- It spends real tokens: the four scenarios take about ten model turns. Keep prompts short and ask
  for no files.

## Writing a scenario

Add an entry to `scenarios-modes.mjs` (solo and group conversations) or `scenarios-runs.mjs` (what
else a run inherits); `scenario-helpers.mjs` holds the shared helpers. Each one opens its own
sessions, so scenarios run in any order and alone. Name it after the behaviour it proves. Assert on
the person's view and on the model's input:

```js
{
  name: 'group: the leader tags a colleague in, who answers and reports back',
  async run(rt) {
    const session = await rt.createSession({ conversationMode: 'group' })
    const after = await rt.say(session.id, `Go. ${script({ localix: ['@checker, check it.'] })}`)
    assert.ok(after.agents.some((agent) => agent.handle === 'checker'))
    assert.ok(lastRun(rt, after, 'checker').system.includes('## Your part'))
  },
}
```

The runtime handle (`rt`) offers `createSession({ handles, conversationMode, … })`, `say` (send and
wait until every turn it started has settled), `send` and `waitRunning` (to act mid-turn), `detail`,
`transcript`, `notices`, `requests({ session, speaker })`, `api` (throws on an error status) and
`call` (returns `{ status, body }` for asserting a refusal). Every agent the harness knows is routed
to the scripted model, including agents not yet seated, so an invited agent can answer.

The model is a script, not a reasoner: a scenario proves what the runtime does with a reply
(routing, invitations, silence, notices) and what it sends the model, not how a real model would
answer it. For model behaviour, run the change against a real connection in the app.
