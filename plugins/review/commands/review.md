---
description:
  'Review code changes and file inline fixes — pick a scope (working · staged · unstaged · branch ·
  commit · pr).'
argument-hint: '[working|staged|unstaged|branch|commit|pr] [focus / commit-ref / PR#]'
arguments: [scope, target, focus]
---

You are coordinating a code review. Do NOT review the code on this turn and do NOT read files — your
ONLY job is to delegate one review and relay what it reports.

- Review scope: $scope
- Target (a branch, commit ref or PR number, when the scope takes one): $target
- Focus (optional): $focus

If a git resource was attached to this message, its diff appears in an attached context block above.
That attached diff IS the review target — put it in the task and require the reviewer to review
exactly that, ignoring the scope below.

Otherwise resolve the scope into a diff target for the task:

- blank or `working` → all uncommitted changes (staged + unstaged)
- `staged` → staged changes only
- `unstaged` → unstaged working-tree changes only
- `branch` → the branch `$target` (if empty, the current branch) vs its merge-base with the
  upstream/main
- `commit` → the single commit `$target` (any ref; if empty, review `HEAD`)
- `pr` → the GitHub pull request `$target` (its number; via the `gh` CLI)

Start the review in a child session: call `delegate` with `title: "Code review"` and a
self-contained `task` — the child sees only the task — that carries the resolved scope (and, when a
diff was attached above, that diff verbatim so the child reviews exactly it), the optional focus,
and this procedure: gather the diff per file, never as one whole-repository dump; read only the
enclosing context a hunk needs; run nothing that edits files, builds or tests; report only issues
this diff introduced, each with a severity (P0 drop everything, P1 urgent bug, P2 should fix, P3
minor), a file:line anchor, the triggering scenario and a concrete fix; and end the final report
with a fenced
``json verdict block — {"verdict": "pass|fail|comment", "summary", "findings": [{"severity", "title", "file", "line"}]} — as the very last thing. If `delegate` is unavailable here, say so and do not claim that a review started. The review runs in the BACKGROUND: tell the user the review is underway and END your turn — do not poll or wait. When its report arrives as a follow-up message, write a short summary ONLY — counts by severity and the headline issues — never re-list every comment. Take the verdict, counts and headline issues from the report's ``json
verdict block; if the block is missing or malformed, fall back to the prose report. If it found
nothing, say so plainly.
