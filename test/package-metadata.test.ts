import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  name: string;
  version: string;
  license: string;
  files: string[];
  engines?: { node?: string };
  publishConfig?: { access?: string; registry?: string };
  bin?: Record<string, string>;
};

describe("npm package metadata", () => {
  it("declares MPL and includes the current version's license, source and component notices", () => {
    expect(manifest.license).toBe("MPL-2.0");
    for (const name of ["LICENSE", "SOURCE.md", "THIRD_PARTY_NOTICES.md"]) {
      expect(manifest.files).toContain(name);
      expect(readFileSync(resolve(root, name), "utf8").length).toBeGreaterThan(0);
    }
    expect(readFileSync(resolve(root, "LICENSE"), "utf8")).toMatch(/^Mozilla Public License Version 2\.0/);
    const sourceRef = /-dev\.\d+$/.test(manifest.version) ? "main" : `v${manifest.version}`;
    expect(readFileSync(resolve(root, "SOURCE.md"), "utf8")).toContain(`/tree/${sourceRef}`);
  });

  it("validates development and release source locations and normalizes license line endings", async () => {
    const utilityUrl = new URL("../scripts/release-utils.mjs", import.meta.url).href;
    const { releaseLegalNotice } = await import(utilityUrl);
    const directory = mkdtempSync(join(tmpdir(), "robotania-license-source-"));
    try {
      for (const name of ["package.json", "LICENSE", "SOURCE.md", "THIRD_PARTY_NOTICES.md"]) {
        copyFileSync(resolve(root, name), join(directory, name));
      }
      const source = "- Source: https://github.com/OTA-Tech-AI/Robotania-SDK/tree/main\n";
      writeFileSync(join(directory, "package.json"), JSON.stringify({ ...manifest, version: "1.3.8-dev.0" }));
      writeFileSync(join(directory, "SOURCE.md"), source);
      const original = releaseLegalNotice(directory);
      const text = readFileSync(join(directory, "LICENSE"), "utf8").replace(/\r?\n/g, "\r\n");
      writeFileSync(join(directory, "LICENSE"), text);
      expect(releaseLegalNotice(directory)).toBe(original);
      writeFileSync(join(directory, "SOURCE.md"), source.replace(`/tree/main`, `/tree/main-extra`));
      expect(() => releaseLegalNotice(directory)).toThrow("SOURCE.md must identify");
      const released = { ...manifest, version: "1.3.8" };
      writeFileSync(join(directory, "package.json"), JSON.stringify(released));
      writeFileSync(join(directory, "SOURCE.md"), source);
      expect(() => releaseLegalNotice(directory)).toThrow("SOURCE.md must identify");
      writeFileSync(join(directory, "SOURCE.md"), source.replace(`/tree/main`, `/tree/v${released.version}`));
      expect(releaseLegalNotice(directory)).toContain(`/tree/v${released.version}`);
      writeFileSync(join(directory, "SOURCE.md"), source.replace(`/tree/main`, `/tree/v${released.version}0`));
      expect(() => releaseLegalNotice(directory)).toThrow("SOURCE.md must identify");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
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
