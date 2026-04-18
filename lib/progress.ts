import path from "node:path";
import { SKILL_ROOT, TEMPLATE_PATH } from "./constants.ts";
import { isApproveWorkflowCommand, isWorkflowCommand } from "./workflow.ts";

function truncate(value: string, width: number): string {
  const text = value.trim();
  if (text.length <= width) {
    return text;
  }
  if (width <= 3) {
    return text.slice(0, width);
  }
  return `${text.slice(0, Math.max(0, width - 3))}...`;
}

function summarizeProgressPath(filePath: string): string {
  if (!filePath) return "(unknown file)";
  if (filePath === TEMPLATE_PATH) return "envoy.yaml.template";
  if (filePath.startsWith(`${SKILL_ROOT}/`)) {
    return filePath.slice(SKILL_ROOT.length + 1);
  }
  return path.basename(filePath);
}

function summarizeProgressCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "bash";
  if (isWorkflowCommand(trimmed)) {
    return isApproveWorkflowCommand(trimmed) ? "run_workflow.py --approve" : "run_workflow.py";
  }
  return truncate(trimmed.replace(/\s+/g, " "), 64);
}

function summarizeProgressText(text: string, width = 96): string {
  return truncate(text.replace(/\s+/g, " ").trim(), width);
}

export {
  summarizeProgressCommand,
  summarizeProgressPath,
  summarizeProgressText,
  truncate,
};
