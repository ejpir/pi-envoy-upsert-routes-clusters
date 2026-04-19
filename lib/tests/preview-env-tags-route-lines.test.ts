import { describe, expect, test } from "bun:test";
import { formatPreviewRouteLine } from "../preview-env-tags.ts";

describe("selection preview route lines", () => {
  test("includes env_tag on individual route preview lines", () => {
    expect(formatPreviewRouteLine({
      match_kind: "path",
      match_value: "/app/demo",
      cluster: "demo_cluster",
      env_tag: "dev,tst",
    })).toBe("+ route path:/app/demo -> demo_cluster [env_tag=dev,tst]");
  });

  test("omits env_tag suffix when no env_tag is present", () => {
    expect(formatPreviewRouteLine({
      match_kind: "path",
      match_value: "/app/demo",
      cluster: "demo_cluster",
    })).toBe("+ route path:/app/demo -> demo_cluster");
  });
});
