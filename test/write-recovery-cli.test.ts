import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createRandom } from "../src/wallet.js";

describe("CLI recovery across independent processes", () => {
  it("reports a truncated accepted response as unknown and recovers the persisted key", async () => {
    const keys = new Set<string>(); const nonces: string[] = [];
    let submissions = 0; let breakFirst = true;
    const server = createServer(async (request, response) => {
      if (request.url === "/api/v1/agent/terms/status") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ ok: true, data: { available: false, accepted: false } })); return;
      }
      if (request.url !== "/api/v1/agent/citizens/register") { response.writeHead(404).end(); return; }
      let bytes = ""; for await (const chunk of request) bytes += chunk;
      const key = JSON.parse(bytes).idempotencyKey;
      if (!keys.has(key)) { keys.add(key); submissions++; }
      nonces.push(String(request.headers['x-agent-nonce']));
      response.setHeader("Content-Type", "application/json");
      if (breakFirst) {
        breakFirst = false; response.statusCode = 202;
        response.setHeader("Content-Length", "1000"); response.end('{"ok":true'); return;
      }
      response.end(JSON.stringify({ ok: true, data: { request_id: "original", action: "citizens/register",
        status: "FINALIZED", terminal: true, phase: "FINALIZED", tx_hash: "0x1", result: {}, next_action: "NONE" } }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const run = async () => {
      try {
        const result = await promisify(execFile)(process.execPath,
          [fileURLToPath(new URL("../dist/bin/robotania.js", import.meta.url)), "register-citizen", "--idempotency-key", "saved-before-submit"],
          { timeout: 60_000, env: { ...process.env, ROBOTANIA_PRIVATE_KEY: wallet.privateKey,
            ROBOTANIA_GATEWAY_URL: `http://127.0.0.1:${port}`, ROBOTANIA_CHAIN_ID: "421614",
            ROBOTANIA_CITIZEN_ACTION_RELAY: `0x${"1".repeat(40)}` } });
        return { code: 0, ...result };
      } catch (error) {
        const failed = error as { code: number; stdout: string; stderr: string };
        return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
      }
    };
    const wallet = createRandom();
    try {
      const first = await run();
      expect(first.code).toBe(2);
      const errorJson = first.stderr.slice(first.stderr.indexOf('{')).trim();
      expect(JSON.parse(errorJson)).toMatchObject({ terminal: false, idempotency_key: "saved-before-submit",
        error: { next_action: "OPERATOR_REVIEW" } });
      expect(first.stdout).toBe(""); expect(submissions).toBe(1); expect(nonces).toHaveLength(1);
      const second = await run(); expect(second.code).toBe(0);
      expect(JSON.parse(second.stdout)).toMatchObject({ request_id: "original", status: "FINALIZED" });
      expect(submissions).toBe(1); expect(keys.size).toBe(1);
      expect(nonces).toHaveLength(2); expect(nonces[0]).not.toBe(nonces[1]);
    } finally {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 150_000);
});
