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

The local API is a loopback, single-user application service. Its `x-user-id` header selects local
state; it is not authentication and must not be exposed as a multi-tenant or untrusted-network
boundary. Web pages in the user's browser are outside that boundary: the API refuses a websocket or
a write from any page origin other than the Localix app's, and any request whose `Host` is not a
loopback name. A web page that drives the local API is in scope.

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
