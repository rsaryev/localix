/**
 * Canonical structured-JSON edit-prediction prompt — the ONE prompt. There is no version
 * selector and no legacy fallback: the file is named for what it does, not which revision it
 * is, and a prompt change bumps `EDIT_PREDICTION_SCHEMA_VERSION` (cache invalidation) rather
 * than adding a sibling.
 *
 * It instructs strict JSON as the single output (`{"edits":[…]}`). The system instruction is
 * fully STATIC — byte-identical across every prediction/file/session, since only module
 * constants (`MAX_EDITS`, `CURSOR_MARKER`) are interpolated. That is a property worth keeping
 * for its own sake, but NOT for prompt caching: this path passes `cacheRetention:'none'`
 * because the static prefix is far below every provider's cacheable minimum (see
 * `model/adapter.ts`).
 */

import { formatEditEvents, symbolsNearCursor } from '../../autocomplete/predict-next-edit-context'
import {
  packCompletionContext,
  renderCompletionContext,
} from '../../autocomplete/completion-context'
import { plural } from '../../../lib/plural'
import {
  CONTEXT_CHAR_BUDGET,
  CURSOR_MARKER,
  MAX_CONTEXT_CHARS,
  MAX_CONTEXT_WINDOWS,
  MAX_EDITS,
  PROMPT_WINDOW_BYTE_CEILING,
  PROMPT_WINDOW_LINES,
  PROMPT_WINDOW_RADIUS,
  type ContextContribution,
  type PredictNextEditRequest,
} from '../contracts'

/**
 * Inline caret marker. The cursor used to be conveyed ONLY as prose ("Cursor is on line
 * 412, column 17") ahead of a numbered file the model reads hundreds of lines later, so
 * locating the caret meant counting columns from a distance. `out_of_range`/`no_op` in the
 * rejection tally are what that costs: the model knew what to write, not where.
 *
 * The marker sits IN the text at the supplied column, and the prompt names it explicitly. Its
 * literal stays stable because models may already recognize this sentinel; changing it would
 * trade a familiar positional cue for an unfamiliar one without improving the protocol.
 *
 * The literal lives in `contracts.ts` because validation must strip it from a reply that
 * echoes it back.
 */

/**
 * Insert {@link CURSOR_MARKER} into `line` at a 0-based `column`. Out-of-range columns clamp
 * to the line's end rather than throwing — the caret can legitimately sit past the last
 * character, and a prompt is never worth failing a prediction over.
 *
 * An UNKNOWN column returns the line untouched. `cursorColumn` is optional on the wire, and
 * marking the line's end when we were not told where the caret is would assert a position we
 * do not have — worse than the prose fallback, because the model trusts the marker.
 */
export function markCursorInLine(line: string, column: number | undefined): string {
  if (column === undefined) return line
  const at = Math.max(0, Math.min(line.length, column))
  return `${line.slice(0, at)}${CURSOR_MARKER}${line.slice(at)}`
}

/**
 * Number the file for the prompt. When it fits `PROMPT_WINDOW_LINES` the WHOLE file
 * is shown; otherwise only a `PROMPT_WINDOW_RADIUS` window on each side of the cursor
 * is shown, with the REAL 1-based line numbers preserved and an elision marker where
 * lines were dropped. The cursor line additionally carries {@link CURSOR_MARKER} when the
 * column is known. Pure — the returned numbers still refer to absolute file lines, so a
 * prediction validates against the full file unchanged. Unit-tested.
 */
export function numberFileForPrompt(
  content: string,
  cursorLine: number,
  cursorColumn?: number,
): string {
  const lines = content.split('\n')
  const number = (l: string, i: number) =>
    // The marker goes INSIDE the line's text, after the number, so line numbering — the
    // thing every reply range is expressed in — is untouched by it.
    `${i + 1}\t${i + 1 === cursorLine ? markCursorInLine(l, cursorColumn) : l}`

  /** Render an absolute-numbered window, with an honest elision marker on each open side. */
  const render = (start: number, end: number): string => {
    const parts: string[] = []
    if (start > 0) parts.push(`… (${plural(start, 'earlier line')} omitted) …`)
    for (let i = start; i < end; i++) parts.push(number(lines[i]!, i))
    if (end < lines.length) {
      parts.push(`… (${plural(lines.length - end, 'later line')} omitted) …`)
    }
    return parts.join('\n')
  }

  const lineWindow =
    lines.length <= PROMPT_WINDOW_LINES
      ? { start: 0, end: lines.length }
      : {
          start: Math.max(0, cursorLine - 1 - PROMPT_WINDOW_RADIUS),
          end: Math.min(lines.length, cursorLine - 1 + PROMPT_WINDOW_RADIUS + 1),
        }

  const byLines = render(lineWindow.start, lineWindow.end)
  if (byLines.length <= PROMPT_WINDOW_BYTE_CEILING) return byLines

  // A line budget says nothing about SIZE: 1200 lines of ordinary code is ~54 KiB, but 1200
  // lines of a wide object literal is 358 KiB — ~90k tokens on every keystroke-triggered
  // prediction (see PROMPT_WINDOW_BYTE_CEILING). Shrink the radius around the cursor until the
  // rendered window fits. Halving converges in a handful of steps and keeps the window centred,
  // which is what the model needs: hunks near the caret are the likely ones.
  const cursorIndex = Math.min(Math.max(cursorLine - 1, 0), Math.max(lines.length - 1, 0))
  let radius = Math.max(
    1,
    Math.min(PROMPT_WINDOW_RADIUS, Math.max(cursorIndex - lineWindow.start, 1)),
  )
  let rendered = byLines
  while (radius > 1) {
    radius = Math.floor(radius / 2)
    rendered = render(
      Math.max(lineWindow.start, cursorIndex - radius),
      Math.min(lineWindow.end, cursorIndex + radius + 1),
    )
    if (rendered.length <= PROMPT_WINDOW_BYTE_CEILING) return rendered
  }
  // The cursor's own line can exceed the ceiling on its own (one 100 KB minified line). Showing
  // it is still right — it is the line being edited — so this returns over budget rather than
  // returning nothing the model can anchor to.
  return render(cursorIndex, cursorIndex + 1)
}

/**
 * Assemble the SAME-FILE prompt. Policy-shaped context contributions are
 * ranked by relevance to the cursor and packed into `CONTEXT_CHAR_BUDGET`; recent
 * edits render as a located, chronological before→after events log; the current file
 * (self-windowed) comes last, nearest the completion.
 */
export function buildEditPredictionPrompt(
  req: PredictNextEditRequest,
  contextItems: readonly ContextContribution[] = [],
): { systemPrompt: string; userContent: string } {
  const systemPrompt = [
    'You predict the NEXT edit(s) a developer will make while editing a file — a small, confident diff of 1 to ' +
      String(MAX_EDITS) +
      ' hunks in THIS file, most important first.',
    "Given the current file, the cursor position, this file's recent edit history, and any additional context, propose the contiguous line-range replacement(s) a developer would most plausibly make next. Most of the time ONE hunk is right; add more ONLY when they are clearly part of the same next step (e.g. a rename that must land in every usage in this file).",
    'Each hunk may be RIGHT AT THE CURSOR — completing the line or block the developer is in the middle of writing — OR ELSEWHERE in the file (propagating a rename, fixing an obvious follow-on, completing a repeated pattern). When the cursor line is clearly unfinished, completing it is usually the best first hunk. Hunks must NOT overlap each other.',
    `The developer's caret is marked ${CURSOR_MARKER} inside the file text, and the cursor line is repeated on its own above it. That marker is the most reliable signal of what they are working on; prefer hunks at or adjacent to it, then lines near it, then lines further away.`,
    // Prevention beside the cure. `reversal.ts` already DROPS a hunk that restores text the
    // user just changed, but a dropped hunk is a wasted call and often the only hunk, so the
    // user sees nothing. State the rule in the prompt to reduce rejected reversals; the filter
    // stays as the guarantee.
    //
    // The rule is about COMPLETE code, and the second sentence is what makes it so. Stated
    // bare, it silenced the commonest wait-for-a-suggestion case there is: delete a type in
    // `private readonly authorize: Authorize,` and the line is left dangling at `: `, whose
    // likeliest completion resembles the deleted text — so the model, told never to restore
    // what was just changed, answered `null` and the developer got nothing.
    'Do NOT undo or revert what the developer just changed — the recent edits below are their intent, not a mistake to correct. Continue that trajectory instead. The only exception is an obvious typo or error they introduced.',
    'That rule protects deliberate, COMPLETE changes. When a deletion left the code at the cursor unfinished — a dangling `:`, `=`, `,`, `(`, an operator, an empty argument or type position — completing it IS the next edit. Propose the most plausible completion even if it matches or resembles the text that was just deleted.',
    'Reply with STRICT JSON only, no prose, no code fence:',
    '{"edits": [{"startLine": <1-based inclusive>, "endLine": <1-based inclusive>, "replacement": "<new text for those lines>"}]}',
    `Each range is 1-based inclusive over the numbered current file below (numbers are absolute even when some lines are omitted). \`replacement\` is RAW FILE TEXT for those lines: never include the leading line numbers, and never include ${CURSOR_MARKER} — both are prompt scaffolding, not part of the file. Keep the diff small and confident — never pad it with speculative hunks.`,
    'If there is no clearly likely next edit, reply exactly: null',
  ].join('\n')

  // Enforce common privacy/dedupe/budget rules BEFORE prediction-specific ranking.
  const querySymbols = symbolsNearCursor(req.content, req.cursorLine)
  const hostHistory = contextItems.find((item) => item.kind === 'edit-history')?.content
  // These host contributions are task inputs with dedicated prompt positions: the
  // document body is already rendered below and history belongs in its chronological
  // events block, not in generic supporting-context ranking.
  const supportingContext = contextItems.filter(
    (item) => item.kind !== 'active-document' && item.kind !== 'edit-history',
  )
  const additional = renderCompletionContext(
    packCompletionContext(supportingContext, {
      querySymbols,
      activeUri: req.filepath,
      budget: {
        budgetChars: CONTEXT_CHAR_BUDGET,
        maxWindows: MAX_CONTEXT_WINDOWS,
        perWindowChars: MAX_CONTEXT_CHARS,
      },
    }),
  )

  // The host automatic provider owns the normalized history whenever Fabric is
  // available. Keep this direct fallback for callers without the manager.
  const events = hostHistory ?? formatEditEvents(req.recentlyEditedRanges)
  const numbered = numberFileForPrompt(req.content, req.cursorLine, req.cursorColumn)

  // The line numbers stay: every reply range is expressed in them. What changes is that the
  // caret is now findable without counting — the marker sits in the text, and the cursor line
  // is repeated on its own so it survives a long file. The repetition is cheap, and the one
  // line the model must not misplace is the one it now sees twice.
  const cursorLineText = req.content.split('\n')[req.cursorLine - 1]
  const cursorPos =
    cursorLineText === undefined || req.cursorColumn === undefined
      ? // No column, or a line number past the end of the file: say only what is known.
        `Cursor is on line ${req.cursorLine}.`
      : [
          `Cursor is on line ${req.cursorLine}, marked ${CURSOR_MARKER} in the file below.`,
          `Cursor location:\n${req.cursorLine}\t${markCursorInLine(cursorLineText, req.cursorColumn)}`,
        ].join('\n')

  const userContent = [
    `Current file path: ${req.filepath}`,
    `Language: ${req.language}`,
    cursorPos,
    additional ? `Additional context (context only):\n${additional}` : undefined,
    events
      ? `Recent edits (oldest first — a "diff" block shows before→after with -/+ lines; the trajectory of what the developer just changed):\n${events}`
      : 'Recent edits: (none)',
    `Current file "${req.filepath}" (with 1-based line numbers):\n${numbered}`,
  ]
    .filter((x): x is string => x !== undefined)
    .join('\n\n')

  return { systemPrompt, userContent }
}
