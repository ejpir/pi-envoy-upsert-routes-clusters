import { describe, expect, test } from "bun:test";
import {
  buildSelectedRequestText,
  collectSelectableWorkflowItems,
  defaultSelectedWorkflowItemIndexes,
} from "../selection.ts";

describe("selection.ts", () => {
  test("collects selectable workflow items from applyable routes/clusters", () => {
    const result = {
      check: {
        payload: {
          items: [
            {
              context: "/app/demo",
              flavor: "http",
              match_mode: "path",
              cluster: "demo_cluster",
              cluster_status: "apply",
              cluster_host: "demo.internal",
              routes: [{ status: "apply", add: true }],
            },
            {
              context: "/skip/me",
              flavor: "http",
              match_mode: "path",
              cluster: "skip_cluster",
              cluster_status: "skip",
              routes: [{ status: "skip_exists", add: false }],
            },
          ],
        },
      },
    };

    expect(collectSelectableWorkflowItems(result)).toEqual([
      {
        itemIndex: 0,
        context: "/app/demo",
        flavor: "http",
        matchMode: "path",
        cluster: "demo_cluster",
        addRoutes: 1,
        addCluster: true,
      },
    ]);
    expect(defaultSelectedWorkflowItemIndexes(result)).toEqual([0]);
  });

  test("reconstructs filtered http request payload from workflow result", () => {
    const result = {
      additions: {
        routes: [
          {
            context: "/app/demo",
            cluster: "demo_cluster",
            env_tag: "dev,tst",
            yaml: `              - match: { path: "/app/demo" }\n                route:\n                  cluster: demo_cluster\n                  host_rewrite_literal: demo.internal\n                  timeout: 45s\n                env_tag: "dev,tst"`,
          },
        ],
      },
      check: {
        payload: {
          items: [
            {
              context: "/app/demo",
              flavor: "http",
              match_mode: "path",
              cluster: "demo_cluster",
              cluster_status: "apply",
              cluster_host: "demo.internal",
              routes: [{ status: "apply", add: true, cluster: "demo_cluster" }],
            },
          ],
        },
      },
    };

    expect(JSON.parse(buildSelectedRequestText(result, [0]))).toEqual([
      {
        context: "/app/demo",
        flavor: "http",
        match: "path",
        forward_host: "demo.internal",
        env_tag: "dev,tst",
        cluster_name: "demo_cluster",
        timeout: "45s",
      },
    ]);
  });

  test("reconstructs filtered s3 path+prefix payload from route yaml", () => {
    const result = {
      additions: {
        routes: [
          {
            context: "/app/spa",
            cluster: "s3_cluster",
            env_tag: "dev,tst,acc,prd",
            match_kind: "prefix",
            yaml: `              - match: { prefix: "/app/spa" }\n                route:\n                  cluster: s3_cluster\n                  prefix_rewrite: /${"${otap_stage_lowercase}"}/spa\n                  timeout: 60s\n                env_tag: "dev,tst,acc,prd"`,
          },
          {
            context: "/app/spa",
            cluster: "s3_cluster",
            env_tag: "dev,tst,acc,prd",
            match_kind: "path",
            yaml: `              - match: { path: "/app/spa" }\n                route:\n                  cluster: s3_cluster\n                  prefix_rewrite: /${"${otap_stage_lowercase}"}/spa/index.html\n                  timeout: 60s\n                env_tag: "dev,tst,acc,prd"`,
          },
        ],
      },
      check: {
        payload: {
          items: [
            {
              context: "/app/spa",
              flavor: "s3",
              match_mode: "path+prefix",
              cluster: "s3_cluster",
              cluster_status: "skip",
              cluster_host: null,
              routes: [
                { status: "apply", add: true, cluster: "s3_cluster" },
                { status: "apply", add: true, cluster: "s3_cluster" },
              ],
            },
          ],
        },
      },
    };

    expect(JSON.parse(buildSelectedRequestText(result, [0]))).toEqual([
      {
        context: "/app/spa",
        flavor: "s3",
        match: "path+prefix",
        env_tag: "dev,tst,acc,prd",
        cluster_name: "s3_cluster",
        s3_prefix_rewrite: "/${otap_stage_lowercase}/spa",
      },
    ]);
  });
});
