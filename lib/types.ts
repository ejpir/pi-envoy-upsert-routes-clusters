export type UpsertRouteDecision = {
  match_kind?: string;
  match_value?: string;
  cluster?: string;
  status?: string;
  add?: boolean;
  assessment?: {
    disposition?: string;
  };
};

export type UpsertPlanItem = {
  context?: string;
  flavor?: string;
  match_mode?: string;
  cluster?: string;
  cluster_status?: string;
  cluster_host?: string | null;
  warnings?: string[];
  routes?: UpsertRouteDecision[];
};

export type UpsertWorkflowResult = {
  schema_version?: string;
  state?: string;
  status?: string;
  error_kind?: string | null;
  target_virtual_host?: string | null;
  summary?: {
    add_routes?: number;
    add_clusters?: number;
    skipped_route_exists?: number;
    skipped_route_overlap?: number;
    warnings?: number;
  } | null;
  warnings?: Array<{ message?: string } | string> | null;
  additions?: {
    routes?: Array<{
      context?: string;
      flavor?: string;
      match_kind?: string;
      match_value?: string;
      cluster?: string;
      env_tag?: string;
      yaml?: string;
    }>;
    clusters?: Array<{
      name?: string;
      host?: string;
    }>;
  } | null;
  next_step?: string;
  message?: string;
  check?: {
    payload?: {
      items?: UpsertPlanItem[];
    };
  } | null;
};

export type ApprovalChoice =
  | { action: "apply"; selectedItemIndexes: number[] }
  | { action: "cancel" };

export type ApplyAuditTrail = {
  mode: "direct";
  timestamp: string;
  logPath: string | null;
  selectedItemIndexes: number[];
  selectedCount: number;
  requestCount: number;
  selectedSummaries: string[];
  selectedContexts: string[];
  routeCount: number;
  clusterCount: number;
  warningCount: number;
  targetVirtualHost: string | null;
  resultState: string;
};

export type UsageStats = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
};

export type WorkflowRunKind = "planning" | "applying";

export type WorkflowUsageTotals = {
  planning: UsageStats;
  applying: UsageStats;
  cumulative: UsageStats;
  planningIsDirect?: boolean;
  applyingIsDirect?: boolean;
};

export type SubagentProgress = {
  phase: "idle" | "starting" | "thinking" | "tool" | "responding" | "ready" | "failed";
  status: string;
  detail: string;
  reads: number;
  bashCalls: number;
  usage: UsageStats;
  events: string[];
};

export type ThemeLike = {
  fg?: (color: string, text: string) => string;
};

export type DecisionRow = {
  status: string;
  line: string;
};
