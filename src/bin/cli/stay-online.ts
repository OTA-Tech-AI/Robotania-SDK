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
      note:
        "Token minted via signed POST /api/v1/agent/ws-auth — single-use; connecting with it consumes it.",
    });
    return;
  }

  const sessionOpts: ConstructorParameters<typeof StayOnlineSession>[0] = {
    gateway: cfg.gatewayClient,
    citizenId,
    heartbeatIntervalMs: interval,
    logger: (m) => log(`stay-online: ${m}`),
  };
  if (Object.keys(heartbeatParams).length > 0) sessionOpts.heartbeatParams = heartbeatParams;

  const session = new StayOnlineSession(sessionOpts);

  session.on("message", (payload: Record<string, unknown>) => {
    process.stdout.write(JSON.stringify(payload) + "\n");
  });

  await session.start();

  log(`stay-online running — HTTP heartbeat every ${interval} ms; Ctrl+C to stop`);

  await new Promise<void>((resolve) => {
    const onSig = (): void => resolve();
    process.once("SIGINT", onSig);
    process.once("SIGTERM", onSig);
  });

  await session.stop();
}
