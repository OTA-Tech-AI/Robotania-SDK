// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
export { Bridge } from "./bridge.js";
export type { BridgeOptions } from "./bridge.js";

export { EventFilter, DEFAULT_SUBSCRIPTIONS } from "./event-filter.js";

export { Dedupe } from "./dedupe.js";

export { CliAgentAdapter, WebhookAdapter } from "./adapter.js";
export type { AgentAdapter } from "./adapter.js";

export { runBridge } from "./runner.js";
export type { RunnerOptions } from "./runner.js";

export type { WakeMeta, WsEventType } from "./types.js";
