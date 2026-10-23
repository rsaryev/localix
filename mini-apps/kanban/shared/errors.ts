/**
 * A board rule the request broke, with the sentence the caller acts on.
 *
 * Routes answer it with its `status` and `code`; the tool answers it as an error result the
 * model reads. Anything else thrown is a fault, not a refusal, and surfaces as one.
 */
export class BoardRefusal extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BoardRefusal'
  }
}
