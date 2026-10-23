# Permission rules

Localix evaluates a permission policy before an agent tool call reaches its implementation. Use this
page to trace which rule decides that call.

## Terminology

| Term            | Meaning                                                                        | Boundary                                                 |
| --------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Permission rule | An ordered policy record evaluated for one tool call.                          | A rule can match only the facts extracted for that call. |
| Call facts      | The tool name, mutation class, paths, commands, and workspace root.            | Extraction is tool-specific.                             |
| Session grant   | A process-memory approval for one program, path, folder, or declared resource. | Dangerous commands and credential paths ignore it.       |
| Workspace root  | The project or Localix-created session directory.                              | It is a policy boundary, not an OS sandbox.              |

## Permission contract

| Mechanism       | Behavior                                                                 | Boundary                                                              |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Rule evaluation | The LAST rule that matches the call decides.                             | A call no rule matches is allowed.                                    |
| Whose rules     | The agent taking the turn owns them; there is no scope above it.         | A narrower role is a different agent, not a narrower scope.           |
| Shipped guards  | Every role includes outside-workspace and dangerous-shell question rows. | They follow its general tool allowances; later rows can still decide. |
| Session grant   | **This session** remembers the chosen breadth in the API process.        | A process restart or a different session asks again.                  |
| Permanent rule  | **Always** writes that breadth's rule into the asking agent's own list.  | Offered only when the rule would allow the call it answers.           |

## How it works

```text
the session's permission mode rewrites the agent's rules (once per run)
extract call facts + the tool's own class of the call (`AgentTool.classify`)
  -> host-root guard (hard deny, before every rule)
  -> evaluate the rewritten rules, in order
  -> allow, block, or request confirmation
```

### The host-root guard

The host-root guard blocks extracted paths into the Localix installation or source tree, unless that
tree contains the session's own project directory. Agents ordinarily work in `~/.localix` and in the
session project. Rules are the user's to edit, and a Bypass session stops asking, so this boundary
is not a rule: the gate refuses the call in code before any rule is evaluated, and no preset,
project rule or permission mode lifts it.

| Question               | Answer                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which directories      | Development: the checkout root (dev staging under `.turbo` included). Packaged: the server bundle's directory, its `resources/` or `server/` container, and the macOS `.app`. |
| Never a host root      | The filesystem root, the home directory or anything above it, and anything that contains or sits inside `~/.localix`.                                                         |
| Which paths are judged | File-tool targets, the bash cwd, a plugin tool's declared `permissionPaths`, and every absolute or `..` path token in a shell command, symlinks resolved.                     |
| The one exemption      | A host root that contains the session's own project directory: opening the Localix checkout as a project keeps working on it.                                                 |
| What the model is told | The path belongs to the Localix application itself; work in `~/.localix` and the project folder, and do not retry.                                                            |

The roots are computed once per process from the server module's own location
([`host-roots.ts`](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/host-roots.ts)),
the same self-location rule the bundled `plugins/` and `migrations/` roots use. For the same reason
a tool or plugin host given no cwd starts in `~/.localix/workspace`, never in the API's launch
directory, which is the host application; a source lint keeps `process.cwd()` out of agent-core.

### Rule fields

| Field        | Meaning                                                       | Boundary                                                      |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------- |
| `permission` | Matches one tool name, or `*`.                                | A glob, anchored — `tool:ba*` is a family, not a prefix scan. |
| `pattern`    | Matches a path, command, declared resource, or a named class. | Matching is lexical after any tool-specific path resolution.  |
| `action`     | `allow`, `ask`, or `deny`.                                    | None of the three is terminal; position decides.              |
| `message`    | Supplies the explanation shown for an `ask` or `deny`.        | It does not change evaluation.                                |

Rules are evaluated in order; the last match wins. Specificity has no separate priority: a broad
rule placed later can override a narrow one. A `deny` before a narrower `allow` creates an allowlist
with an exception, as in the shipped presets.

For example, these rows in **Permission rules** allow ordinary Git commands while asking about
dangerous commands:

| Position | Capability  | Resource    | Effect  |
| -------- | ----------- | ----------- | ------- |
| 1        | `tool:bash` | `*`         | `ask`   |
| 2        | `tool:bash` | `git *`     | `allow` |
| 3        | `tool:bash` | `dangerous` | `ask`   |

`git status` matches rows 1 and 2, so it is allowed. `git push --force` also matches row 3, so it
asks. Moving row 2 below row 3 would allow that force push. These rows illustrate ordering; keep the
preset's other guards when editing your list.

The editor stores these columns as `action`, `resource`, and `effect`. For live tool calls, Localix
projects them to the `permission`, `pattern`, and `action` fields above, removing the `tool:` prefix
from the tool name.

A skill's `allowed-tools` are evaluated as separate preapprovals after the original ordered policy
has decided. They can answer an ordinary matching tool or argument question; they cannot reorder the
policy, reopen a denied tool or lift a call-class confirmation such as `outside-workspace` or
`dangerous`. A deny followed by an authored allow remains an allowlist with an exception, even when
a skill declares `Bash(git *)`.

### Pattern matching

| Pattern               | Match                                                                                |
| --------------------- | ------------------------------------------------------------------------------------ |
| `*`                   | Every call selected by `permission`.                                                 |
| `outside-workspace`   | A resolved path outside the workspace root.                                          |
| `dangerous`           | A shell command classified as dangerous.                                             |
| `mutates`             | A call whose effect is anything but `read` or `view`.                                |
| `effect:<effect>`     | A call the tool classes as `read`, `view`, `session`, `files`, `host` or `external`. |
| `irreversible`        | A call the tool says cannot be undone.                                               |
| `needs-human`         | A call that waits on a person.                                                       |
| `documentation-files` | Every mutation target is a documentation file within the workspace.                  |
| `test-files`          | Every mutation target is a test/spec file or belongs to a test/fixture directory.    |
| `prototype-files`     | Every mutation target belongs to a mockup, design or prototype artifact.             |
| `git *`               | The `git` command, with or without arguments.                                        |
| `npm i*`              | An anchored glob — `*` stands for any run of characters.                             |

"Inside" is the session workspace plus the parts of `~/.localix` agents author — `workspace/`,
`tmp/`, `plugins/` (the user's own plugins) and `skills/` — for reads and writes alike, in every
role. The rest of `~/.localix` (the database, the vault, the captured login-shell environment,
backups) is outside, so touching it asks
([`workspace.ts`](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/workspace.ts)).

`outside-workspace`, `dangerous` and `mutates` are named CLASSES: they are computed from the call's
facts, not compared against its text. That is what makes them robust where a glob is not — `rm -fr`,
`rm -r -f` and `rm --recursive --force` are one class and three different strings.

The rules editor suggests the classes declared in
[`capability-resource-classes.ts`](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/capability-resource-classes.ts).
That list defines their predicates and the capability kinds they apply to.

An artifact's trust class (`bundled`, `opt-in`, `untrusted`) is in the same list and works the same
way in a rule, but it is a fact about the ARTIFACT rather than the call — so it applies to
`plugin:`, `mcp:` and `agent:` rules, never to `tool:`.

For a batch of shell commands, an `ask` or `deny` applies as soon as ONE command matches, while an
`allow` must cover EVERY command — and a line whose commands cannot be read (command substitution)
can never establish an allow. Read-confined tools resolve real paths, including symlinks, before
containment checks; a write or edit through a linked folder that points outside the workspace counts
as outside it. Plugin tools expose their targets through `permissionPaths`, and any tool can declare
native resources through `permissionResources`.

### The guards a shipped role carries

Every shipped role includes these rows after its general tool allowances:

| Permission  | Pattern             | Action | Purpose                                                  |
| ----------- | ------------------- | ------ | -------------------------------------------------------- |
| `tool:*`    | `outside-workspace` | `ask`  | Confirm reads or writes beyond the session workspace.    |
| `tool:bash` | `dangerous`         | `ask`  | Confirm commands matched by the shell danger classifier. |

The guards follow the roster's general tool allowances. This order makes an outside-workspace read
ask even though an earlier row allows the read tool. The guards win because they come later, rather
than because class patterns have a higher priority.

They are not necessarily the final rows. Role-specific restrictions follow them; a matching later
restriction can refuse a call instead of asking.

What **Always** writes is placed to keep that true. It must come after the rule that raised the
card, or it silences nothing. Appended at the very end it would also put `tool:bash git * allow`
after `tool:bash dangerous ask`, and the last match for `git push --force` would then be the allow.
So the new row goes in just before the trailing `dangerous`, `catastrophic` and `secrets` guards
that could decide the same calls: past everything else, never past a guard.

You can explicitly override a guard with a later row naming the same class, such as
`tool:bash dangerous allow`. Permanent approvals preserve the trailing guards so approving one
command does not silently allow every dangerous command.

The shell classifier recognizes specific destructive families, privileged execution, writes to real
device paths, force pushes, power commands, and common download-to-shell forms. It is a lexical
safety layer, not a shell interpreter.

### Rule effects

| Effect  | Permission effect                                 | Boundary                                                                   |
| ------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `allow` | The call runs.                                    | Attributed in the UI when a rule produced it, silent when nothing matched. |
| `ask`   | The call raises a confirmation card for the user. | With no human reachable, an unattended run refuses rather than proceeding. |
| `deny`  | The call is refused.                              | A later rule in the same list can still except it; nothing outside can.    |

A blanket `{*, mutates, ask}` rule is what "confirm every change" means, and it is also what makes a
run schedule its file tools sequentially, so the confirmations arrive one at a time.

A conversation's [permission mode](../features/permission-modes.md) never reaches the gate as a
flag. `capabilities/permission-mode-policy.ts` rewrites the agent's rules once per run: Bypass
removes tool questions about call classes and converts questions about named tools or commands to
`allow` in place, then adds a catastrophic-call denial. Autonomous uses the same rewrite and adds a
denial for calls needing a person. Plan appends file, host, and external-effect denials. Each mode
preserves the relative order of the retained agent rules.

Skill preapprovals never reorder this policy or override a denial. MCP hooks use the same tool
policy and call gate; an unattended hook cannot execute a call that requires confirmation. Without
`classify`, a tool with `mutates: false` is a read. A true or omitted mutation flag yields
`external`, which Plan refuses.

## Configuration

Edit rules in **Settings → Capabilities → Permission rules**. The picker selects whose list you are
editing; with no agent selected it is the default assistant's (`localix`), which is also the agent
that answers for work happening beside a turn rather than inside one.

The confirmation card offers **Approve** and **Deny**, a duration (**Once**, **This session**,
**Always**) and, on a path card, the folder level from which down not to ask; see
[Respond to human-in-the-loop requests](../features/hitl.md#confirm-and-session-grants). A path card
lists every path of the call, outside-workspace paths first, and a session grant approves the call
only when it covers all of them. The desktop permission chip and the `/permissions` command can
inspect or revoke current session grants. When no client can receive a confirmation request, an
`ask` decision is denied with an unattended-run explanation.

## Limits

- Permission rules are application policy, not an operating-system sandbox. A tool process retains
  the access granted to Localix by the host system.
- Shell path and danger detection is lexical and intentionally conservative. Indirection inside a
  script or executable can be invisible to the classifier.
- A path rule can act only on paths extracted for that tool. Plugin tools without `permissionPaths`
  do not expose their targets to path matching.
- A tool's mutation classification is code-defined. An incorrect classifier can send a call down the
  wrong policy branch.
- A session grant is scoped to its requester and program, path, folder, or declared resource, capped
  in memory, and does not survive an API process restart. A folder level is never offered at or
  above the home folder.
- Core `write` and `edit` calls under Localix-owned state receive a narrow host carve-out, and it
  still requires the rules to allow the call. Read tools do not receive that carve-out.

## Related guides

- [Capabilities](../features/capabilities.md)
- [Human-in-the-loop controls](../features/hitl.md)
- [Tool budget and controls](../features/tool-budget.md)
- [Plugin tools](../extending/plugins.md)

## Source of truth

- [Rule matching and evaluation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/permission-engine.ts)
- [The gate and its carve-out](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/permission-gate.ts)
- [The host-root guard](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/host-root-guard.ts)
  and
  [the host's own roots](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/host-roots.ts)
- [Call-fact extraction](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/permission-facts.ts)
- [The guards each shipped role carries](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/capabilities/builtin-agent-presets.ts)
- [Per-run rule assembly](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/permission-gate-build.ts)
- [Mode rewriting](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/capabilities/permission-mode-policy.ts)
- [Permanent-rule insertion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/capabilities/availability.ts)
- [Session grants](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/confirm-requester.ts)
- [Settings surface](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/ui/capabilities/PermissionRulesView.tsx)
