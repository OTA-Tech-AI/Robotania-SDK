import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, parseAbi } from "viem";

const rpc = vi.hoisted(() => ({
  nonce: vi.fn(), gas: vi.fn(), fees: vi.fn(), gasPrice: vi.fn(),
  write: vi.fn(), wait: vi.fn(), receipt: vi.fn(),
  logs: [] as string[], results: [] as unknown[],
}));

vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => ({
    getTransactionCount: rpc.nonce, estimateContractGas: rpc.gas,
    estimateFeesPerGas: rpc.fees, getGasPrice: rpc.gasPrice,
    waitForTransactionReceipt: rpc.wait, getTransactionReceipt: rpc.receipt,
  }),
  createWalletClient: () => ({ writeContract: rpc.write }),
}));

vi.mock("../src/bin/cli/config.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/bin/cli/config.js")>(),
  loadConfig: () => ({ wallet, chainAddresses: { topicWaitlist: WAITLIST } }),
}));
vi.mock("../src/bin/cli/output.js", () => ({
  log: (message: string) => { rpc.logs.push(message); },
  result: (value: unknown) => { rpc.results.push(value); },
  fatal: (message: string) => { throw new Error(message); },
}));

import { ChainTransactionReplacedError, ChainTransactionUncertainError, writeClaimWaitlistRefund } from "../src/chain.js";
import { run } from "../src/bin/cli/claim-waitlist-refund.js";

const privateKey = `0x${"11".repeat(32)}` as `0x${string}`;
const wallet = { privateKey, address: privateKeyToAccount(privateKey).address };
const WAITLIST = "0x00000000000000000000000000000000000000a1" as const;
const HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const REPLACEMENT = `0x${"cd".repeat(32)}` as `0x${string}`;
const params = { topicWaitlist: WAITLIST, topicId: "123", citizenId: "42", rpcUrl: "https://rpc.example", chainId: 421614 };

beforeEach(() => {
  vi.resetAllMocks();
  rpc.logs.length = 0;
  rpc.results.length = 0;
  rpc.nonce.mockResolvedValue(17);
  rpc.gas.mockResolvedValue(21_000n);
  rpc.fees.mockResolvedValue({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n });
  rpc.write.mockResolvedValue(HASH);
  rpc.wait.mockImplementation(async ({ hash }) => ({ status: "success", transactionHash: hash }));
  rpc.receipt.mockRejectedValue(new Error("Transaction not found"));
  vi.stubEnv("ROBOTANIA_RPC_URL", "https://rpc.example");
  vi.stubEnv("ROBOTANIA_CHAIN_ID", "421614");
  for (const name of ["PROTOCOL_CONFIG", "CITIZEN_REGISTRY", "CITIZEN_ACTION_RELAY", "SETTLEMENT_TOKEN"]) {
    vi.stubEnv(`ROBOTANIA_${name}`, WAITLIST);
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("direct waitlist refund", () => {
  it("calls the existing refund signature with the beneficiary ID and persists the hash before waiting", async () => {
    const submitted = vi.fn(async (hash: string) => {
      expect(rpc.wait).not.toHaveBeenCalled();
      expect(hash).toBe(HASH);
    });
    expect(await writeClaimWaitlistRefund(wallet, { ...params, onSubmitted: submitted })).toBe(HASH);
    const tx = rpc.write.mock.calls[0][0];
    expect(tx.address).toBe(WAITLIST);
    expect(tx.account.address).toBe(wallet.address);
    expect(tx.args).toEqual([123n, 42n]);
    expect(tx.value).toBeUndefined();
    expect(encodeFunctionData(tx)).toBe(encodeFunctionData({
      abi: parseAbi(["function claimWaitlistRefund(uint256 topicId,uint256 citizenId)"]),
      functionName: "claimWaitlistRefund", args: [123n, 42n],
    }));
    expect(submitted).toHaveBeenCalledOnce();
    expect(rpc.write).toHaveBeenCalledOnce();
    expect(rpc.wait).toHaveBeenCalledWith({ hash: HASH, timeout: 90_000, onReplaced: expect.any(Function) });
  });

  it.each(["InvalidState", "InvalidAmount"])("does not broadcast after an ineligible refund simulation: %s", async (reason) => {
    rpc.gas.mockRejectedValue(new Error(`execution reverted: ${reason}`));
    await expect(writeClaimWaitlistRefund(wallet, params)).rejects.toThrow(reason);
    expect(rpc.write).not.toHaveBeenCalled();
  });

  it("returns a confirmed no-op without resubmitting it", async () => {
    rpc.wait.mockResolvedValue({ status: "success", transactionHash: HASH, logs: [] });
    expect(await writeClaimWaitlistRefund(wallet, params)).toBe(HASH);
    expect(rpc.write).toHaveBeenCalledOnce();
  });

  it("treats a reverted receipt as a terminal failure", async () => {
    rpc.wait.mockResolvedValue({ status: "reverted", transactionHash: HASH });
    const error = await writeClaimWaitlistRefund(wallet, params).catch(e => e);
    expect(error).not.toBeInstanceOf(ChainTransactionUncertainError);
    expect(error.message).toContain(`Transaction reverted on-chain: ${HASH}`);
    expect(rpc.write).toHaveBeenCalledOnce();
  });

  it("accepts a receipt recovered after the initial wait timed out", async () => {
    rpc.wait.mockRejectedValue(new Error("receipt timeout"));
    rpc.receipt.mockResolvedValue({ status: "success", transactionHash: HASH });
    expect(await writeClaimWaitlistRefund(wallet, params)).toBe(HASH);
    expect(rpc.write).toHaveBeenCalledOnce();
  });

  it("keeps one nonce through a fee replacement and reports both hashes", async () => {
    vi.useFakeTimers();
    rpc.wait.mockRejectedValueOnce(new Error("receipt timeout")).mockResolvedValue({ status: "success", transactionHash: REPLACEMENT });
    rpc.write.mockResolvedValueOnce(HASH).mockResolvedValue(REPLACEMENT);
    const hashes: string[] = [];
    const outcome = writeClaimWaitlistRefund(wallet, { ...params, onSubmitted: hash => { hashes.push(hash); } });
    await vi.runAllTimersAsync();
    expect(await outcome).toBe(REPLACEMENT);
    expect(hashes).toEqual([HASH, REPLACEMENT]);
    expect(rpc.nonce).toHaveBeenCalledOnce();
    expect(rpc.write.mock.calls.map(([tx]) => tx.nonce)).toEqual([17, 17]);
    expect(rpc.write.mock.calls[1][0].maxFeePerGas).toBeGreaterThan(rpc.write.mock.calls[0][0].maxFeePerGas);
  });

  it("bounds receipt retries and retains the last hash and nonce when still unresolved", async () => {
    vi.useFakeTimers();
    rpc.wait.mockRejectedValue(new Error("receipt timeout"));
    const outcome = writeClaimWaitlistRefund(wallet, params).catch(e => e);
    await vi.runAllTimersAsync();
    const error = await outcome;
    expect(error).toBeInstanceOf(ChainTransactionUncertainError);
    expect(error).toMatchObject({ code: "CHAIN_TRANSACTION_UNCERTAIN", txHash: HASH, nonce: 17, walletAddress: wallet.address });
    expect(rpc.write).toHaveBeenCalledTimes(4);
    expect(rpc.nonce).toHaveBeenCalledOnce();
    expect(rpc.write.mock.calls.every(([tx]) => tx.nonce === 17)).toBe(true);
  });

  it("returns and saves the mined hash of an external fee-only replacement", async () => {
    rpc.wait.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason: "repriced", transactionReceipt: { transactionHash: REPLACEMENT } });
      return { status: "success", transactionHash: REPLACEMENT };
    });
    const hashes: string[] = [];
    expect(await writeClaimWaitlistRefund(wallet, { ...params, onSubmitted: hash => { hashes.push(hash); } })).toBe(REPLACEMENT);
    expect(hashes).toEqual([HASH, REPLACEMENT]);
    expect(rpc.write).toHaveBeenCalledOnce();
    expect(rpc.receipt).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "replaced"] as const)("reports a mined %s transaction as a known failure without retrying", async reason => {
    rpc.wait.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason, transactionReceipt: { transactionHash: REPLACEMENT } });
      return { status: "success", transactionHash: REPLACEMENT };
    });
    const error = await writeClaimWaitlistRefund(wallet, params).catch(e => e);
    expect(error).toBeInstanceOf(ChainTransactionReplacedError);
    expect(error).toMatchObject({ code: "CHAIN_TRANSACTION_REPLACED", reason, originalTxHash: HASH, txHash: REPLACEMENT, nonce: 17 });
    expect(rpc.write).toHaveBeenCalledOnce();
    expect(rpc.receipt).not.toHaveBeenCalled();
  });

  it("reports a reverted fee replacement with the actual mined hash", async () => {
    rpc.wait.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason: "repriced", transactionReceipt: { transactionHash: REPLACEMENT } });
      return { status: "reverted", transactionHash: REPLACEMENT };
    });
    const error = await writeClaimWaitlistRefund(wallet, params).catch(e => e);
    expect(error).not.toBeInstanceOf(ChainTransactionUncertainError);
    expect(error.message).toBe(`Transaction reverted on-chain: ${REPLACEMENT}`);
    expect(rpc.write).toHaveBeenCalledOnce();
    expect(rpc.receipt).not.toHaveBeenCalled();
  });

  it("does not resend a mined fee replacement if saving its hash fails", async () => {
    rpc.wait.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason: "repriced", transactionReceipt: { transactionHash: REPLACEMENT } });
      return { status: "success", transactionHash: REPLACEMENT };
    });
    const error = await writeClaimWaitlistRefund(wallet, { ...params,
      onSubmitted: hash => { if (hash === REPLACEMENT) throw new Error("save failed"); },
    }).catch(e => e);
    expect(error).toMatchObject({ code: "CHAIN_TRANSACTION_UNCERTAIN", txHash: REPLACEMENT, nonce: 17 });
    expect(rpc.write).toHaveBeenCalledOnce();
    expect(rpc.receipt).not.toHaveBeenCalled();
  });

  it("does not trust a different receipt hash without replacement evidence", async () => {
    rpc.wait.mockResolvedValue({ status: "success", transactionHash: REPLACEMENT });
    const error = await writeClaimWaitlistRefund(wallet, params).catch(e => e);
    expect(error).toMatchObject({ code: "CHAIN_TRANSACTION_UNCERTAIN", txHash: HASH, nonce: 17 });
    expect(rpc.write).toHaveBeenCalledOnce();
  });

  it("rejects a receipt that disagrees with the detected replacement", async () => {
    rpc.wait.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason: "repriced", transactionReceipt: { transactionHash: REPLACEMENT } });
      return { status: "success", transactionHash: HASH };
    });
    const error = await writeClaimWaitlistRefund(wallet, params).catch(e => e);
    expect(error).toMatchObject({ code: "CHAIN_TRANSACTION_UNCERTAIN", txHash: HASH, nonce: 17 });
    expect(rpc.write).toHaveBeenCalledOnce();
  });

  it("returns the original hash if it mines after the SDK submitted a fee replacement", async () => {
    vi.useFakeTimers();
    rpc.wait.mockRejectedValueOnce(new Error("receipt timeout")).mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason: "repriced", transactionReceipt: { transactionHash: HASH } });
      return { status: "success", transactionHash: HASH };
    });
    rpc.write.mockResolvedValueOnce(HASH).mockResolvedValue(REPLACEMENT);
    const outcome = writeClaimWaitlistRefund(wallet, params);
    await vi.runAllTimersAsync();
    expect(await outcome).toBe(HASH);
    expect(rpc.write.mock.calls.map(([tx]) => tx.nonce)).toEqual([17, 17]);
    expect(rpc.nonce).toHaveBeenCalledOnce();
  });

  it("does not resend a reverted transaction recovered by receipt polling", async () => {
    rpc.wait.mockRejectedValue(new Error("receipt timeout"));
    rpc.receipt.mockResolvedValue({ status: "reverted", transactionHash: HASH });
    const error = await writeClaimWaitlistRefund(wallet, params).catch(e => e);
    expect(error).not.toBeInstanceOf(ChainTransactionUncertainError);
    expect(error.message).toBe(`Transaction reverted on-chain: ${HASH}`);
    expect(rpc.write).toHaveBeenCalledOnce();
  });

  it("preserves an unknown broadcast without a returned hash", async () => {
    vi.useFakeTimers();
    rpc.write.mockRejectedValue(new Error("RPC response lost"));
    const outcome = writeClaimWaitlistRefund(wallet, params).catch(e => e);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: "CHAIN_TRANSACTION_UNCERTAIN", txHash: null, nonce: 17 });
    expect(rpc.write).toHaveBeenCalledTimes(4);
    expect(rpc.nonce).toHaveBeenCalledOnce();
  });

  it("does not label a lost broadcast followed by nonce-too-low as a safe failure", async () => {
    vi.useFakeTimers();
    rpc.write.mockRejectedValueOnce(new Error("RPC response lost")).mockRejectedValue(new Error("nonce too low"));
    const outcome = writeClaimWaitlistRefund(wallet, params).catch(e => e);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: "CHAIN_TRANSACTION_UNCERTAIN", txHash: null, nonce: 17 });
    expect(rpc.write.mock.calls.map(([tx]) => tx.nonce)).toEqual([17, 17]);
  });

  it("retains the first hash if the replacement simulation fails", async () => {
    vi.useFakeTimers();
    rpc.wait.mockRejectedValue(new Error("receipt timeout"));
    rpc.gas.mockResolvedValueOnce(21_000n).mockRejectedValue(new Error("execution reverted: InvalidState"));
    const outcome = writeClaimWaitlistRefund(wallet, params).catch(e => e);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: "CHAIN_TRANSACTION_UNCERTAIN", txHash: HASH, nonce: 17 });
    expect(rpc.write).toHaveBeenCalledOnce();
  });

  it("retains the hash if saving it fails and does not trigger a replacement", async () => {
    const outcome = await writeClaimWaitlistRefund(wallet, { ...params, onSubmitted: () => { throw new Error("save failed"); } }).catch(e => e);
    expect(outcome).toMatchObject({ code: "CHAIN_TRANSACTION_UNCERTAIN", txHash: HASH, nonce: 17 });
    expect(rpc.write).toHaveBeenCalledOnce();
    expect(rpc.wait).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "1.5", "", String(2n ** 256n)])("rejects invalid topic IDs before RPC: %s", async (topicId) => {
    await expect(writeClaimWaitlistRefund(wallet, { ...params, topicId })).rejects.toThrow("topicId");
    expect(rpc.nonce).not.toHaveBeenCalled();
  });
});

describe("waitlist refund CLI", () => {
  it("previews the address and beneficiary without a write", async () => {
    await run(["--topic-id", "123", "--citizen-id", "42"], true);
    expect(rpc.write).not.toHaveBeenCalled();
    expect(rpc.results[0]).toMatchObject({ dryRun: true, topicWaitlist: WAITLIST, topicId: "123", citizenId: "42", wallet: wallet.address });
  });

  it("records a broadcast hash before printing confirmed success", async () => {
    rpc.wait.mockImplementation(async () => {
      expect(rpc.logs).toContain(`Transaction submitted: ${HASH}`);
      expect(rpc.results).toHaveLength(0);
      return { status: "success", transactionHash: HASH };
    });
    await run(["--topic-id", "123", "--citizen-id", "42"], false);
    expect(rpc.results[0]).toMatchObject({ txHash: HASH, status: "success" });
  });

  it.each([
    ["--topic-id", "123", "--citizen-id", "42", "--to", "0xabc"],
    ["--topic-id", "123", "--citizen-id", "42", "--amount", "1"],
    ["--topic-id", "123", "--citizen-id", "42", "--idempotency-key", "key"],
    ["--topic-id", "123", "--topic-id", "124", "--citizen-id", "42"],
  ])("rejects unsupported or ambiguous arguments before a write: %j", async (...args) => {
    await expect(run(args, false)).rejects.toThrow();
    expect(rpc.write).not.toHaveBeenCalled();
  });
});
