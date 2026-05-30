/**
 * Long-lived **stay online** session: authenticated agent WebSocket for push events,
 * plus periodic **HTTP** heartbeats so `last_heartbeat_at` stays fresh.
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { GatewayClient } from "./gateway.js";
import { parseAgentWsEvent, type AgentWsEvent } from "./agent-ws-events.js";

export type { AgentWsEvent } from "./agent-ws-events.js";
export { parseAgentWsEvent } from "./agent-ws-events.js";

/** Default interval between HTTP heartbeat posts while connected (10 minutes). */
export const DEFAULT_STAY_ONLINE_HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

/** Default backoff after disconnect (exponential capped). */
export const DEFAULT_STAY_ONLINE_RECONNECT: StayOnlineReconnectOptions = {
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  factor: 2,
};

/** Default max wait for the **first** successful WebSocket `open` ({@link StayOnlineSession.start}). */
export const DEFAULT_FIRST_OPEN_TIMEOUT_MS = 120_000;

export type HeartbeatExtras = Omit<Parameters<GatewayClient["heartbeat"]>[0], "citizenId">;

export interface StayOnlineReconnectOptions {
  /** After each failure/close `reconnectAttempt` increments; delay uses `initialDelayMs * factor^attempt` capped at `maxDelayMs`. */
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
}

/** Build `ws(s)://…/ws/agent` from the gateway HTTP origin (`GatewayClient.baseUrl`). */
export function gatewayBaseToWsUrl(httpBase: string): string {
  const base = httpBase.replace(/\/$/, "");
  if (base.startsWith("https://")) {
    return `wss://${base.slice("https://".length)}/ws/agent`;
  }
  if (base.startsWith("http://")) {
    return `ws://${base.slice("http://".length)}/ws/agent`;
  }
  throw new Error(`gatewayBaseToWsUrl: expected http(s) URL, got ${JSON.stringify(httpBase)}`);
}

export interface WebSocketLike {
  readonly readyState: number;
  on(event: "open", listener: () => void): this;
  on(
    event: "message",
    listener: (
      data: string | Buffer | ArrayBuffer | Buffer[],
      isBinary: boolean | undefined,
    ) => void,
  ): this;
  on(event: "close", listener: (code: number, reason: Buffer) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  once(event: "close", listener: (code: number, reason: Buffer) => void): this;
  send(data: string): void;
  close(): void;
}

export interface StayOnlineSessionOptions {
  gateway: GatewayClient;
  citizenId: string;
  /**
   * How often to POST `/api/v1/agent/heartbeat` while the WebSocket is open.
   * @default DEFAULT_STAY_ONLINE_HEARTBEAT_INTERVAL_MS (10 minutes)
   */
  heartbeatIntervalMs?: number;
  /** Fields forwarded to {@link GatewayClient.heartbeat} (excluding `citizenId`). */
  heartbeatParams?: HeartbeatExtras;
  /** Exponential backoff when the socket closes or connect fails. */
  reconnect?: Partial<StayOnlineReconnectOptions>;
  /**
   * Max time {@link StayOnlineSession.start} waits for first `open` (each call may override via parameter).
   * @default DEFAULT_FIRST_OPEN_TIMEOUT_MS
   */
  firstOpenTimeoutMs?: number;
  /** Defaults to Node `ws` against {@link gatewayBaseToWsUrl}. */
  createWebSocket?: (url: string) => WebSocketLike;
  logger?: (line: string) => void;
}

export class StayOnlineSession extends EventEmitter {
  private readonly gateway: GatewayClient;
  private readonly citizenId: string;
  private readonly intervalMs: number;
  private readonly heartbeatExtras: HeartbeatExtras;
  private readonly createWebSocket: (url: string) => WebSocketLike;
  private readonly logger?: (line: string) => void;
  private readonly reconnectOpts: StayOnlineReconnectOptions;
  private readonly defaultFirstOpenMs: number;

  private active = false;
  private connecting = false;
  private ws: WebSocketLike | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(opts: StayOnlineSessionOptions) {
    super();
    this.gateway = opts.gateway;
    this.citizenId = opts.citizenId;
    this.intervalMs = opts.heartbeatIntervalMs ?? DEFAULT_STAY_ONLINE_HEARTBEAT_INTERVAL_MS;
    this.heartbeatExtras = opts.heartbeatParams ?? {};
    this.logger = opts.logger;
    this.reconnectOpts = {
      ...DEFAULT_STAY_ONLINE_RECONNECT,
      ...opts.reconnect,
    };
    this.defaultFirstOpenMs = opts.firstOpenTimeoutMs ?? DEFAULT_FIRST_OPEN_TIMEOUT_MS;
    this.createWebSocket =
      opts.createWebSocket ??
      ((url: string): WebSocketLike => new WebSocket(url) as unknown as WebSocketLike);
  }

  /** Whether {@link StayOnlineSession.start} is in effect ({@link StayOnlineSession.stop} clears this). */
  isRunning(): boolean {
    return this.active;
  }

  private log(line: string): void {
    this.logger?.(line);
  }

  /**
   * Begin connecting (and auto-reconnect). Resolves on first socket `open`, or rejects after `firstOpenTimeoutMs`
   * (argument overrides ctor default).
   *
   * Idempotent while active — resolves immediately without waiting again.
   */
  async start(firstOpenTimeoutMs?: number): Promise<void> {
    if (this.active) return;

    const deadline = firstOpenTimeoutMs ?? this.defaultFirstOpenMs;

    try {
      await new Promise<void>((resolve, reject) => {
        let timeoutId: NodeJS.Timeout;
        const onOpen = (): void => {
          clearTimeout(timeoutId);
          resolve();
        };
        timeoutId = setTimeout(() => {
          this.off("open", onOpen);
          reject(new Error(`stay-online: first WebSocket open timed out (${deadline}ms)`));
        }, deadline);

        this.once("open", onOpen);
        this.active = true;
        this.reconnectAttempt = 0;
        void this.connectNow();
      });
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  /** Halt timers, reconnect, and closing the socket; resolves after the `'close'` event (or immediately if absent). */
  async stop(): Promise<void> {
    this.active = false;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();

    const sock = this.ws;
    if (
      sock != null &&
      sock.readyState !== WebSocket.CLOSED &&
      sock.readyState !== WebSocket.CLOSING
    ) {
      await new Promise<void>((resolve) => {
        try {
          sock.once("close", () => resolve());
          sock.close();
        } catch {
          resolve();
        }
      });
    }
    this.ws = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.active) return;
    this.clearReconnectTimer();

    const { initialDelayMs, maxDelayMs, factor } = this.reconnectOpts;
    this.reconnectAttempt += 1;
    const base = Math.min(maxDelayMs, initialDelayMs * factor ** this.reconnectAttempt);
    const delay = Math.floor(base * (0.85 + Math.random() * 0.3));
    this.log(`reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      void this.connectNow();
    }, delay);
  }

  private startHeartbeatLoop(): void {
    this.clearHeartbeatTimer();
    void this.postHeartbeatSafe();
    this.heartbeatTimer = setInterval(() => {
      void this.postHeartbeatSafe();
    }, this.intervalMs);
  }

  private async postHeartbeatSafe(): Promise<void> {
    if (!this.active || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      await this.gateway.heartbeat({
        citizenId: this.citizenId,
        ...this.heartbeatExtras,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`heartbeat failed: ${msg}`);
      this.emit("heartbeatError", e);
    }
  }

  private async connectNow(): Promise<void> {
    if (!this.active || this.connecting) return;
    this.connecting = true;
    this.clearReconnectTimer();

    try {
      const { token } = await this.gateway.getWsAuthToken(this.citizenId);
      if (!this.active) {
        this.connecting = false;
        return;
      }
      const wsUrl = `${gatewayBaseToWsUrl(this.gateway.baseUrl)}?ws_token=${encodeURIComponent(token)}`;
      const ws = this.createWebSocket(wsUrl);
      if (!this.active) {
        this.connecting = false;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        return;
      }

      ws.on("open", () => {
        this.connecting = false;
        this.reconnectAttempt = 0;
        this.log("WebSocket open");
        this.emit("open");
        this.startHeartbeatLoop();
      });

      ws.on("message", (data: string | Buffer | ArrayBuffer | Buffer[]) => {
        const raw =
          typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
              ? data.toString("utf8")
              : Array.isArray(data)
                ? Buffer.concat(data).toString("utf8")
                : Buffer.from(data).toString("utf8");
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const event = parseAgentWsEvent(parsed);
          if (event) {
            this.emit("message", event);
            this.emit("*", event);
            this.emit(event.type, event);
          } else {
            this.emit("message", parsed);
            this.emit("*", parsed);
            const t = parsed.type;
            if (typeof t === "string" && t !== "") this.emit(t, parsed);
          }
        } catch {
          /* ignore malformed */
        }
      });

      ws.on("error", (err: Error) => {
        this.log(`WebSocket error: ${err.message}`);
        this.emit("error", err);
      });

      ws.on("close", (code: number) => {
        this.connecting = false;
        this.clearHeartbeatTimer();
        this.ws = null;
        this.log(`WebSocket closed code=${code}`);
        this.emit("close", code);
        if (this.active) this.scheduleReconnect();
      });

      this.ws = ws;
    } catch (e) {
      this.connecting = false;
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`connect failed: ${msg}`);
      this.emit("connectError", e);
      if (this.active) this.scheduleReconnect();
    }
  }

  /**
   * Async iterator over typed {@link AgentWsEvent} `message` emissions.
   * Ends when {@link StayOnlineSession.stop} is called and the queue drains.
   */
  events(): AsyncIterable<AgentWsEvent> {
    const self = this;
    const queue: AgentWsEvent[] = [];
    let wake: (() => void) | undefined;
    const onMessage = (ev: AgentWsEvent) => {
      queue.push(ev);
      wake?.();
    };
    self.on("message", onMessage);
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<AgentWsEvent>> {
            while (queue.length === 0) {
              if (!self.isRunning()) {
                self.off("message", onMessage);
                return { done: true, value: undefined };
              }
              await new Promise<void>((r) => {
                wake = r;
              });
              wake = undefined;
            }
            return { done: false, value: queue.shift()! };
          },
          async return(): Promise<IteratorResult<AgentWsEvent>> {
            self.off("message", onMessage);
            return { done: true, value: undefined };
          },
        };
      },
    };
  }
}
