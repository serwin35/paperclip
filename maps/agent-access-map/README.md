# Paperclip agent access map

This map accompanies the [feature map](../feature-map/README.md). It records APIs,
agent entry points, permission boundaries and verification for the same capability IDs.
The [shared contract](../README.md) defines the format and maintenance rules.

Initial inventory: **35 areas and 171 sub-features**, source-reviewed on 2026-10-12
at `f981fa3cc10cb8663a87dec60345fbff46d54d0a`. All entries are `baseline` and `source-only`; none
claims complete operation enumeration or freshly verified agent access. Existing
API paths, native gaps, actor restrictions and local/operator exceptions are
recorded separately. These statuses do not represent a live pass rate.

## Areas

| Area | Product map | Capabilities |
| --- | --- | --- |
| [Login, invitations, and access](access.md) | [access](../feature-map/access.md) | 5 |
| [Dashboards, activity, and audit trails](activity.md) | [activity](../feature-map/activity.md) | 5 |
| [Agent conversations and project handoff](agent-chat.md) | [agent-chat](../feature-map/agent-chat.md) | 4 |
| [Hiring, agent configuration, and organization](agents.md) | [agents](../feature-map/agents.md) | 5 |
| [App access, action permissions, and testing](app-permissions.md) | [app-permissions](../feature-map/app-permissions.md) | 5 |
| [Costs, budgets, and spending controls](budgets-costs.md) | [budgets-costs](../feature-map/budgets-costs.md) | 4 |
| [Cases and structured work records](cases.md) | [cases](../feature-map/cases.md) | 4 |
| [External chat and email conversations](chat-channels.md) | [chat-channels](../feature-map/chat-channels.md) | 5 |
| [CLI, API clients, and local worktrees](cli-operations.md) | [cli-operations](../feature-map/cli-operations.md) | 5 |
| [Companies and portability](companies.md) | [companies](../feature-map/companies.md) | 4 |
| [Connection setup](connection-setup.md) | [connection-setup](../feature-map/connection-setup.md) | 8 |
| [Developer previews and diagnostic labs](developer-labs.md) | [developer-labs](../feature-map/developer-labs.md) | 4 |
| [Documents, attachments, and work products](documents-artifacts.md) | [documents-artifacts](../feature-map/documents-artifacts.md) | 5 |
| [Local, SSH, and sandbox environments](execution-environments.md) | [execution-environments](../feature-map/execution-environments.md) | 5 |
| [Tool gateways and access profiles](gateways-profiles.md) | [gateways-profiles](../feature-map/gateways-profiles.md) | 5 |
| [Goals and work alignment](goals.md) | [goals](../feature-map/goals.md) | 3 |
| [Inbox, decisions, and search](inbox-search.md) | [inbox-search](../feature-map/inbox-search.md) | 4 |
| [Installation, configuration, updates, and backups](instance-operations.md) | [instance-operations](../feature-map/instance-operations.md) | 5 |
| [Navigation, profile, and announcements](navigation-preferences.md) | [navigation-preferences](../feature-map/navigation-preferences.md) | 5 |
| [Onboarding and first work](onboarding.md) | [onboarding](../feature-map/onboarding.md) | 5 |
| [Pipelines, review queues, and learnings](pipelines.md) | [pipelines](../feature-map/pipelines.md) | 4 |
| [Plugins and contributed product surfaces](plugins.md) | [plugins](../feature-map/plugins.md) | 4 |
| [Projects and repositories](projects.md) | [projects](../feature-map/projects.md) | 4 |
| [Questions and approvals](questions-and-approvals.md) | [questions-and-approvals](../feature-map/questions-and-approvals.md) | 8 |
| [Recovery](recovery.md) | [recovery](../feature-map/recovery.md) | 8 |
| [Routines, schedules, and triggers](routines.md) | [routines](../feature-map/routines.md) | 5 |
| [Runs, harnesses, and model accounts](runs-adapters.md) | [runs-adapters](../feature-map/runs-adapters.md) | 4 |
| [Secrets, personal credentials, and proposals](secrets.md) | [secrets](../feature-map/secrets.md) | 5 |
| [Skill discovery, authoring, and policy](skills.md) | [skills](../feature-map/skills.md) | 5 |
| [Status cards and refreshed summaries](status-cards.md) | [status-cards](../feature-map/status-cards.md) | 4 |
| [Steering and queued messages](steering.md) | [steering](../feature-map/steering.md) | 7 |
| [Delegation, dependencies, and signoff](task-coordination.md) | [task-coordination](../feature-map/task-coordination.md) | 4 |
| [Task creation and lifecycle](tasks.md) | [tasks](../feature-map/tasks.md) | 5 |
| [Team packages and catalog installation](teams.md) | [teams](../feature-map/teams.md) | 4 |
| [Execution workspaces, services, and files](workspaces.md) | [workspaces](../feature-map/workspaces.md) | 5 |

## Using an entry

Read its Policy and Gaps before selecting an agent path. Native fallback, legacy
REST/CLI, stdio MCP and a personal assistant connection can have different
authority and availability. Use a real admitted production binding; a scenario
declaration is not an installed tool. A `restricted` entry records current
enforcement and leaves any unresolved delegation decision visible.

For API catalog disagreements, follow the route/service authorization and record
discovery drift. For `not-applicable`, retain the concrete exception and local
path. Split shared business operations from client-only presentation.

Use `maintain-verification-skill` to reconcile changed source and both maps.
Use `verify-paperclip` and existing API/runner/MCP fixtures to collect the
permitted-agent and denial evidence; report blocked/not-run coverage honestly.
Run `node scripts/check-maps.mjs` after editing. The structural check does not
certify permissions, API catalog coverage, tool admission or live behavior.

## Native REST transport

The `call_api` parity change reconciles affected baselines against
`58e16dbddfc9c8d0cf60867f9d9847f0feda055b` and the changes in this PR. Ordinary
REST operations use the same route authorization as legacy agent REST. Dedicated
tools remain optional for those operations; protocol endpoints still need their
existing clients. Board-only routes remain restricted for agent identity.

Native `search_api` / `call_api` requires operator rollout admission, a running
authorized native run, current task assignment and execution-run binding, company
and budget authority, task privacy, and a permitted work mode. Ask and Plan retain
mutation restrictions, and runs retain their admitted JWT scope during restart
recovery even when task mode changes. A waiting
agent does not gain independent native control just because a REST route exists.

Credential-bearing replies, including company exports and their legacy alias,
stay inline under a 10 MiB limit and use encrypted mutation receipts. Other saved
API snapshots are limited to the issuing actor and responsible user, plus authorized
administrators. Artifact uploads enforce the same access checks as downloads;
private snapshots are excluded from company exports and public company logos.
Explicit deliverables use the existing sharing path. Native event history,
checkpoints and completion records omit API bodies while preserving receipt
metadata and replay digests. Restored webhook secrets use the same encrypted
receipt and inline response policy as newly created webhook secrets.
Task image access requires the company boundary and the task permission;
skill-test and low-trust agents do not need company-wide browsing authority.
Completion replay applies the same idempotent projection to stored and expected
payloads; [the run-log guide](../../doc/run-log-events.md) describes its fields.

Sources: [API client](../../server/src/services/native-runtime/runner-api-client.ts),
[catalog](../../server/src/services/native-runtime/runner-api-catalog.ts),
[native authority](../../server/src/services/native-runtime/paperclip-runner-tool-authority.ts),
[credential storage classification](../../server/src/services/native-runtime/runner-api-sensitive-response.ts),
[snapshot access](../../server/src/services/asset-content-access.ts),
and [history redaction](../../server/src/services/native-runtime/runner-api-log-redaction.ts). The affected entries remain
`baseline` and `source-only`; this reconciliation does not certify every operation.
Targeted real-route proof lives in the
[API integration suite](../../server/src/services/native-runtime/runner-api.integration.test.ts),
including owned routines, skill tests, scoped secrets, proposals and private export replay.
