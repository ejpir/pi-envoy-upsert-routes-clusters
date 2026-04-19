import type { UpsertWorkflowResult, UpsertWorkflowToolInput } from "./types.ts";

type GuardInputEvent = {
  source: string;
  text: string;
};

type GuardBeforeAgentStartEvent = {
  prompt: string;
  systemPrompt: string;
};

type ReadToolInput = {
  path?: string;
  offset?: number;
  limit?: number;
};

type BashToolInput = {
  command?: string;
  timeout?: number;
};

type GenericToolInput = Record<string, unknown>;

type GuardToolCallEvent = {
  toolName: string;
  toolCallId: string;
  input: ReadToolInput | BashToolInput | UpsertWorkflowToolInput | GenericToolInput;
};

type WorkflowToolResultDetails = Record<string, unknown> & {
  workflowResult?: UpsertWorkflowResult | null;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
  approve?: boolean;
};

type ToolContentBlock = {
  type?: string;
  text?: string;
};

type GuardToolResultEvent = {
  toolName: string;
  toolCallId: string;
  input: Readonly<ReadToolInput | BashToolInput | UpsertWorkflowToolInput | GenericToolInput>;
  content: string | ToolContentBlock[] | null | undefined;
  details: WorkflowToolResultDetails | null | undefined;
};

type WorkflowToolRenderTheme = {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
};

type WorkflowToolRenderResult = {
  details?: WorkflowToolResultDetails | null;
  content?: ToolContentBlock[];
  isError?: boolean;
};

type WorkflowToolRenderOptions = {
  isPartial: boolean;
  expanded: boolean;
};

type GuardLifecycleEvent = Record<string, never>;

export type {
  BashToolInput,
  GenericToolInput,
  GuardBeforeAgentStartEvent,
  GuardInputEvent,
  GuardLifecycleEvent,
  GuardToolCallEvent,
  GuardToolResultEvent,
  ReadToolInput,
  ToolContentBlock,
  WorkflowToolRenderOptions,
  WorkflowToolRenderResult,
  WorkflowToolRenderTheme,
  WorkflowToolResultDetails,
};
