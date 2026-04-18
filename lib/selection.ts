import type { UpsertPlanItem, UpsertWorkflowResult } from "./types.ts";

type SelectableWorkflowItem = {
  itemIndex: number;
  context: string;
  flavor: string;
  matchMode: string;
  cluster: string;
  addRoutes: number;
  addCluster: boolean;
};

type ReconstructedRequest = {
  context: string;
  flavor: string;
  match: string;
  forward_host?: string;
  env_tag?: string;
  add_filter?: boolean;
  cluster_name?: string;
  timeout?: string;
  host_rewrite_literal?: string;
  s3_prefix_rewrite?: string;
  s3_index_rewrite?: string;
};

type ParsedRouteYaml = {
  envTag?: string;
  timeout?: string;
  hostRewriteLiteral?: string;
  prefixRewrite?: string;
  regexSubstitution?: string;
  hasFilter: boolean;
};

function collectSelectableWorkflowItems(result: UpsertWorkflowResult): SelectableWorkflowItem[] {
  const items = result.check?.payload?.items ?? [];
  return items
    .map((item, itemIndex) => {
      const addRoutes = (item.routes ?? []).filter((route) => route.add || route.status === "apply").length;
      const addCluster = item.cluster_status === "apply";
      return {
        itemIndex,
        context: item.context ?? "(no context)",
        flavor: item.flavor ?? "(unknown)",
        matchMode: item.match_mode ?? "(unknown)",
        cluster: item.cluster ?? "(unknown)",
        addRoutes,
        addCluster,
      };
    })
    .filter((item) => item.addRoutes > 0 || item.addCluster);
}

function defaultSelectedWorkflowItemIndexes(result: UpsertWorkflowResult): number[] {
  return collectSelectableWorkflowItems(result).map((item) => item.itemIndex);
}

function summarizeSelectableWorkflowItem(item: SelectableWorkflowItem): string {
  const parts = [`${item.context}`, `[${item.flavor}/${item.matchMode}]`];
  if (item.addRoutes > 0) {
    parts.push(`${item.addRoutes} route(s)`);
  }
  if (item.addCluster) {
    parts.push("cluster");
  }
  return parts.join(" • ");
}

function stripYamlScalar(rawValue: string | undefined): string | undefined {
  if (!rawValue) {
    return undefined;
  }
  const value = rawValue.trim();
  if (!value) {
    return undefined;
  }
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function parseRouteYaml(yamlText: string | undefined): ParsedRouteYaml {
  const envTag = stripYamlScalar(yamlText?.match(/^\s*env_tag:\s*(.+)$/m)?.[1]);
  const timeout = stripYamlScalar(yamlText?.match(/^\s*timeout:\s*(.+)$/m)?.[1]);
  const hostRewriteLiteral = stripYamlScalar(yamlText?.match(/^\s*host_rewrite_literal:\s*(.+)$/m)?.[1]);
  const prefixRewrite = stripYamlScalar(yamlText?.match(/^\s*prefix_rewrite:\s*(.+)$/m)?.[1]);
  const regexSubstitution = stripYamlScalar(yamlText?.match(/^\s*substitution:\s*(.+)$/m)?.[1]);
  const hasFilter = /\n\s*typed_per_filter_config:\s*\n\s*cookie_session_isolation:/m.test(`\n${yamlText ?? ""}`);
  return {
    envTag,
    timeout,
    hostRewriteLiteral,
    prefixRewrite,
    regexSubstitution,
    hasFilter,
  };
}

function simplifyS3BaseRewrite(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value
    .replace(/\\1\/index\.html$/, "")
    .replace(/\\1$/, "");
}

function buildRequestFromPlanItem(result: UpsertWorkflowResult, itemIndex: number): ReconstructedRequest {
  const item = result.check?.payload?.items?.[itemIndex] as UpsertPlanItem | undefined;
  if (!item?.context || !item.flavor || !item.match_mode) {
    throw new Error(`Selection item #${itemIndex + 1} is missing context/flavor/match metadata.`);
  }

  const routeAdditions = (result.additions?.routes ?? []).filter((route) => {
    const sameContext = route.context === item.context;
    const sameCluster = !item.cluster || !route.cluster || route.cluster === item.cluster;
    return sameContext && sameCluster;
  });
  const parsedRoutes = routeAdditions.map((route) => ({ route, parsed: parseRouteYaml(route.yaml) }));
  const firstRoute = parsedRoutes[0]?.parsed;
  const clusterName = item.cluster ?? routeAdditions[0]?.cluster;
  const request: ReconstructedRequest = {
    context: item.context,
    flavor: item.flavor,
    match: item.match_mode,
  };

  if (clusterName) {
    request.cluster_name = clusterName;
  }
  if (firstRoute?.envTag ?? routeAdditions[0]?.env_tag) {
    request.env_tag = firstRoute?.envTag ?? routeAdditions[0]?.env_tag;
  }
  if (firstRoute?.timeout && firstRoute.timeout !== "60s") {
    request.timeout = firstRoute.timeout;
  }
  if (firstRoute?.hasFilter) {
    request.add_filter = true;
  }

  if (item.flavor !== "s3") {
    if (!item.cluster_host) {
      throw new Error(`Selection item '${item.context}' is missing cluster host, so the filtered request cannot be reconstructed.`);
    }
    request.forward_host = item.cluster_host;
    if (firstRoute?.hostRewriteLiteral && firstRoute.hostRewriteLiteral !== item.cluster_host) {
      request.host_rewrite_literal = firstRoute.hostRewriteLiteral;
    }
    return request;
  }

  if (item.cluster_host) {
    request.forward_host = item.cluster_host;
  }
  if (firstRoute?.hostRewriteLiteral && firstRoute.hostRewriteLiteral !== "s3.eu-west-1.amazonaws.com") {
    request.host_rewrite_literal = firstRoute.hostRewriteLiteral;
  }

  const prefixRoute = parsedRoutes.find((entry) => entry.route.match_kind === "prefix")?.parsed;
  const pathRoute = parsedRoutes.find((entry) => entry.route.match_kind === "path")?.parsed;
  const safeRegexRoutes = parsedRoutes
    .filter((entry) => entry.route.match_kind === "safe_regex")
    .map((entry) => entry.parsed)
    .filter((entry) => !!entry.regexSubstitution);

  if (item.match_mode === "path+prefix") {
    request.s3_prefix_rewrite = prefixRoute?.prefixRewrite ?? simplifyS3BaseRewrite(pathRoute?.prefixRewrite);
    if (pathRoute?.prefixRewrite && request.s3_prefix_rewrite && pathRoute.prefixRewrite !== `${request.s3_prefix_rewrite}/index.html`) {
      request.s3_index_rewrite = pathRoute.prefixRewrite;
    }
  } else if (item.match_mode === "prefix") {
    request.s3_prefix_rewrite = prefixRoute?.prefixRewrite;
  } else if (item.match_mode === "path") {
    request.s3_prefix_rewrite = simplifyS3BaseRewrite(pathRoute?.prefixRewrite);
    if (pathRoute?.prefixRewrite && request.s3_prefix_rewrite && pathRoute.prefixRewrite !== `${request.s3_prefix_rewrite}/index.html`) {
      request.s3_index_rewrite = pathRoute.prefixRewrite;
    }
  } else if (item.match_mode === "safe_regex_spa") {
    const baseRewrite = safeRegexRoutes
      .map((entry) => simplifyS3BaseRewrite(entry.regexSubstitution))
      .find((value) => !!value);
    request.s3_prefix_rewrite = baseRewrite;
  }

  if (!request.s3_prefix_rewrite && !request.forward_host) {
    throw new Error(`Selection item '${item.context}' does not expose enough route details for partial apply reconstruction.`);
  }

  return request;
}

function buildSelectedRequestPayload(result: UpsertWorkflowResult, selectedItemIndexes: number[]): ReconstructedRequest[] {
  const uniqueIndexes = [...new Set(selectedItemIndexes)].sort((left, right) => left - right);
  if (uniqueIndexes.length === 0) {
    throw new Error("No workflow items selected for apply.");
  }
  return uniqueIndexes.map((itemIndex) => buildRequestFromPlanItem(result, itemIndex));
}

function buildSelectedRequestText(result: UpsertWorkflowResult, selectedItemIndexes: number[]): string {
  return JSON.stringify(buildSelectedRequestPayload(result, selectedItemIndexes), null, 2);
}

export {
  buildSelectedRequestPayload,
  buildSelectedRequestText,
  collectSelectableWorkflowItems,
  defaultSelectedWorkflowItemIndexes,
  summarizeSelectableWorkflowItem,
};

export type { ReconstructedRequest, SelectableWorkflowItem };
