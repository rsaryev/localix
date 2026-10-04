# External Agents Workspace

This bundled plugin launches supported coding-agent CLIs in Localix terminals and presents their
live delegations and local session history in one workspace.

Use it when a task must run in an external CLI while the parent Localix session keeps a bounded,
inspectable link to the work.

## Capabilities

- Launch a supported CLI in an interactive Localix terminal.
- Read a delegation's live state by observation — no cooperation from the CLI is required.
- Correlate a live terminal with the CLI's native session history.
- Browse bounded transcript slices without copying an entire history into model context.
- Wait for one or several delegations to reach a requested lifecycle state.
- Attach an external session as a `localix://resource/external-agent/...` context reference.

Live and historical sessions share the stable key `<provider>:<native-session-id>`. Pending
delegations use a terminal-scoped key until correlation finds the native history.

## Supported adapters

| Adapter        | Local history source     | Interactive launch command       |
| -------------- | ------------------------ | -------------------------------- |
| Claude Code    | Project JSONL trees      | `/external-agents:claude <task>` |
| Codex          | Session JSONL trees      | `/external-agents:codex <task>`  |
| OpenCode       | Local SQLite database    | History only                     |
| Gemini CLI     | Project chat recordings  | History only                     |
| GitHub Copilot | Session-state event logs | History only                     |
| Hermes         | Local SQLite database    | History only                     |

The adapter registry is the authoritative support matrix. “History only” means that Localix can
index and read an existing local history but this plugin does not provide a launch command for that
CLI.

## Launch contract

The two launch commands refine the requested task and open the CLI in a pane whose command declares
`LOCALIX_AGENT=<provider>` and, when known, `LOCALIX_AGENT_CWD=<dir>`. Those declarations are the
whole contract: they are what makes a pane a delegation, and what lets correlation find its native
history. Nothing is injected into the delegated CLI's prompt.

**No report-back protocol.** A delegation is not asked to message the parent session. State comes
from what can be observed — the rendered screen classified against a detection manifest, and the
CLI's own transcript — because a mechanism that depends on the foreign agent following an injected
instruction fails silently when it does not, and silence is indistinguishable from work.

The command implementation and the bundled driving skills own the exact terminal interaction. Do not
copy their launch strings into this README because CLI flags and approval screens can change.

## Agent tool

The plugin registers the read-only `external_agent_sessions` tool. Its main actions are:

| Action       | Result                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| `roster`     | Lists live delegations and indexed history with stable provider keys.  |
| `explain`    | Explains one session's observed state and supporting evidence.         |
| `transcript` | Returns a bounded transcript window for one session.                   |
| `wait`       | Waits for `any` or `all` requested keys to reach selected states.      |
| `context`    | Returns bounded transcript context for several sessions.               |
| `stats`      | Aggregates only usage fields that the source history actually reports. |

Transcript reads have event and character caps. The result reports the total available event count
and whether the source was truncated so callers do not mistake a window for a complete transcript.

## State detection

Live state is derived from declarative screen manifests. A provider without a matching manifest, or
an ambiguous screen, reports `unknown`; the plugin does not infer success from silence.

Lifecycle labels describe observed terminal state:

- `working`
- `blocked`
- `idle`
- `done`
- `unknown`

They are coordination signals, not proof that a delegated change is correct. Verify the resulting
diff and checks in the owning Localix session.

## How the roster stays current

The backend watches each provider's history root with the runtime's native file watcher
(`backend/live/history-watch.ts`) while a roster is open, and pushes a coalesced notice on the
realtime socket (frame `e`, `shared/history-stream.ts`) when an agent writes to it. The panel
re-reads on that notice, so a quiet machine is not re-scanned on a timer.

| Situation                          | Roster cadence                                                  |
| ---------------------------------- | --------------------------------------------------------------- |
| Watch armed, no running delegation | On each notice (at most one per 5 s), plus a 5 min backstop     |
| A delegation is running            | Every 5 s — its state is read from a screen, which has no event |
| Watch unavailable or socket down   | The activity-based cadence in `ui/model/refreshPolicy.ts`       |

A `wait` finds each delegation's log once and re-reads it when the file changes; its 2 s tick
remains for the terminal screen and as a backstop for writes a file watch can miss (a SQLite
database's WAL).

## Privacy and security boundaries

- History adapters read provider-owned files; they do not modify those histories.
- Indexes and cached summaries stay in Localix state.
- Launching a CLI executes a separate local process with the permissions granted to that process.
- A launched CLI can make its own provider network requests.
- Live state is inferred from a screen and a transcript, so it can be wrong in ways a cooperating
  agent's own report could not be: `unknown` is never treated as success, and an unconfirmed `idle`
  says so.
- Transcript and usage coverage vary by provider. Missing token fields are reported as missing, not
  reconstructed.
- Paths and transcript text can contain sensitive project data. Review attachments before sharing or
  exporting them.

This plugin is an integration boundary, not an operating-system sandbox.

## Limits

- Correlation is best effort until a provider writes a native session record.
- Provider file formats can change independently of Localix.
- Large histories are indexed incrementally and read through bounded windows.
- Sub-sessions are shown only when the provider format exposes a stable parent relationship.
- Usage totals are not comparable across providers unless their source fields have the same
  semantics.
- Waiting observes lifecycle state; it does not keep a terminal process alive or approve prompts.

## Development

Keep provider-specific behavior inside one adapter descriptor. Adding an adapter requires a stable
identity, root discovery, cheap source enumeration, bounded transcript parsing, fixtures, and tests.
Adapters must remain read-only with respect to provider-owned data.

Run the plugin-focused checks from the repository root:

```bash
bun run test:dropins
bun run type-check
bun run check:tests
```

## Source of truth

- [`plugin.json`](plugin.json) — manifest, commands, skills, and public description
- [`backend/adapters/registry.ts`](backend/adapters/registry.ts) — supported history adapters
- [`backend/adapters/types.ts`](backend/adapters/types.ts) — adapter contract and read limits
- [`backend/detection/`](backend/detection/) — declarative live-state evaluation
- [`backend/resource-provider.ts`](backend/resource-provider.ts) — resource attachment expansion
- [`shared/launch.ts`](shared/launch.ts) — the launch declaration format both halves derive from
- [`ui/marks/ATTRIBUTION.md`](ui/marks/ATTRIBUTION.md) — mark provenance and redistributed licenses
- [`skills/driving-claude-code/`](skills/driving-claude-code/) — launch interaction reference
- [`skills/driving-codex/`](skills/driving-codex/) — launch interaction reference
