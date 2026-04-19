import { describe, expect, test } from "bun:test";
import { collectPreviewEnvTags } from "../preview-env-tags.ts";

describe("ui.ts", () => {
  test("collects unique env tags for the selection preview", () => {
    expect(collectPreviewEnvTags([
      { env_tag: "dev,tst" },
      { env_tag: "dev,tst" },
      { env_tag: "acc,prd" },
      {},
      { env_tag: "  " },
    ])).toEqual(["dev,tst", "acc,prd"]);
  });
});
