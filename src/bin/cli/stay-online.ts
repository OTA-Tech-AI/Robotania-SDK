/**
 * CLI: authenticated WebSocket listener + periodic HTTP heartbeats (see {@link StayOnlineSession}).
 */

import { loadConfig, flag, requireFlag } from "./config.js";
import type { HeartbeatExtras } from "../../stay-online-session.js";
import {
  StayOnlineSession,
  DEFAULT_STAY_ONLINE_HEARTBEAT_INTERVAL_MS,
  gatewayBaseToWsUrl,
} from "../../stay-online-session.js";
import { FileEventCursorStore } from "../../event-cursor.js";
import { resolve } from "node:path";
import { log, result } from "./output.js";

export async function runStayOnline(args: string[], isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const intervalRaw = flag(args, "--heartbeat-interval-ms");
  const interval =
    intervalRaw != null ? Number(intervalRaw) : DEFAULT_STAY_ONLINE_HEARTBEAT_INTERVAL_MS;
  if (!Number.isFinite(interval) || interval < 1_000) {
    process.stderr.write(
      JSON.stringify({
        error: "--heartbeat-interval-ms must be a number ≥ 1000 (milliseconds)",
      }) + "\n",
    );
    process.exit(1);
  }

  const status = flag(args, "--status") as HeartbeatExtras["status"] | undefined;
  const softwareVersion = flag(args, "--software-version");
  const cursorFile = resolve(
    flag(args, "--cursor-file") ??
      process.env.ROBOTANIA_EVENT_CURSOR_FILE ??
      `.robotania/event-cursor-${citizenId}.json`,
  );

  const heartbeatParams: HeartbeatExtras = {};
  if (status != null) heartbeatParams.status = status;
  if (softwareVersion !== undefined) heartbeatParams.software_version = softwareVersion;

  const cfg = loadConfig();

  if (isDryRun) {
    const wsAuth = await cfg.gatewayClient.getWsAuthToken(citizenId);
    result({
      dry_run: true,
      gateway_base: cfg.gatewayClient.baseUrl,
      ws_url_masked: `${gatewayBaseToWsUrl(cfg.gatewayClient.baseUrl)}?ws_token=<redacted>`,
      ws_auth_expires_at: wsAuth.expiresAt,
      heartbeat_interval_ms: interval,
      event_cursor_file: cursorFile,
      note:
        "Token minted via signed POST /api/v1/agent/ws-auth — single-use; connecting with it consumes it.",
    });
    return;
  }

  const sessionOpts: ConstructorParameters<typeof StayOnlineSession>[0] = {
    gateway: cfg.gatewayClient,
    citizenId,
    heartbeatIntervalMs: interval,
    cursorStore: new FileEventCursorStore(cursorFile),
    // This CLI only reports events; it does not perform asynchronous work.
    autoCheckpoint: true,
    logger: (m) => log(`stay-online: ${m}`),
  };
  if (Object.keys(heartbeatParams).length > 0) sessionOpts.heartbeatParams = heartbeatParams;

  const session = new StayOnlineSession(sessionOpts);
  let finish: (() => void) | undefined;
  const finished = new Promise<void>((resolveFinished) => {
    finish = resolveFinished;
  });

  session.on("message", (payload: Record<string, unknown>) => {
    process.stdout.write(JSON.stringify(payload) + "\n");
  });
  session.on("cursorExpired", (payload: Record<string, unknown>) => {
    process.stdout.write(JSON.stringify(payload) + "\n");
    process.stderr.write(
      "stay-online: cursor expired; reconcile runtime tasks/context, run runtime cursor-reset, then restart\n",
    );
    process.exitCode = 2;
    finish?.();
  });
  session.on("cursorAhead", (payload: Record<string, unknown>) => {
    process.stdout.write(JSON.stringify(payload) + "\n");
    process.stderr.write(
      "stay-online: cursor is ahead; reconcile runtime tasks/context, run runtime cursor-reset --after-sequence, then restart\n",
    );
    process.exitCode = 2;
    finish?.();
  });

  await session.start();

  log(`stay-online running — HTTP heartbeat every ${interval} ms; Ctrl+C to stop`);

  const signal = new Promise<void>((resolveSignal) => {
    const onSig = (): void => resolveSignal();
    process.once("SIGINT", onSig);
    process.once("SIGTERM", onSig);
  });
  await Promise.race([finished, signal]);

  await session.stop();
}
