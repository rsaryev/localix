# Go

One slash command, `/go <goal>`, that turns a free-form goal into a coordinated team. The plugin is
a manifest only: the command renders a prompt and the agent does the work with tools it already has.
The product page is [docs/features/go.md](../../docs/features/go.md).

The prompt carries only the scenario: scope, plan, staff, approve, run and close. How a leader, a
member and `@human` behave comes from the system prompt and the Kanban roles, so `/go` adds no rules
of its own.

## Boundaries

The command adds no tool and no permission. Creating a specialist, inviting it and forking go
through the same approvals as anywhere else, and the board stays passive: a card never starts a run.
