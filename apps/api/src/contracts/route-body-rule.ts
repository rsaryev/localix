/**
 * A ROUTE READS ITS BODY THROUGH A VALIDATOR, NEVER `c.req.json()` — one rule, two readers.
 *
 * `c.req.json()` parses a body under any content type, and a `text/plain` POST is a SIMPLE request:
 * a page on any origin sends it with no preflight, and the preflight is the one thing the host's
 * localhost-only CORS can deny. A validator that parses only JSON (`zValidator('json')` in the app,
 * `jsonBody` from the plugin SDK) forces it.
 *
 * The repository guard (`lib/route-body-contract.test.ts`) applies this to the app and the bundled
 * plugins; `plugin_build` applies it to a user plugin, which lives in `~/.localix/plugins` where no
 * repository guard looks — and the reference those plugins are copied from once shipped the call.
 * Two copies of the pattern would drift apart the way two copies of any rule do.
 *
 * Deliberately NOT `.json(` in general: `c.json(...)` is the RESPONSE helper on nearly every route.
 * The `req` is what makes it a read of attacker-controlled input.
 */
export const RAW_BODY_PARSE = /\b[A-Za-z_$][\w$]*\.req\s*\.\s*json\s*\(/gu

/** What a plugin route does instead. */
export const RAW_BODY_PARSE_FIX =
  "read the body with jsonBody(schema) from '@localixai/mini-app-sdk/backend' and c.req.valid('json')"
