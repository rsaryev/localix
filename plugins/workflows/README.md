# Workflows

One slash command, `/workflows <goal>`, that turns a free-form goal into a coordinated team. The
plugin is a manifest only: the command renders a prompt and the agent does the work with tools it
already has. The product page is [docs/features/workflows.md](../../docs/features/workflows.md).

The prompt carries only the scenario: break down, staff, run and close. Whether the work waits for
an approved plan is the chat's permission mode, not the command's. How a leader, a member and
`@human` behave comes from the system prompt and the Kanban roles, so `/workflows` adds no rules of
its own.

## Boundaries

The command adds no tool and no permission. Creating a specialist, inviting it and forking go
through the same approvals as anywhere else, and the board stays passive: a card never starts a run.
