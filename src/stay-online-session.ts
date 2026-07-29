/**
 * Long-lived **stay online** session: authenticated agent WebSocket for push events,
 * plus periodic **HTTP** heartbeats so `last_heartbeat_at` stays fresh.
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { GatewayClient } from "./gateway.js";
import { parseAgentWsEvent, type AgentWsEvent } from "./agent-ws-events.js";
import type { EventCursorStore } from "./event-cursor.js";

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
  /**
   * Optional durable cursor store. When provided, reconnects resume after the
   * last event delivered to local listeners instead of relying on WebSocket
   * uptime.
   */
  cursorStore?: EventCursorStore;
  /**
   * Save after synchronous event listeners return. With a durable cursor,
   * the default is false: acknowledge only after awaited work succeeds.
   */
  autoCheckpoint?: boolean;
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
  private readonly cursorStore?: EventCursorStore;
  private readonly autoCheckpoint: boolean;

  private active = false;
  private connecting = false;
  private ws: WebSocketLike | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastSequence = 0;
  private highestQueuedSequence = 0;
  private cursorLoaded = false;
  private cursorSave: Promise<void> = Promise.resolve();
  private cursorBlocked = false;

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
    this.cursorStore = opts.cursorStore;
    this.autoCheckpoint = opts.autoCheckpoint ?? opts.cursorStore == null;
    this.createWebSocket =
      opts.createWebSocket ??
      ((url: string): WebSocketLike => new WebSocket(url) as unknown as WebSocketLike);
  }

  /** Whether {@link StayOnlineSession.start} is in effect ({@link StayOnlineSession.stop} clears this). */
  isRunning(): boolean {
    return this.active;
  }

  /** Whether reconnect is paused until an expired cursor is reconciled. */
  isCursorBlocked(): boolean {
    return this.cursorBlocked;
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
    // Wake any pending events() iterators so they observe !isRunning() and terminate.
    this.emit("stopped");

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
    await this.cursorSave;
  }

  /**
   * Close the current socket and reconnect from the last acknowledged event.
   * Consumers use this after a delivery handler fails so later events cannot
   * advance the cursor past the failed event.
   */
  reconnect(): void {
    if (!this.active || this.cursorBlocked) return;
    this.clearReconnectTimer();
    const socket = this.ws;
    if (
      socket != null &&
      socket.readyState !== WebSocket.CLOSED &&
      socket.readyState !== WebSocket.CLOSING
    ) {
      socket.close();
      return;
    }
    if (!this.connecting) this.scheduleReconnect();
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
    if (!this.active || this.cursorBlocked) return;
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
      if (!this.cursorLoaded) {
        this.lastSequence = Math.max(
          this.lastSequence,
          this.cursorStore ? await this.cursorStore.load() : 0,
        );
        this.highestQueuedSequence = this.lastSequence;
        this.cursorLoaded = true;
      }
      // A reconnect must resume only after all successful local acknowledgements
      // have either reached durable storage or failed without advancing.
      await this.cursorSave;
      const { token } = await this.gateway.getWsAuthToken(this.citizenId);
      if (!this.active) {
        this.connecting = false;
        return;
      }
      const wsUrl =
        `${gatewayBaseToWsUrl(this.gateway.baseUrl)}` +
        `?ws_token=${encodeURIComponent(token)}&after=${this.lastSequence}`;
      const ws = this.createWebSocket(wsUrl);
      let deliveryFailed = false;
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
        if (deliveryFailed) return;
        const raw =
          typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
              ? data.toString("utf8")
              : Array.isArray(data)
                ? Buffer.concat(data).toString("utf8")
                : Buffer.from(data).toString("utf8");
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }
        try {
          if (parsed.type === "EVENT_CURSOR_EXPIRED" || parsed.type === "EVENT_CURSOR_AHEAD") {
            // Do not advance automatically: the consumer must reconcile current
            // tasks/context before intentionally accepting the retention gap.
            this.cursorBlocked = true;
            this.emit(
              parsed.type === "EVENT_CURSOR_EXPIRED" ? "cursorExpired" : "cursorAhead",
              parsed,
            );
            return;
          }
          if (parsed.type === "CONNECTED" && parsed.taskBootstrapRequired === true) {
            this.emit("taskBootstrapRequired", parsed);
          }
          const event = parseAgentWsEvent(parsed);
          if (event) {
            const sequence = Number(parsed.sequence);
            if (Number.isSafeInteger(sequence) && sequence > 0) {
              event.sequence = sequence;
            }
            if (typeof parsed.eventId === "string") event.eventId = parsed.eventId;
            if (parsed.arenaMode === "VERIFIED" || parsed.arenaMode === "PRACTICE") {
              event.arenaMode = parsed.arenaMode;
            }
            if (typeof parsed.revision === "string") event.revision = parsed.revision;
            if (typeof parsed.createdAt === "string") event.createdAt = parsed.createdAt;
            this.emit("message", event);
            this.emit("*", event);
            this.emit(event.type, event);
            if (this.autoCheckpoint && event.sequence != null) {
              this.acknowledge(event.sequence);
            }
          } else {
            this.emit("message", parsed);
            this.emit("*", parsed);
            const t = parsed.type;
            if (typeof t === "string" && t !== "") this.emit(t, parsed);
          }
        } catch (error) {
          const sequence = Number(parsed.sequence);
          this.log(
            `event handler failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (Number.isSafeInteger(sequence) && sequence > 0) {
            deliveryFailed = true;
            if (this.listenerCount("handlerError") > 0) {
              this.emit("handlerError", error, parsed);
            }
            this.reconnect();
          }
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
        if (this.active && !this.cursorBlocked) this.scheduleReconnect();
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

  /** Persist a successfully handled durable event sequence. */
  acknowledge(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence <= this.highestQueuedSequence) return;
    this.highestQueuedSequence = sequence;
    if (!this.cursorStore) {
      this.lastSequence = sequence;
      return;
    }
    this.cursorSave = this.cursorSave
      .then(async () => {
        await this.cursorStore!.save(sequence);
        this.lastSequence = Math.max(this.lastSequence, sequence);
      })
      .catch((error) => {
        if (this.highestQueuedSequence === sequence) {
          this.highestQueuedSequence = this.lastSequence;
        }
        this.log(
          `event cursor save failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.emit("cursorError", error);
      });
  }

  /**
   * Resume after `EVENT_CURSOR_EXPIRED`.
   *
   * Call only after rebuilding local state from active tasks and authoritative
   * task context. Saving `floor - 1` preserves the first retained event.
   */
  async acceptRetentionFloor(retentionFloorSequence: number): Promise<void> {
    if (!Number.isSafeInteger(retentionFloorSequence) || retentionFloorSequence < 1) {
      throw new Error("retention floor sequence must be a positive safe integer");
    }
    await this.cursorSave;
    const resumeAfter = retentionFloorSequence - 1;
    this.lastSequence = resumeAfter;
    this.highestQueuedSequence = resumeAfter;
    if (this.cursorStore) await this.cursorStore.save(resumeAfter);
    this.cursorBlocked = false;
    if (this.active && this.ws == null && !this.connecting) void this.connectNow();
  }

  /**
   * Resume from an explicit authoritative cursor after task reconciliation.
   * This is used when the stored cursor is ahead of a replaced delivery stream.
   */
  async resetCursor(afterSequence: number): Promise<void> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error("event cursor must be a non-negative safe integer");
    }
    await this.cursorSave;
    this.lastSequence = afterSequence;
    this.highestQueuedSequence = afterSequence;
    if (this.cursorStore) await this.cursorStore.save(afterSequence);
    this.cursorBlocked = false;
    if (this.active && this.ws == null && !this.connecting) void this.connectNow();
  }

  /**
   * Async iterator over typed {@link AgentWsEvent} `message` emissions.
   * Ends when {@link StayOnlineSession.stop} is called and the queue drains.
   *
   * For durable processing, construct the session with `autoCheckpoint: false`
   * and call {@link acknowledge} only after each awaited handler succeeds.
   */
  events(): AsyncIterable<AgentWsEvent> {
    const self = this;
    const queue: AgentWsEvent[] = [];
    let wake: (() => void) | undefined;
    const onMessage = (ev: AgentWsEvent) => {
      queue.push(ev);
      wake?.();
    };
    // stop() emits "stopped" so a pending next() re-checks isRunning() and terminates.
    const onStopped = () => {
      wake?.();
    };
    const cleanup = () => {
      self.off("message", onMessage);
      self.off("stopped", onStopped);
    };
    self.on("message", onMessage);
    self.on("stopped", onStopped);
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<AgentWsEvent>> {
            while (queue.length === 0) {
              if (!self.isRunning()) {
                cleanup();
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
            cleanup();
            return { done: true, value: undefined };
          },
        };
      },
    };
  }
}
