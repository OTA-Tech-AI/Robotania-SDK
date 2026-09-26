import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export function runNpm(args, options = {}) {
  const directories = [dirname(process.execPath), ...(process.env.PATH ?? "").split(delimiter)];
  for (const directory of directories) {
    if (!directory) continue;
    const candidates = [join(directory, "node_modules/npm/bin/npm-cli.js")];
    const executable = join(directory, process.platform === "win32" ? "npm.cmd" : "npm");
    if (existsSync(executable)) {
      candidates.push(join(dirname(realpathSync(executable)), "npm-cli.js"));
    }
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return execFileSync(process.execPath, [candidate, ...args], options);
      }
    }
  }
  throw new Error("Cannot locate npm-cli.js. Install Node.js with npm and check PATH.");
}

// Windows npm and installed npm bins are .cmd shims and require a shell.
// Quote each argument and reject shell expansion/control characters.
export function runPackageCommand(command, args, options = {}) {
  if (process.platform !== "win32") {
    return execFileSync(command, args, options);
  }

  const quote = (value) => {
    if (/["%!?&|<>^\r\n]/.test(value)) {
      throw new Error("Unsupported shell character in package command argument");
    }
    return `"${value}"`;
  };

  const commandLine = [command, ...args].map(quote).join(" ");
  return execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${commandLine}"`], {
    ...options,
    windowsVerbatimArguments: true,
  });
}
