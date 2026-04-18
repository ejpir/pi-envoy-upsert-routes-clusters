import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const LIB_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR
  ? path.resolve(process.env.PI_CODING_AGENT_DIR)
  : path.join(homedir(), ".pi/agent");
const GLOBAL_SKILL_ROOT = path.join(PI_AGENT_DIR, "skills/envoy-route-cluster-upsert");
const PROJECT_SKILL_ROOT = path.join(ROOT, ".pi/skills/envoy-route-cluster-upsert");
const SKILL_ROOT = existsSync(path.join(GLOBAL_SKILL_ROOT, "SKILL.md")) ? GLOBAL_SKILL_ROOT : PROJECT_SKILL_ROOT;
const WORKFLOW_SCRIPT_PATH = path.join(SKILL_ROOT, "scripts/run_workflow.py");
const UPSERT_SCRIPT_PATH = path.join(SKILL_ROOT, "scripts/upsert_envoy_proxy_contexts.py");
const DOC_READS = new Set([
  path.join(SKILL_ROOT, "SKILL.md"),
  path.join(SKILL_ROOT, "docs/PLAYBOOK.md"),
  path.join(SKILL_ROOT, "docs/JSON_CONTRACT.md"),
  path.join(SKILL_ROOT, "docs/TROUBLESHOOTING.md"),
]);
const TEMPLATE_PATH = path.join(ROOT, "envoy/docker/envoy.yaml.template");
const GUARD_STATUS_KEY = "upsert-guard";
const APPLY_AUDIT_LOG_PATH = path.join(ROOT, ".pi/logs/upsert-workflow-audit.jsonl");
const WORKFLOW_DEBUG_LOG_PATH = path.join(ROOT, ".pi/logs/upsert-workflow-debug.jsonl");
const SUBAGENT_FALLBACK_EXTENSION_PATH = path.join(LIB_ROOT, "subagent-fallback-tools.ts");
const SKILL_COMMAND = "/skill:envoy-route-cluster-upsert";
const PROGRESS_EVENT_LIMIT = 6;
const WORKFLOW_DASHBOARD_WIDTH = 80;
const WORKFLOW_PROGRESS_HEIGHT = 20;
const WORKFLOW_UI_HEIGHT = 28;
const WORKFLOW_UI_STICKY_HEADER_COUNT = 10;

export {
  APPLY_AUDIT_LOG_PATH,
  DOC_READS,
  GLOBAL_SKILL_ROOT,
  WORKFLOW_DEBUG_LOG_PATH,
  GUARD_STATUS_KEY,
  PI_AGENT_DIR,
  PROJECT_SKILL_ROOT,
  PROGRESS_EVENT_LIMIT,
  ROOT,
  SKILL_COMMAND,
  SKILL_ROOT,
  SUBAGENT_FALLBACK_EXTENSION_PATH,
  TEMPLATE_PATH,
  UPSERT_SCRIPT_PATH,
  WORKFLOW_DASHBOARD_WIDTH,
  WORKFLOW_PROGRESS_HEIGHT,
  WORKFLOW_SCRIPT_PATH,
  WORKFLOW_UI_HEIGHT,
  WORKFLOW_UI_STICKY_HEADER_COUNT,
};
