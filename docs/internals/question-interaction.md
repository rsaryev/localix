# Interface patterns

This file records accepted patterns for future interface work. Its current scope is agent questions
in chat; it does not define a replacement for the application's shared design system.

## Direction and hierarchy

Keep the existing compact, monochrome workspace UI. Reuse semantic theme tokens and shared controls.
The question and its choices carry the strongest emphasis; context, progress, and keyboard hints are
quiet. Use one solid primary action and ghost secondary actions. Do not introduce a separate
palette, decorative elevation, or a new card shell for queued questions.

Use the composer's existing surface, subtle border, and `--radius-composer` (22px). Inside it,
separate the action footer with `border-border-soft` rather than another elevated container. The
queue strip remains a navigation and summary surface, not a second place to answer.

## One answering area

- Clicking a queued question or its `Answer` action opens it in the same composer interaction area
  as a waiting ask. Show only one question form at a time; hide the message input while it is open.
- Keep the queue available as navigation. Selecting a different question replaces the active form.
- `Answer later` closes the form and restores the message composer without submitting an answer.
  Preserve the message draft. Do not promise to preserve a partially completed question form.
- Closing a queued question only changes local UI state. The question remains available in the queue
  without an automatic expiry.
- For a waiting ask that supports deferral, `Answer later` moves the question into the queue and
  releases the agent from waiting. No option is chosen; the agent may continue independent work.
- The close button and Escape have the same meaning as `Answer later` when deferral is available.
  `Skip` for queued questions and `Deny` for waiting asks remain separate, explicit actions.
- Only offer waiting-ask deferral when the request advertises that capability. Do not apply ask
  deferral to confirmation or secret requests.

Public interface labels are English. Use `Answer later` rather than `Collapse`: the label explains
that the question remains available. Keep `Send answer` for queued answers and the existing
`Approve` action for waiting asks. Show `Back` only for a request containing multiple questions.

## Shared geometry and typography

Use the existing rem spacing steps and theme typography, respecting the configurable root font size.
The nominal root is 14px; do not treat rem-based spacing as fixed pixels.

| Element             | Existing treatment                                                      |
| ------------------- | ----------------------------------------------------------------------- |
| Frame, inline       | `px-3 pt-2.5 pb-3`; body starts at `mt-3`                               |
| Frame, dialog       | `px-4 pt-3.5 pb-3.5`                                                    |
| Inline footer       | `mt-3 border-t border-border-soft pt-2.5`                               |
| Dialog footer       | `mt-3.5 border-t border-border-soft pt-3`                               |
| Body height         | Inline: `min(38vh, 22rem)`; dialog: `min(60vh, 30rem)`                  |
| Action group        | Right aligned, wrapping, `gap-1.5`, constrained to available width      |
| Action buttons      | Shared `Button`, size `lg`: 32px high, `px-2.5`; primary variant `mono` |
| Question text       | `text-sm`, medium weight, foreground, wrapping                          |
| Context title       | `text-xs`, medium weight, `text-text-strong`                            |
| Detail and progress | `text-2xs`, `text-text-faint`; progress uses monospace                  |
| Choices             | `gap-1.5`; rows `min-h-9 rounded-xl px-2.5 py-2`, `text-sm`             |
| Selected choice     | `bg-foreground text-background`; expose `aria-pressed`                  |
| Unselected choice   | `bg-surface-hover text-text-strong`; shared focus ring                  |
| Custom answer       | Shared `Input`, size `xl`: 36px high, `px-3`, `text-sm`                 |

Use Inter for interface text and Fragment Mono for progress and keyboard-related metadata, following
the shared font tokens. The existing nominal small-text tiers are 11px, 12px, and 13px; retain their
shared line heights. Scroll only the question body, leaving the header and actions visible. At
narrow widths, allow actions to wrap and long choices to break without horizontal overflow.

## Interaction and state rules

- Keep selection and submission state scoped to a session. Key forms by question/request identity so
  answers from one question cannot appear in another.
- Use a single active keyboard scope. Digits select choices only outside editable fields; typing
  Enter in an answer field must not trigger the frame's global submit handler.
- Escape can defer from an editable field. Disable submission and dismissal while an answer or
  deferral is being sent, including their keyboard shortcuts.
- A recommended or preselected option is not an answer until the user submits it.
- Handle remote closure and stale responses by question identity. Finishing an older submission must
  not close a newer selected question. A failed submission leaves the form available to retry.

## References and verification

- [Interaction frame](../../apps/ui/src/features/chat/ui/hitl/HitlInteractionFrame.tsx)
- [Question form](../../apps/ui/src/features/chat/ui/hitl/AskQuestionForm.tsx)
- [Waiting ask](../../apps/ui/src/features/chat/ui/hitl/AskInteractionView.tsx)
- [Queued question](../../apps/ui/src/features/chat/ui/hitl/QueuedQuestionView.tsx)
- [Question selection state](../../apps/ui/src/features/chat/model/questionUi.ts)
- [Shared control tokens](../../packages/kit/styles/chrome.css) and
  [typography](../../packages/kit/styles/tailwind-theme.css)
- [Behavior contract](../features/hitl.md)
- Accepted captures: [queued question](../assets/screenshots/questions/queued--2026-10-03.png) and
  [waiting ask](../assets/screenshots/questions/waiting--2026-10-03.png)

When extending this pattern, verify opening from the queue, returning to the composer, explicit
skip/deny, close/Escape, keyboard behavior while typing, and switching questions during a pending
submission. Check narrow layouts as well as desktop. Existing interaction regressions live in
`QuestionsStrip.dom.test.tsx`, `HitlControls.dom.test.tsx`, and `ask-deferral.test.ts`.
