# Envoy Upsert Guard Extension

A guarded pi extension for `envoy-route-cluster-upsert` workflow usage.

This extension intercepts routine Envoy onboarding requests, runs the skill workflow in a controlled way, shows a review/apply dashboard, supports per-item selection, minimizes model usage, and keeps debug/audit logs for OPS-style work.

## Active installation

Current global entrypoint:

- `~/.pi/agent/extensions/upsert-docs-only-guard/index.ts`

Global support files:

- `~/.pi/agent/extensions/upsert-docs-only-guard/lib/`

Preferred global skill and repo-local runtime assumptions:

- `~/.pi/agent/skills/envoy-route-cluster-upsert/`
- `envoy/docker/envoy.yaml.template`
- `.pi/logs/upsert-workflow-debug.jsonl`
- `.pi/logs/upsert-workflow-audit.jsonl`

The extension code is installed globally, and it operates against the **current repo**. It prefers the global skill install and only falls back to a project-local skill copy if one exists.

## What it does

- intercepts likely Envoy upsert requests before the normal agent loop freelances
- prefers **direct workflow planning** via `run_workflow.py --json`
- falls back to **model normalization only** when the input is ambiguous or malformed
- keeps the skill/workflow script authoritative for the actual plan/apply result
- shows a custom workflow dashboard with:
  - plan summary
  - route/cluster additions
  - usage totals
  - warnings
  - last direct-apply audit
- supports **per-item selection** before apply
- performs apply as **direct workflow execution** with **no model usage**
- writes append-only debug and audit logs

## High-level flow

### Planning

1. User pastes an Envoy/proxy-context style request.
2. The extension detects it with `shouldGuard(...)`.
3. It runs the workflow directly first:
   - `python3 ~/.pi/agent/skills/envoy-route-cluster-upsert/scripts/run_workflow.py --request-file <tmp> --json`
4. If the workflow can plan directly, that result is shown.
5. If the workflow fails for ambiguity/normalization-style reasons, the extension starts a restricted fallback subagent that:
   - can only read the 4 approved docs
   - cannot run bash
   - must return JSON only
6. The extension parses that normalized JSON and runs the workflow itself again.

### Apply

1. User reviews the dashboard.
2. User can keep/remove selected items.
3. Apply runs directly:
   - `python3 ~/.pi/agent/skills/envoy-route-cluster-upsert/scripts/run_workflow.py --request-file <tmp> --json --approve`
4. The extension records an audit entry.

## Safety model

The extension is intentionally restrictive.

### Allowed routine reads

Only these docs are treated as approved routine reads for fallback normalization:

- `~/.pi/agent/skills/envoy-route-cluster-upsert/SKILL.md`
- `~/.pi/agent/skills/envoy-route-cluster-upsert/docs/PLAYBOOK.md`
- `~/.pi/agent/skills/envoy-route-cluster-upsert/docs/JSON_CONTRACT.md`
- `~/.pi/agent/skills/envoy-route-cluster-upsert/docs/TROUBLESHOOTING.md`

The main guarded agent path also allows the template, but only after a workflow attempt:

- `envoy/docker/envoy.yaml.template`

### Blocked behavior

The extension blocks or discourages:

- inspecting skill scripts/tests during routine use
- `ls`, `find`, `rg`, `grep` exploration of the skill directory
- reading `USAGE.md` / `ARCHITECTURE.md` during routine guarded use
- applying with `--approve` before explicit user approval
- reading the template before the first workflow attempt

### Authoritative boundary

- **Model:** only helps normalize ambiguous input
- **Extension:** owns orchestration, UI, logging, and direct workflow execution
- **Skill/workflow:** remains the source of truth for planning/apply results

## UI and commands

### Automatic interception

The extension activates for prompts that look like Envoy upsert requests, for example prompts mentioning:

- `proxy context`
- `public path`
- `application host endpoint`
- `s3_prefix_rewrite`
- `envoy-route-cluster-upsert`

### Commands

- `/upsert-workflow-ui`
  - open the latest workflow dashboard or the live progress view
- `/upsert-workflow-debug-log`
  - insert a `tail` command for the debug log into the editor
- `/upsert-workflow-debug-last`
  - open a formatted summary of the latest debug run in the editor

### Approval UI keys

When the plan is waiting for approval:

- `j` / `k` — move selection cursor
- `space` or `x` — toggle current item
- `+` — select all
- `-` — select none
- `a` or `Enter` — apply selected items
- `c` or `Esc` — cancel
- `↑` / `↓` / `PgUp` / `PgDn` — scroll

## Logs

### Debug log

Path:

- `.pi/logs/upsert-workflow-debug.jsonl`

Contains append-only records for things like:

- intercepted input
- direct planning start/finish
- normalization subagent spawn/events/exit
- blocked tools
- approval cancellation
- direct apply start/finish
- failures

Use:

- `/upsert-workflow-debug-log`
- `/upsert-workflow-debug-last`

### Audit log

Path:

- `.pi/logs/upsert-workflow-audit.jsonl`

Written after successful direct apply. Includes:

- timestamp
- selected item indexes
- selected summaries/contexts
- reconstructed request actually applied
- target virtual host
- plan/apply state summary
- route/cluster counts

## File layout

### Global installation

- `~/.pi/agent/extensions/upsert-docs-only-guard/index.ts`
- `~/.pi/agent/extensions/upsert-docs-only-guard/lib/`

### Repo-local sources/tests

- `.pi/extensions/upsert-docs-only-guard-lib/`
- `scripts/test-upsert-guard-extension.sh`
- `scripts/check-upsert-guard-extension.sh`

There is currently **no repo-local entrypoint** anymore; the repo uses the global extension entrypoint.

## Architecture notes

Main modules:

- `constants.ts` — repo/global path resolution and shared constants
- `workflow.ts` — workflow parsing, command detection, fallback classification
- `direct-workflow.ts` — direct `run_workflow.py` execution
- `subagent-runner.ts` — restricted fallback subagent execution
- `subagent-fallback-tools.ts` — doc-read-only fallback tools
- `normalization.ts` — parse/normalize JSON-only fallback output
- `selection.ts` — per-item apply reconstruction
- `audit.ts` / `audit-log.ts` — direct-apply audit construction and persistence
- `debug-log.ts` / `debug-log-view.ts` — append and inspect debug timelines
- `state.ts` / `usage.ts` / `ui.ts` / `progress.ts` — extension state, usage tracking, dashboard UI, progress formatting

## Validation

Run:

```bash
./scripts/test-upsert-guard-extension.sh
./scripts/check-upsert-guard-extension.sh
```

The check script currently validates:

- Bun tests for the pure helper modules
- TypeScript transpile sanity for the global entrypoint plus repo-local helper modules

## Repo assumptions

This extension currently assumes the current repo has the same layout as Advisor / nn.nl:

- skill at `.pi/skills/envoy-route-cluster-upsert/`
- template at `envoy/docker/envoy.yaml.template`

If a future repo differs in layout, template path, or workflow conventions, introduce a config/profile layer instead of hardcoding more cases.

## Operational notes

This extension is intended for **reviewed operational use**, not free-roaming repo exploration.

Recommended usage pattern:

1. paste the request
2. inspect the dashboard
3. apply only selected items if needed
4. check debug/audit logs when behavior looks off

## Reload

After changing the global extension or its lib files, run:

```text
/reload
```
