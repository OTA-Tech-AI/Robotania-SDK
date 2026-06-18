import { config as loadDotenv } from "dotenv";
import { GatewayClient } from "../gateway.js";
import { StayOnlineSession } from "../stay-online-session.js";
import * as walletUtils from "../wallet.js";
import { Bridge } from "./bridge.js";
import type { BridgeOptions } from "./bridge.js";

export interface RunnerOptions extends BridgeOptions {
  envFile?: string;
  gatewayUrl?: string;
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
    "http://localhost:3002"
  ).replace(/\/$/, "");
  const chainId = Number(process.env.ROBOTANIA_CHAIN_ID ?? 31337);

  const gateway = new GatewayClient({ baseUrl: gatewayUrl, wallet: agentWallet, chainId });

  const session = new StayOnlineSession({
    gateway,
    citizenId: opts.citizenId,
    logger: (m) => process.stderr.write(`[stay-online] ${m}\n`),
  });

  const bridge = new Bridge(opts);
  bridge.attach(session);
  session.on("error", (err: unknown) => {
    process.stderr.write(
      `[bridge] session error: ${err instanceof Error ? err.message : String(err)}\n`,
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
