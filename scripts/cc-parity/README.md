# Claude Code parity

A black-box check that Localix hands a Claude Code mod what Claude Code hands it. Use it after each
Claude Code release, and whenever you change Localix's mods host (`apps/api/src/features/mods`), to
learn what the installed Claude Code does and where Localix differs.

## Terminology

| Term             | Meaning                                                                                         | Boundary                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Probe            | `probe/`, a mod in Claude Code's own format that records what its host gives it.                | It changes nothing: every hook passes the event on.                             |
| Shape descriptor | A value's key names and JSON kinds, such as `{ isAnswered: 'boolean', text: 'string' }`.        | Never a value, prompt or transcript (`probe/hooks/shape.js`).                   |
| Entry            | `{ kind, name, shape }`: an event's input (`event`), what `next(e)` gave (`result`), or a call. | One per name; repeated observations merge, a key seen only sometimes is `key?`. |
| Snapshot         | `snapshots/claude-code-<version>.json`, the entries one Claude Code version gave.               | Committed; our observations only.                                               |
| Surface          | `snapshots/claude-code-<version>.surface.json`: event, `$` method and render-site names.        | Identifiers our own parser extracted (`lib/surface.mjs`); no declaration text.  |

## Legal rules

These are not negotiable. Every change to this tool keeps them.

- Never inspect, `strings`, disassemble, unpack or read the Claude Code program or its bundled code.
  The tool uses only what a mod author has: running `claude` as a normal user, the type declarations
  Claude Code writes for a mod loaded with `--plugin-dir`
  ([Get type definitions for your version](https://code.claude.com/docs/en/plugins/mods/create.md)),
  and the public docs.
- Never commit Claude Code's own files or text: its generated `index.d.ts`, `tsconfig.json`, or doc
  text. Those stay in the gitignored cache, `.cache/cc-parity/`. The runner loads a copy of the
  probe from there, so Claude Code's generated files never land in `probe/`.
- Committed snapshots hold only our own observations reduced to shape descriptors and identifier
  lists. `snapshots.test.ts` fails a snapshot with any string that is not a kind or an identifier.
- A run that calls a model spends the person's own Claude Code usage. `observe` says so and runs
  only with `--allow-model`; the probe calls `$.model.*` only when its runner allows it.

## What you can do

| Command                                               | What it does                                                                     | Model use |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | --------- |
| `bun scripts/cc-parity/run.mjs types [--cwd <dir>]`   | Loads the probe in a short interactive session; caches the version's types.      | None      |
| `bun scripts/cc-parity/run.mjs observe --allow-model` | Two `claude -p` runs with the probe; writes the snapshot and surface.            | Yours     |
| `bun scripts/cc-parity/run.mjs diff <a> <b>`          | Prints entries and names added, removed or changed between two versions.         | None      |
| `bun scripts/cc-parity/run.mjs localix`               | Runs the probe in Localix's mods host; writes `snapshots/localix.json`, reports. | None      |
| `bun test scripts/cc-parity`                          | The parity test and the snapshot rules; about a second.                          | None      |

`types` starts `claude --plugin-dir <probe>` in a pseudo-terminal in `--cwd` (the repository root by
default), waits until Claude Code writes `.claude-plugin/types/claude-code/index.d.ts`, types
`/probe` (a mod command, answered without a model), and ends the session with two Ctrl-C. Run it
from a folder you have trusted: if the trust prompt blocks, it times out and says so. What the idle
session drew (`ui.render`) and what `/probe` saw are kept as
`.cache/cc-parity/<version>/interactive.json`.

`observe` runs `claude -p "/probe"` and one tiny turn on haiku that writes `note.txt` with the Write
tool in a temporary folder, in `acceptEdits` mode with `--allowedTools Write`. The probe's `/probe`
and first `turn.complete` also make three small `$.model` calls (`complete`, `fork`, `classify`,
`maxTokens` 16). The snapshot merges these runs with `interactive.json`.

`localix` loads the same probe into Localix's mods host in its production VM and fires the events
through the code production uses: the run scope `intake.ts`, `stream.ts` and `finalize.ts` call, the
gate's `tool.check` review, `runCommand`, and pane drawing. Only the ports are fakes: a model that
answers, so `$.model.*` runs Localix's own shaping code, and a conversation read through
`bootstrap/mods-session.ts` (`localix/drive.ts`).

## Update for a new Claude Code version

1. `bun scripts/cc-parity/run.mjs types`, then `observe --allow-model`. Commit the new
   `claude-code-<version>.json` and `.surface.json`; keep older versions for `diff`.
2. `bun scripts/cc-parity/run.mjs diff <previous> <version>` shows what Claude Code changed.
3. `bun scripts/cc-parity/run.mjs localix` writes `snapshots/localix.json` and reports against the
   newest snapshot; `bun test scripts/cc-parity` fails when a checked entry no longer matches.
4. Fix Localix, or record the difference in `known-gaps.json` with a reason. Move an entry that
   matches into `checked.json`; the test also fails a known gap that has started to match.

## Read the report

Each entry has one status, and a known gap's reason is printed under it:

| Status                        | Meaning                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `same`                        | Localix's shape is Claude Code's.                                  |
| `different shape`             | `path: claude-code ≠ localix` lines, then both shapes.             |
| `missing in Localix`          | Claude Code fired the event or answered the call; Localix did not. |
| `not observed in Claude Code` | Localix gave it; the Claude Code runs did not reach it.            |

A key one side shows only sometimes (`key?`), a kind one side's union already holds, and a key set
to `undefined` are variants, not differences: two runs cannot show every variant.

## Limits

- Shapes, not values: a path that is relative where Claude Code's is absolute reads `same`.
- Only what the runs reach is compared. `-p` draws nothing, so render sites come from `types`.
- Settings are recorded as `object` only: their keys are the person's own.
- `probe/` must keep Claude Code's static-analysis rules; check it with `claude plugin validate`.

## Source of truth

- [run.mjs](run.mjs), [lib/](lib), [probe/hooks/register.js](probe/hooks/register.js)
- [localix/drive.ts](localix/drive.ts), [parity.test.ts](parity.test.ts),
  [snapshots.test.ts](snapshots.test.ts)
