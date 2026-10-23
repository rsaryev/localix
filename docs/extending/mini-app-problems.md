# Report mini app failures

A mini app reports a failure as a problem the person can act on: one line inside a surface that
still shows something, a centred state when the failure is the whole pane, and the one action that
fixes it. Use this page when a mini app calls its own backend or an external program such as Docker,
git or `gh`.

## Terminology

| Term         | Meaning                                                                  | Boundary                                                                    |
| ------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Problem      | A failure's message, code, detail, and request inside a `ProblemReport`. | The hook publishes the report and returns surface props.                    |
| Prerequisite | An external program the mini app needs, and the state it is in.          | `missing`, `stopped` or `signed-out`.                                       |
| Recovery     | An offered action for a prerequisite.                                    | Requires an install URL or command; recovery is not verified automatically. |

## What you can do

Render what `useProblemReport` returns: `ProblemLine` inside a surface that still shows something,
`ProblemState` when the failure is the whole pane. `ProblemState` supplies the centred layout,
primary action, and quieter detail links. Put engine output in `Problem.detail`; it belongs in Event
Center rather than the surface headline.

Put the code in `Problem.code` and the failed call in `Problem.request`; the Event Center traces
exactly that request. An API error built with `problemRequestOf(response)` from
`@localixai/mini-app-sdk/ui/transport` carries it, and `miniAppFailureFacts(error)` spreads code,
detail, request and prerequisite into a problem.

When the failure is an external program that is missing or stopped, say so as a `Prerequisite`
(`@localixai/mini-app-sdk/prerequisite`) instead of a sentence with a Retry under it:

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
`resolveExecutable(name)` from `@localixai/mini-app-sdk/backend`.

In the UI, `prerequisiteProblem(prerequisite, { code, detail, request })` builds the problem and
`usePrerequisiteRecovery(prerequisite)` the action; mark it `primary` and `ProblemState` draws it as
the pane's recommended button.

### Own the problem through recovery

Call `useProblemReport(report, options)` unconditionally in the component that owns the failure.
Pass `null` when the operation is healthy; conditionally render the returned surface props. Mounting
the owner only while an error exists leaves the Event Center row unresolved when that owner
disappears. Closing a tab deliberately does not settle its standing problem.

Use one owner per scope and subject. If two views report the same subject, hoist ownership to their
common parent so one view recovering cannot clear the other's error. When the subject changes, the
publisher settles the old subject before publishing the new one.

Repeated polls with unchanged problem content keep the original request as the recorded cause.
Changing only the request id does not republish the report. Include the failed request initially; do
not expect the record to track every subsequent failed poll.

For `missing`, supply an HTTPS `installUrl`. For `stopped` or `signed-out`, supply a single-line
`command` without control characters. Without the corresponding value, the prerequisite still shows
a hint but has no primary recovery action. The recovery helper already marks its action `primary`.

## Limits

- Command recovery sends text to the chat's active terminal, opening its tab and waiting for a pane
  when needed. The channel strips trailing line feeds but preserves interior newlines; use a
  single-line command for review before Enter. Without a chat, the helper attempts clipboard copy.
- Recovery does not automatically retry the failed operation or prove a service is ready. Retry
  after installing, starting, or signing in, then clear the report when the operation succeeds.
- Host executable lookup uses the current PATH plus existing supported install directories. A
  missing executable can mean Localix cannot find it, even when it is installed elsewhere. Use both
  `resolveExecutable` and `env: toolEnv()` rather than assuming a GUI app inherited your shell PATH.

## Related guides

- [Build workbench UI](mini-app-ui.md)
- [Validate mini app route requests](mini-app-routes.md)

## Source of truth

- [Prerequisite](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/prerequisite.ts)
  and
  [its recovery](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/ui/prerequisite-recovery.ts)
- [Host executables](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/executables.ts)
- [Typed errors](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/typed-error.ts)
- [Problem report hook](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/ui/use-problem-report.ts)
- [Terminal recovery input](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/terminalBus.ts)
- [Problem state](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/ui/problem-report/ProblemState.tsx)
  and
  [the house-style check](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/ui/problem-report/house-style.test.ts)
