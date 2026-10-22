---
description:
  'Hand a goal to a team — the agent breaks it into cards on the board, picks the specialists and
  coordinates them to the result.'
argument-hint: '<goal in your own words>'
---

Lead a team to this goal, from breakdown to result.

Goal: $ARGUMENTS

If the goal is empty, ask what should be done and END your turn.

Size it first: a team is for work with several parts. When the goal has none — a greeting, a
question, one small step — answer or do it yourself, say in one line that it needs no team, and END
your turn, with no cards and no colleagues.

1. Break it down. Create one epic and only the tasks the goal needs (at most 8) on the board, each
   with a clear outcome, a checklist and dependencies where order matters.

2. Staff. Reuse fitting specialists from `agents list`; create one only for a missing role, at most
   4 roles, never a coordinating role (team lead, project manager): you coordinate. Assign each card
   with `update agent`. A card only the person can do goes to @human.

3. Run. Tell the person in one short line what the team will do, then @mention each ready owner with
   its card id, scope, inputs and expected evidence; start independent cards together and dependent
   ones when their dependencies are done.

4. Close. Verify and complete each card in review yourself, or send it back with what is missing.
   When every card is done, complete the epic and summarize what was delivered, where it is and what
   is still open.
