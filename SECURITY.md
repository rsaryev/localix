# Security Policy

## Supported versions

While Localix is in beta (versions before 1.0), the latest published release and `main` are
supported; older releases should be updated before reporting unless the issue prevents the update
itself.

## Reporting a vulnerability

Report suspected vulnerabilities through
[GitHub Security Advisories](https://github.com/rsaryev/localix/security/advisories/new). Do not
open a public issue or discussion for a security-sensitive report. Do not publish a release until
that advisory route is reachable and monitored.

Include the affected version or commit, impact, reproduction steps or a proof of concept, and any
known mitigation. Remove unrelated credentials and personal data from logs.

We aim to acknowledge a complete report within five business days. Triage time depends on
reproducibility and impact; the reporter will receive a private status update when the finding is
confirmed, rejected, or needs more evidence. There is no paid bug-bounty program or guaranteed
response SLA at this stage.

## Security model

Localix is a local agentic development environment. An agent can read files, edit code, run shell
commands, use configured providers, and call enabled plugins or MCP servers. Permission rules and
approval prompts help users review those actions, but they are not an operating-system security
sandbox.

Use an OS sandbox, container, or virtual machine when working with an untrusted repository or when
strong isolation is required. Review project instructions, skills, plugins, hooks, MCP servers, and
shell configuration before enabling them. Model requests are sent to the provider or endpoint the
user configured and are governed by that provider's security and privacy terms.

The local API defaults to loopback and is a single-user application service. Its `x-user-id` header
selects local state; it is not authentication and must not be exposed as a multi-tenant or
untrusted-network boundary. The API refuses websocket upgrades and writes from page origins outside
its explicit allowlist: packaged app origins, configured `LOCALIX_UI_ORIGINS`, and its own HTTP
origin when it serves the UI. Allowed Host names are loopback names plus the configured concrete
bind host; wildcard binds do not authorize arbitrary Host names. These checks do not authenticate
local processes. A web page that bypasses the configured browser-access boundary is in scope.

Localix-managed credentials are encrypted at rest with a key kept in `~/.localix/vault/.masterkey`,
an owner-only file rather than the operating-system keychain. Any process running as the same user
can read that key and decrypt the vault; see [privacy](docs/getting-started/privacy.md) for every
stored location.

## In scope

- A reproducible boundary bypass in Localix code that grants capabilities beyond the active
  permission or containment policy.
- Path traversal, credential disclosure, or unauthorized cross-user/cross-project data access caused
  by Localix.
- Vulnerabilities in bundled first-party plugins, the desktop shell, the local API, or released
  artifacts.
- A vulnerable dependency when the affected path is reachable in a supported Localix configuration.

## Usually out of scope

- Actions the user explicitly approved or enabled.
- Prompt injection or arbitrary model output without a demonstrated Localix boundary bypass.
- Behavior of third-party providers, plugins, skills, hooks, MCP servers, or external agent CLIs.
- Reports that require prior write access to the user's repository, home directory, shell startup
  files, or Localix configuration without showing how Localix granted that access.
- Exposing a locally configured service to an untrusted network contrary to its documented
  deployment requirements.

We will validate reports against a supported release or the current `main` branch, prepare a fix and
release where appropriate, and coordinate disclosure for confirmed issues. Please do not publish
exploit details before that coordination is complete.
