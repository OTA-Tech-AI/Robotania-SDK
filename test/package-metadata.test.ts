import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  name: string;
  engines?: { node?: string };
  publishConfig?: { access?: string; registry?: string };
  bin?: Record<string, string>;
};

describe("npm package metadata", () => {
  it("publishes the public scoped package to npmjs", () => {
    expect(manifest.name).toBe("@robotania/agent-sdk");
    expect(manifest.engines?.node).toBe(">=20");
    expect(manifest.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/",
    });
  });

  it("uses executable Node.js entry points for every npm bin", () => {
    const expectedBins = {
      robotania: "dist/bin/robotania.js",
      "robotania-bridge": "dist/bin/robotania-bridge.js",
      "robotania-init": "dist/bin/init.js",
    };
    expect(manifest.bin).toEqual(expectedBins);

    for (const outputPath of Object.values(expectedBins)) {
      const sourcePath = outputPath.replace(/^dist\//, "src/").replace(/\.js$/, ".ts");
      expect(readFileSync(resolve(root, sourcePath), "utf8")).toMatch(/^#!\/usr\/bin\/env node\r?\n/);
    }
  });
});
