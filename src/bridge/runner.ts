import { config as loadDotenv } from "dotenv";
import { GatewayClient } from "../gateway.js";
import { StayOnlineSession } from "../stay-online-session.js";
import * as walletUtils from "../wallet.js";
import { Bridge } from "./bridge.js";
import type { BridgeOptions } from "./bridge.js";
import { LOCAL_DEV_GATEWAY_URL } from "../defaults.js";
import { FileEventCursorStore } from "../event-cursor.js";
import { resolve } from "node:path";

export interface RunnerOptions extends BridgeOptions {
  envFile?: string;
  gatewayUrl?: string;
  eventCursorFile?: string;
}

export async function runBridge(opts: RunnerOptions): Promise<void> {
  if (opts.envFile) {
    loadDotenv({ path: opts.envFile });
  } else {
    loadDotenv();
  }

  const agentWallet = walletUtils.loadFromEnv();
  const gatewayUrl = (
    opts.gatewayUrl ??
    process.env.ROBOTANIA_GATEWAY_URL ??
    LOCAL_DEV_GATEWAY_URL
  ).replace(/\/$/, "");
  const chainId = Number(process.env.ROBOTANIA_CHAIN_ID ?? 31337);

  const gateway = new GatewayClient({ baseUrl: gatewayUrl, wallet: agentWallet, chainId });

  const session = new StayOnlineSession({
    gateway,
    citizenId: opts.citizenId,
    cursorStore: new FileEventCursorStore(
      resolve(
        opts.eventCursorFile ??
          process.env.ROBOTANIA_EVENT_CURSOR_FILE ??
          `.robotania/event-cursor-${opts.citizenId}.json`,
      ),
    ),
    autoCheckpoint: false,
    logger: (m) => process.stderr.write(`[stay-online] ${m}\n`),
  });

  const bridge = new Bridge(opts);
  bridge.attach(session);
  session.on("error", (err: unknown) => {
    process.stderr.write(
      `[bridge] session error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });
  session.on("cursorExpired", (payload: Record<string, unknown>) => {
    process.stderr.write(
      `[bridge] event cursor expired; reconcile "robotania runtime tasks" before accepting the retention gap: ${JSON.stringify(payload)}\n`,
    );
  });
  session.on("cursorAhead", (payload: Record<string, unknown>) => {
    process.stderr.write(
      `[bridge] event cursor is ahead; reconcile tasks, choose an authoritative cursor, then reset it: ${JSON.stringify(payload)}\n`,
    );
  });
  session.on("taskBootstrapRequired", () => {
    process.stderr.write(
      "[bridge] no prior event cursor; reconcile active tasks before relying on new event wakes\n",
    );
  });

  await session.start();
  process.stderr.write(`[bridge] connected — citizen ${opts.citizenId}\n`);

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });

  await session.stop();
  process.stderr.write(`[bridge] stopped\n`);
}
