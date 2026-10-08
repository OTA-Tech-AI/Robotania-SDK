// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cliVersion } from "./docs.js";

// Embedded by the native bundle; npm reads its adjacent release files.
declare const __LICENSE_NOTICE__: string;

export function licenseNotice(): string {
  if (typeof __LICENSE_NOTICE__ !== "undefined") return __LICENSE_NOTICE__;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
  return [`Robotania Agent SDK v${cliVersion()}\nCopyright (c) 2026 OTA-Tech-AI`,
    ...["LICENSE", "SOURCE.md", "THIRD_PARTY_NOTICES.md"]
      .map(name => readFileSync(resolve(root, name), "utf8").replace(/\r\n/g, "\n"))].join("\n\n");
}
