/**
 * What a ref argument may look like before it reaches `git`.
 *
 * git reads any argv entry that starts with `-` as an option, so a "hash" of `--hard` handed to
 * `git reset --soft <hash>` performs a hard reset, and a "hash" of `-f` handed to `git checkout`
 * discards the working tree — both past the UI's confirm. The read paths had this check three
 * times over; the write paths had none. One definition, applied at the request boundary
 * (`requests.ts`) so no route can forget it, and by the read helpers that take refs from the
 * repository itself.
 */
export function isSafeRef(ref: string): boolean {
  return ref.length > 0 && !/\s/.test(ref) && !ref.startsWith('-')
}
