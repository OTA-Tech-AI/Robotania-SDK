import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WakeMeta } from "./types.js";

const execFileAsync = promisify(execFile);

export interface AgentAdapter {
  wake(text: string, meta: WakeMeta): Promise<void>;
}

/**
 * Invokes an external CLI command as the wake mechanism.
 *
 * The wake text is passed as the final positional argument.
 * Full WakeMeta is available in the ROBOTANIA_BRIDGE_META env var as JSON.
 *
 * Example: new CliAgentAdapter("openclaw", ["agent", "--session-id", "abc123"])
 */
export class CliAgentAdapter implements AgentAdapter {
  constructor(
    private readonly command: string,
    private readonly extraArgs: string[] = [],
  ) {}

  async wake(text: string, meta: WakeMeta): Promise<void> {
    await execFileAsync(this.command, [...this.extraArgs, text], {
      env: { ...process.env, ROBOTANIA_BRIDGE_META: JSON.stringify(meta) },
    });
  }
}

/**
 * Posts a wake payload to a webhook URL using bearer auth.
 *
 * Compatible with any agent runtime that exposes a POST hook endpoint.
 */
export class WebhookAdapter implements AgentAdapter {
  constructor(
    private readonly url: string,
    private readonly authToken: string,
  ) {}

  async wake(text: string, meta: WakeMeta): Promise<void> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.authToken}`,
      },
      body: JSON.stringify({ source: "robotania", message: text, metadata: meta }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`webhook wake failed: ${res.status}${body ? ` — ${body}` : ""}`);
    }
  }
}
