// Verbatim error-message envelopes for the apply_patch tool. Kept separate so the
// long, format-teaching strings don't bury the read-validate-write control flow.
//
// Every marker below is INTERPOLATED from `patch-syntax.ts`, never re-typed. This file's
// whole job is to hand a model the exact envelope to copy after it got the envelope
// wrong; a marker spelled out by hand here is one that can teach a form the parser
// rejects, and the model would then loop on a patch it can never get right. The parser
// imported the grammar and the teacher did not — the classic split where only the
// DETECTORS own the constant.

import {
  ADD_FILE,
  BEGIN_PATCH,
  DELETE_FILE,
  END_PATCH,
  MOVE_TO,
  UPDATE_FILE,
  directiveName,
} from './patch-syntax'

/** Malformed-patch envelope: no files were touched; teaches the exact format so
 *  the model fixes it in one shot instead of burning turns guessing. When the
 *  failure involves an "*** Add File" header, teach the ADD shape (not the
 *  Update-only template, which misleads the model on a new-file patch). */
export function malformedPatchMessage(reason: string, patch?: string): string {
  const header = `apply_patch verification failed: ${reason}\nNo files were changed. `
  // An Add-File patch should be taught the ADD shape: branch when the failure
  // reason names "Add File", or the patch is a pure-add envelope (an Add File
  // header with no Update File header) that failed for any reason.
  //
  // These two stay hand-written regexes ON PURPOSE: they CLASSIFY text the model sent us,
  // and their tolerance (case-insensitive, exact single spaces) is the behaviour under
  // test. Deriving them from the constants would quietly widen it. Only the text we EMIT
  // is interpolated.
  const isAddContext =
    /Add File/i.test(reason) ||
    (!!patch && /\*\*\* Add File/i.test(patch) && !/\*\*\* Update File/i.test(patch))
  if (isAddContext) {
    return (
      header +
      'To create a NEW file the patch MUST be:\n' +
      `${BEGIN_PATCH}\n` +
      `${ADD_FILE}<path>\n` +
      '+new line\n' +
      '+another new line\n' +
      `${END_PATCH}\n` +
      `Every line after the header is the new file content — a leading "+" is optional (bare lines are accepted) and there is no "@@" anchor in an Add. Use ${directiveName(UPDATE_FILE)} / ${directiveName(DELETE_FILE)} / ${directiveName(MOVE_TO)} for other operations.`
    )
  }
  return (
    header +
    'The patch MUST be exactly:\n' +
    `${BEGIN_PATCH}\n` +
    `${UPDATE_FILE}<path>\n` +
    '@@ <optional anchor>\n' +
    ' unchanged context line\n' +
    '-removed line\n' +
    '+added line\n' +
    `${END_PATCH}\n` +
    `Use ${directiveName(ADD_FILE)} / ${directiveName(DELETE_FILE)} / ${directiveName(MOVE_TO)} for other operations. Include only changed lines with a little surrounding context — not the whole file.`
  )
}
