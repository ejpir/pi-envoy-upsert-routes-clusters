type PreviewRouteLike = {
  match_kind?: string;
  match_value?: string;
  cluster?: string;
  env_tag?: string;
};

function collectPreviewEnvTags(
  routes: Array<{ env_tag?: string | undefined }>,
): string[] {
  return [...new Set(routes.map((route) => route.env_tag?.trim()).filter((envTag): envTag is string => !!envTag))];
}

function formatPreviewRouteLine(route: PreviewRouteLike): string {
  const envTagSuffix = route.env_tag?.trim() ? ` [env_tag=${route.env_tag.trim()}]` : "";
  return `+ route ${route.match_kind ?? "?"}:${route.match_value ?? "?"} -> ${route.cluster ?? "(none)"}${envTagSuffix}`;
}

export { collectPreviewEnvTags, formatPreviewRouteLine };
export type { PreviewRouteLike };
