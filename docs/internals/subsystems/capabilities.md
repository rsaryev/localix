# Capabilities internals

Registry data describes what is installed; policy describes what may run. Read this before adding a
capability kind, changing a switch, or wiring a new consumer of availability.

## Terminology

| Term        | Meaning                                                               | Boundary                                                     |
| ----------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Kind        | `tool`, `skill`, `plugin`, `mcp`, `agent` — how a capability is named | The prefix of an action; the rule store knows nothing else   |
| Rule        | `{action, resource, effect}`, ordered, belonging to one agent         | A switch is the case where `resource` is `*`                 |
| Verdict     | The answer, plus the rule that produced it                            | The LAST matching rule decides; there is nothing to compose  |
| Trust class | What an artifact IS — bundled, opt-in, untrusted                      | A fact carried into the rule as its resource; not a decision |
| Source      | An installed plugin, MCP server, or registry agent, with its config   | Availability is not a column on it                           |

An agent owns its rules and there is no scope above it. A run resolves the list of the agent whose
turn it is, in order, and that is the whole policy. Work that happens beside a turn rather than
inside one — a `/skill` listing, the boot-time plugin load, the effective-configuration report —
asks the agent that always exists (`DEFAULT_AGENT_ID`, the undeletable `localix`), so nothing ever
resolves to "nobody".

## What you can do

| Operation                     | Mechanism                                                                     | Boundary                                                            |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Change what an agent permits  | `POST /rpc/capabilities/rules/apply` — a list of `{action, resource, effect}` | Answers with the whole new snapshot, so no follow-up read is needed |
| Write a permission rule       | `PUT /rpc/capabilities/rules` replaces one agent's ordered list               | Whole-list; order is the semantics and a patch could not express it |
| Read what an agent can do     | `GET /rpc/capabilities/snapshot`                                              | Stamped with a revision; a client holding it knows if it is behind  |
| Narrow a role                 | Edit that agent's list, or make a new agent                                   | A role narrower than another IS a different agent                   |
| Add a capability kind         | Add a prefix to `ACTION_PREFIX`                                               | A kind with no members is a branch every reader must check          |
| Consume availability in a run | Take `availability` off the prepared run context                              | Never re-read the store: the run resolved its rules once            |

Both routes take `projectId` and `agentId`, and they answer different questions: the project says
what is LISTED (the plugins, MCP servers and skills installed there), the agent says whose RULES are
read and written.

The snapshot's revision (`apps/api/src/features/capabilities/revision.ts`) starts at the API
process's boot time in milliseconds and only grows, so it stays monotonic across a restart: a client
that outlived the old process drops answers older than the one it holds, and a counter restarting at
0 made it drop every answer of the new one. Every mutation owner bumps it and pokes clients — a
plugin toggle, an MCP change, and the agent's own `skill` save or delete, which reaches the host
through an injected port rather than an import.

## How it works

```text
capability_source                     capability_rule
  what is installed                     what may run
  (kind, project, name, config)         (agent_id, position, action, resource, effect)
        |                                        |
        +-------------- catalog ----------------+
                          |
        effectFor(kind, name, trustClassOf(item))
                          |
              plugins / MCP / agents / tools / skills
```

### The pair

`capability_source` holds one row per installed plugin, MCP server, or registry agent:
`(user_id, kind, project_id, name)` with an opaque `config`. It replaced four tables that were the
same nine columns spelled three times plus a fourth that differed by two fields it never queried on.
`config` is the kind's own JSON — a plugin's declared settings, an MCP server's transport and
connection details — which is what keeps the table agnostic. Columns for those would sit null on
three kinds out of four.

`capability_rule` holds the decisions. A switch and a permission are the same statement: `tool:bash`
over resource `*` with effect `deny` turns the tool off; the same action over `git push*` with
effect `ask` leaves it on and prompts.

`capability_policy_revision` versions each user's per-agent policy, including an empty one. The
rules editor must supply its loaded revision when saving; conflicting saves write nothing. Narrow
switch changes recompute against the current rules inside a transaction.

### Registered agent policy review

The same Capabilities rule editor handles registered agents. Its read response includes the owning
project, registration revision and proposed native rules. Proposals appear separately and remain
inert until the user adds them to the draft and explicitly publishes the complete reviewed policy.
Every edit applies deliberately: the editor holds it and an explicit **Apply** writes it. It used to
save 300 ms after each keystroke, and a rule field is typed one character at a time, so `tool:ba`
was persisted on the way to `tool:bash`. Invocation and other non-tool actions retain their native
action names in the editor.

Publication checks both loaded revisions and atomically writes the policy and its
`capability_policy_binding`. A later registration or policy change requires another review. A
conflict retains the draft and offers an explicit reload. Publication applies exactly the reviewed
rules; availability is not inferred from an import. Policy review follows the owner and stable ID
even when the definition belongs to a project; invocation still requires the correct project scope.

`apps/api/src/features/agents/registration-policy.ts` owns the registration review operation;
`apps/ui/src/features/settings/ui/capabilities/PermissionRulesView.tsx` uses the shared editor and
`apps/ui/src/features/settings/ui/capabilities/RegistrationPolicyReview.tsx` displays proposals.
This applies to contributions published in the native registry. Verified bundled manifests are
reconciled by `apps/api/src/features/plugins/sync-bundled-contributions.ts`; installed third-party
declarations do not receive automatic publication or authority.

### One list, and the last match wins

A list is ordered from general to specific, so the last rule that matches is the more specific
statement and it decides: `tool:bash * allow` then `tool:bash rm * deny` means "bash is fine, except
rm". A positive list closes its kind the same way — `tool:* * deny` first, then an `allow` per name.

There is ONE resolution rule, and no effect is special. A `deny` is not terminal: written before a
narrower `allow` it is an allowlist with an exception, which is the shape every preset uses.

`projectCapabilities` removes tools denied for every call before the registry builds their schemas.
A narrower `allow`, or an `ask` that names the tool, keeps a reachable candidate registered. A
wildcard `ask` does not reopen a closed allowlist. `resolve.test.ts` and `runtime-policy.test.ts`
cover both projection and call-time enforcement.

What the rules do NOT arbitrate is a name the catalog does not carry. `RESERVED_NON_TOOL_NAMES`
(`agent-core/tool-names-reserved.ts`) is core-owned machinery — `activate_tools` is built from the
run's own deferred set after assembly — so the roster never offers it and the projection can never
deny it. The gate skips those names for exactly that reason: the alternative was a blanket `tool:*`
deny, written about capabilities, making an already-permitted tool unreachable through its loader.

What this replaced was a three-scope chain — `global → project:<id> → agent:<id>` — composed by
taking the STRICTEST verdict, plus a separate baseline the permission engine evaluated alongside it
with two more resolution rules of its own. The chain bought monotonicity: nothing below could
re-enable what something above forbade. It cost more than it bought. "Usually not, but here yes" was
inexpressible; every reader had to know which half of the chain it was allowed to consult; and one
question had three places to be answered from, so "why is this tool off" was a search rather than a
read.

The user-facing consequence is deliberate: a limit is a property of a role, and a role is chosen by
the same person who wrote the limit. What that stops is not the user — it is the QUIET removal. An
**Always** on a card writes `tool:bash` over the program it showed, or `tool:read` over the folder
the person picked, and both can match a call a guard is about (`git push --force`, a `.env` in that
folder). So the confirmations every shipped role carries sit LAST in its preset
(`builtin-agent-presets.ts`), and the writer inserts an **Always** row just before them rather than
after (`persistPermissionRule` in `availability.ts`): past the rule that raised the card, never past
a guard.

Two constraints survive unchanged: the internal-directory carve-out still requires the rules to
allow the call, and an `ask` with no reachable approval handler blocks it.

`apps/api/src/features/agent-core/capability-call-match.ts` matches capability resources against
extracted call facts using the capability glob grammar. Command allow rules must cover every parsed
command; unknown shell expansion cannot establish an allow. Session permission hints retain their
existing matching grammar.

### Trust is a FACT about the artifact, not a second decision

`ext/trust.ts` classifies what an artifact IS — `bundled`, `opt-in`, `untrusted` — and that class
travels into the rule lookup as the resource, exactly as `dangerous` does for a shell command. So
`plugin:* untrusted ask` is an ordinary row, `plugin:office * allow` is the ordinary row that
answers over it, and a catalog asks one question:

```text
availability.effectFor(kind, name, trustClassOf(item))
  → a matching rule, or what the class means when nothing matches (`trustFallback`)
```

What this replaced was a decision table (a since-deleted `ext/enable` module) combined with a
three-valued `decided()` through a `??`. Two owners answering one question, and each call site free
to combine them slightly differently — which is how `?? true`, `?? isEnabledByDefault(...)` and
`=== true` all came to mean "available" in different files.

The classes and what silence means:

| Class       | What it is                                       | With no rule |
| ----------- | ------------------------------------------------ | ------------ |
| `bundled`   | Ships with the app; no code, or opted in.        | `allow`      |
| `opt-in`    | Ships with the app, imports code, stayed silent. | `ask`        |
| `untrusted` | Anything that did not ship with the app.         | `ask`        |

`ask` rather than `deny` for the last two, because the artifact is on disk only because someone put
it there: the honest default is a question, not a silent nothing — which is what an unexplained
"off" had been for every dropped-in plugin. The bundle boundary is absolute: a manifest is written
by whoever wrote the plugin, so its own `defaultEnabled: true` cannot promote it out of `untrusted`.

A plugin waiting on that question is NOT loaded — its code is never imported, which is the point —
so its tools cannot be listed either: a manifest declares entry FILES, not tool names. The prompt
says the honest thing instead (the plugin is here, nobody has allowed it, its tools are unknown
until someone does) and `configure` carries the one click that settles it, through the same HITL
card every other proposal uses.

### An enabled plugin's tools are inspected once, not once per launch

The snapshot inspects an enabled native plugin by importing its backend and running `register()`.
`apps/api/src/features/plugins/inspection-store.ts` persists successful inspections in
`~/.localix/cache/plugin-inspection-cache-v1.json`. Cache identity includes the manifest, config
digest, entry-file stats, user, working directory, host build, and plugin code fingerprint.

Enablement, configuration, installation, removal, and `/plugin reload` invalidate the entry. Failed
inspections are never cached; an unreadable cache is treated as empty.

The client publishes the snapshot's enabled plugins and tool roster together. A plugin UI not yet
registered is `pending` (`apps/ui/src/shared/contrib/miniAppActivation.ts`), so its restored tabs
remain open. Failed imports retry on the startup backoff
(`apps/ui/src/shared/contrib/miniAppUiLoads.ts`); exhausted retries become `failed`, while retaining
the tabs. A later snapshot publish retries the import. A request that fails before publishing cannot
settle another pass's pending work.

### A role's defaults are a SEED, not an overlay

Native definitions carry authored behavior, model preferences, limits and context selection. Policy
is separate and keyed by immutable agent ID. Every turn admits the definition and policy from the
same catalog snapshot. `builtinAgentPreset` supplies shipped policy candidates and
`seedAgentPresets` seeds them independently of portable definitions.

Once per PRESET VERSION, and not continuously, because a definition that kept re-asserting itself
would make the Capabilities screen a liar: you would switch something on and the next boot would
switch it back. Between versions the rows belong to the user.

The source config records `AGENT_PRESET_SEED_VERSION` and the shipped baseline. A version change
advances an untouched policy while retaining explicit enable choices. A customized ordered list is
preserved, because merging individual rows could change which exception wins. Known v10 defaults can
migrate; an unknown legacy baseline is preserved. Publication uses the expected policy revision, and
a conflict is retried rather than marked as an applied upgrade.

A positive list CLOSES its kind — `deny tool:*` first, then an `allow` per name — because a list of
allows on its own narrows nothing: absence of a rule already means allowed (or, for an artifact,
what its trust class says). The last match wins, so the allows carve exceptions out of the leading
denial — and a row the user appends after the preset is the more recent statement, which is how a
seed stays a seed.

Between versions the way back is the editor's, not the seeder's. `readRules` answers an agent scope
with `defaults` — `builtinAgentPresetFor(agentId)`, which is null for every agent the user or an
extension owns — and the Permission rules tab offers **Reset to defaults** exactly while the stored
list differs from it. Reset STAGES that list rather than writing it, so the shipped answer is read
on screen before **Apply** replaces anything; the write is the ordinary rules save, so the revision
check still refuses to land on top of a newer one. A second seeding path would have had to answer
"may I overwrite this" all over again; a read plus the existing write does not.

A grant also has to be REACHABLE. A preset names candidates; whether a run holds one is the ledger's
answer, and its first layer is the shape — so an allow no host surface carries is a claim the
product does not honour, not a harmless extra. `builtin-team.test.ts` fails on any such grant, with
a positive control.

Two cases the seeder refuses. An agent whose record states nothing is left alone entirely — no rows
and no marker, so a record that later grows a preset is seeded then. And an agent whose list already
has rules with NO marker at all is an install that configured it by hand before presets existed: it
is recorded as current and nothing is written, because those rows were never ours to replace. A
version bump only replaces a policy that still matches a known shipped baseline.

Managed bundled plugins publish native agent contributions into each exact registry scope before
agent catalog reads. Their verified policy proposals can seed defaults and bind policy review to the
registration revision. User-installed lookalikes receive no such grant. An instruction-only update
can retain a valid policy review; policy changes with custom rules require review. Removed
declarations are archived, and source denials withdraw the registered agent immediately.

### A rule can say who wrote it

`Rule.origin` records an agent-proposed rule: the session that proposed it and the proposal id,
stored in `capability_rule.origin_json`. It is provenance only — `evaluate` never reads it — so a
proposed rule composes exactly like a hand-written one. The Capabilities screen uses it to say which
session asked, and the proposal itself is kept in `config_proposals` with what the user decided.

The agent proposes through `configure`; the write goes through the paths described above, under the
user's approval. See `apps/api/src/features/config-proposals/registry.ts`.

### The ledger: one verdict per tool, per run

Availability answers "may this agent use X". Whether a RUN actually holds a tool is a different
question with three more inputs. Answering it with several unrelated mechanisms that record no
reason would leave a tool simply absent, and the prompt, the settings screen and the model would
each reconstruct why on their own, so one function answers it and records the reason.

`apps/api/src/features/agent-core/tool-ledger.ts` is the one decision function. Five layers, in
order, each owned by a different party, and monotone — a lower layer never returns what an upper one
took:

| Layer     | Owner       | Declared in                                                                |
| --------- | ----------- | -------------------------------------------------------------------------- |
| Shape     | The tool    | `exposure` in `apps/api/src/features/agent-core/tool-names.ts`             |
| Authority | The host    | `availability.requiredCapabilities` against the run's granted capabilities |
| Model     | The tool    | `requiresModelInput` against the run model's input modalities              |
| Policy    | The user    | The agent's capability rules, read in order                                |
| Economy   | Measurement | `apps/api/src/features/chat/runtime/run/tool-deferral.ts`                  |

The model layer keeps a text-only model from being offered what it cannot read: a tool whose whole
output is a picture declares `requiresModelInput: ['image']` and is withheld. `read` is not such a
tool — a text-only model needs it for everything else — so its `forModel` variant answers an image
with its format, size and dimensions in text. A tool with only some model-dependent actions declares
`forModel` instead and returns its own variant for the run's model — `browser` keeps every action
but `take_screenshot`. An unknown model is not judged. Both declarations live on the tool, so a
plugin or MCP tool uses them the same way (`tool-model-layer.test.ts`).

A remedy is attached to `policy` reasons only. Shape, authority and model cannot be lifted by a
click, so they are never proposed to the model — which is also what keeps a sub-agent from being
told about a tool it can structurally never hold.

### One resolve per run

A run resolves its rules once, in `resolveCapabilities` (`capabilities/resolve.ts`), and carries the
result on the prepared context as `availability`. The plugin loader and the MCP gather read it from
there. A second read downstream could only produce a different answer, which is the exact failure
this subsystem exists to prevent: the settings screen and the run disagreeing.

### Composer tips

The capability snapshot also supplies the composer tip pool. The server derives the copy and
availability gates; the client selects and paces eligible tips.
[Composer tip contracts](composer-tips.md) cover triggers, ranking, timing, and quick actions.

## Limits

- A rule lookup has ONE fallback. A per-ARTIFACT default is a trust class carried into it
  (`ext/trust.ts`), never a table of per-kind constants.
- The default agent's editor does not offer a disable action, but explicit capability rules still
  apply. Missing or denied agent identities cannot fall back to a different agent at execution.
- There is no "enabled" in the store or on the wire. A switch in Settings is sugar the CLIENT
  applies (`apps/ui/src/shared/contrib/capabilityRules.ts`): it sends the rule the switch stands
  for. A second vocabulary on the server meant a translation at one seam per kind, and each seam had
  drifted into its own idea of what "on" writes.
- An MCP server's tools are rules too — `mcp:<server>/<tool>`. A per-server tool list on the stored
  config would be unscoped, so a role could not narrow a server, and part of the connection cache
  key, so hiding one tool would reconnect the server.
- A row in `capability_source` is per `(user, kind, project, name)`, so a project still decides what
  is installed where. An agent's _rules_ are keyed by AgentId alone. Identically named definitions
  in different places have distinct IDs and do not inherit each other's rules.

## Related guides

- [Composer tip contracts](composer-tips.md)
- [Tools](../../features/tools.md)
- [MCP](../../features/mcp.md)
- [Plugins](../../extending/plugins.md)
- [Permissions](../../features/permissions.md)

## Source of truth

- [Rule shape and composition](../../../apps/api/src/features/agent-core/capability-rule.ts) ·
  [capability-rule.test.ts](../../../apps/api/src/features/agent-core/capability-rule.test.ts)
- [The resolver](../../../apps/api/src/features/capabilities/resolve.ts) ·
  [resolve.test.ts](../../../apps/api/src/features/capabilities/resolve.test.ts)
- [Availability read and write](../../../apps/api/src/features/capabilities/availability.ts)
- [Seeding a role's defaults](../../../apps/api/src/features/capabilities/seed-agent-presets.ts) ·
  [seed-agent-presets.test.ts](../../../apps/api/src/features/capabilities/seed-agent-presets.test.ts)
- [Rule storage](../../../apps/api/src/features/capabilities/rule-repository.ts)
- [Source storage](../../../apps/api/src/features/capabilities/source-repository.ts)
- [Trust classes](../../../apps/api/src/features/ext/trust.ts) ·
  [trust.test.ts](../../../apps/api/src/features/ext/trust.test.ts)
- [Catalog fusion](../../../apps/api/src/features/ext/catalog.ts) ·
  [catalog.test.ts](../../../apps/api/src/features/ext/catalog.test.ts)
- [The write path](../../../apps/api/src/features/capabilities/apply.ts) ·
  [apply.test.ts](../../../apps/api/src/features/capabilities/apply.test.ts)
- [Applying rule changes](../../../apps/api/src/features/capabilities/rule-changes.ts) ·
  [rule-changes.test.ts](../../../apps/api/src/features/capabilities/rule-changes.test.ts)
- [Snapshot composition](../../../apps/api/src/features/capabilities/snapshot.ts)
- [Persisted tool inspection](../../../apps/api/src/features/plugins/inspection-store.ts) ·
  [inspection-store.test.ts](../../../apps/api/src/features/plugins/inspection-store.test.ts)
- [Schema](../../../apps/api/migrations/20260601T000000_init_schema.ts)
