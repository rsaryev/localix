# Report plugin failures

A plugin reports a failure as a problem the person can act on: one line inside a surface that still
shows something, a centred state when the failure is the whole pane, and the one action that fixes
it. Use this page when a plugin calls its own backend or an external program such as Docker, git or
`gh`.

## Terminology

| Term         | Meaning                                                                  | Boundary                                       |
| ------------ | ------------------------------------------------------------------------ | ---------------------------------------------- |
| Problem      | What `useProblemReport` returns: a headline, a code and the failed call. | Its request is what the Event Center traces.   |
| Prerequisite | An external program the plugin needs, and the state it is in.            | `missing`, `stopped` or `signed-out`.          |
| Recovery     | The one action that resolves a prerequisite.                             | A command is pasted for the person, never run. |

## What you can do

Render what `useProblemReport` returns: `ProblemLine` inside a surface that still shows something,
`ProblemState` when the failure is the whole pane. `ProblemState` owns the centring — a hand-built
`flex-1 justify-center` wrapper is a no-op in a block-level scroll container, which is how a
"centred" DevOps error sat at the top of an empty sidebar, and `house-style.test.ts` rejects one.

Put the code in `Problem.code` and the failed call in `Problem.request`; the Event Center traces
exactly that request. An API error built with `problemRequestOf(response)` from
`@localixai/plugin-sdk/ui/transport` carries it, and `pluginFailureFacts(error)` spreads code,
detail, request and prerequisite into a problem.

When the failure is an external program that is missing or stopped, say so as a `Prerequisite`
(`@localixai/plugin-sdk/prerequisite`) instead of a sentence with a Retry under it:

| State        | Headline                   | Primary action | What it does                              |
| ------------ | -------------------------- | -------------- | ----------------------------------------- |
| `missing`    | `Docker is not installed`  | Install Docker | Opens `installUrl`                        |
| `stopped`    | `Docker is not running`    | Start Docker   | Pastes `command` into the chat's terminal |
| `signed-out` | `Not signed in to GitHub…` | Sign in        | Pastes `command` into the chat's terminal |

## How it works

On the backend, classify with `isMissingExecutable(err)` (it reads Bun's
`Executable not found in $PATH`, Node's `spawn x ENOENT` and the error's `code`), pass
`{ prerequisite }` to your `defineTypedError` class, and serialize `toErrorInfo(err).prerequisite`
with the error body. Spawn host tools with `env: toolEnv()` and look them up with
`resolveExecutable(name)` from `@localixai/plugin-sdk/backend`.

In the UI, `prerequisiteProblem(prerequisite, { code, detail, request })` builds the problem and
`usePrerequisiteRecovery(prerequisite)` the action; mark it `primary` and `ProblemState` draws it as
the pane's recommended button.

## Limits

- A command is pasted, never run: the person reads it and presses Enter. Without a chat to paste
  into, the action copies the command instead.
- A packaged app starts with launchd's bare PATH, and Bun resolves a spawn that passes no `env`
  against the PATH the process started with, so `docker` in `/usr/local/bin` was reported as not
  found. A spawn without `env: toolEnv()` still has that defect.

## Related guides

- [Build workbench UI](plugin-ui.md)
- [Validate plugin route requests](plugin-routes.md)

## Source of truth

- [Prerequisite](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/prerequisite.ts)
  and
  [its recovery](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/ui/prerequisite-recovery.ts)
- [Host executables](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/executables.ts)
- [Typed errors](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/typed-error.ts)
- [Problem report hook](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/ui/use-problem-report.ts)
- [Problem state](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/ui/problem-report/ProblemState.tsx)
  and
  [the house-style check](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/ui/problem-report/house-style.test.ts)
