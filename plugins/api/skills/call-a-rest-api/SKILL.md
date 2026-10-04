---
name: call-a-rest-api
description:
  How to call, save and share HTTP requests with the API plugin — importing instead of transcribing,
  keeping credentials in the vault, and the two results that look like success but are not.
---

# Call a REST API

Use `api_client`. Request actions are the default; add `"target":"environment"` for environment
actions. The rules below are the ones the tool descriptions cannot fit.

## Choose the action from the user's intent

- “Call”, “send”, “test”, “check”, “fetch”, or “what does this endpoint return?” means
  `{"action":"send", …}`. This performs the HTTP request and returns its actual status, selected
  response headers, and body.
- “Add”, “create”, or “save this request” means `{"action":"save", …}`. Saving persists a
  `*.request.json` file and **does not** contact the endpoint.
- “Save and test it” is two sequential calls to the same `api_client`: first `save`, then `send`
  with the same `name`. Do not claim the request was tested after only saving it.
- A one-off call uses `send` with `url`. A collection request uses `send` with `name`; request
  fields included with that call temporarily override the saved values.
- Pasted cURL/OpenAPI/Postman/Insomnia/HAR material means `import`, not hand transcription.

## Import; do not transcribe

When the user pastes a cURL command, an OpenAPI spec (JSON or YAML), a Postman collection, or a HAR
archive, pass it verbatim as `{"action":"import","source":"…"}`. Do not read it and rebuild the
request by hand — the importer already handles the parts that are easy to get subtly wrong (`-d` vs
`--data-urlencode`, `$ref`s, which parameters are optional).

- Import PREVIEWS by default. Add `"save":true` once the user has seen what it found.
- **A credential in the paste is fine.** It is moved into the secrets vault on import and the saved
  request keeps only a `${secret:KEY}` reference. Do not strip it first, and do not warn the user
  off pasting it.
- A Postman collection's `{{variables}}` work as-is; create a matching environment (the import names
  them). Its `{{$dynamic}}` variables (`{{$guid}}`, `{{$randomInt}}`) are NOT supported — the import
  says so, and those requests need a real value before they will work.
- An OpenAPI spec with a RELATIVE server (`url: /api/v3`) cannot say which host it lives on. The
  import says so and every request gets `https://example.com`. Ask the user for the origin and
  re-import with `"baseUrl":"https://…"` — do not save the placeholder.

## Credentials live in the vault, not in the request

Write a credential as `${secret:KEY}`, never a literal. It is resolved at send time; a saved request
never shows the value back to you.

- A send that fails with `Secret not found: KEY` is a SETUP step, not a transport bug. If the
  credential belongs to an environment, save that variable through `api_client` with
  `"target":"environment"` and `"secret":true`; its literal is moved into the native Vault. A
  request auth `${secret:KEY}` reference can also be filled in the native **Vault** workspace
  (direct Vault rail item, or **Settings → Capabilities → Secrets → Open Vault**).
- An OpenAPI import mints references for the schemes a spec describes. The spec cannot contain the
  credential, so those keys start empty and the import names them.

## One request, many deployments

A url may hold `{{variables}}` resolved against the ACTIVE environment (`api_client` with
`"target":"environment"`). Prefer `{{base_url}}/users` over hardcoding a host when the user has more
than one deployment.

- Ordinary environment values such as a host, API version, or account id stay in the environment
  file. For a credential pass `"secret":true`; the literal moves into Localix's native Vault and the
  environment file retains only a `${secret:KEY}` reference. Never save a credential as an ordinary
  variable.
- `This request uses a variable {{x}}, which … does not define` is a setup step too — define it, or
  activate an environment.

## Two results that look like success

- **A GraphQL endpoint answers a FAILED query with `200`** and an `errors` array — the transport
  succeeded, the query did not. This plugin has no GraphQL support and does NOT warn about it, so
  when you POST a query, read the body for `errors` yourself. Never read the 200 alone as success.
- **A 4xx is the server answering correctly** and the request being wrong (fix it); a 5xx is the
  server failing (retry may help). Do not report either as "the API is down" without checking which.

## Sharing through the repo

`{"action":"export"}` writes one file per request into `.localix/rest/` for the team to commit. A
request holding a LITERAL credential is refused — git history is permanent. Vault it first; a
`${secret:KEY}` reference is safe to commit, because each teammate's own vault supplies the value.
`{"action":"import","dir":".localix/rest","save":true}` reads them back.
