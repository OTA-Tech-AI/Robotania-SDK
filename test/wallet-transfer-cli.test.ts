import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: vi.fn(), transfer: vi.fn(), receipt: vi.fn(), result: vi.fn(),
}));

vi.mock("../src/bin/cli/config.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/bin/cli/config.js")>(),
  loadConfig: mocks.config,
}));
vi.mock("../src/chain.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/chain.js")>(),
  writeWithdrawFromCitizenWallet: mocks.transfer,
  createAgentChainClients: () => ({ publicClient: { waitForTransactionReceipt: mocks.receipt } }),
}));
vi.mock("../src/bin/cli/output.js", () => ({
  log: vi.fn(), result: mocks.result,
  fatal: (message: string) => { throw new Error(message); },
}));

import { run } from "../src/bin/cli/withdraw-from-citizen-wallet.js";

const wallet = { address: "0x0000000000000000000000000000000000000011" };
const recipient = "0x0000000000000000000000000000000000000021";
const token = "0x0000000000000000000000000000000000000031";
const hash = `0x${"ab".repeat(32)}`;
const args = ["--to", recipient, "--amount", "1000000000000000000"];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue({ wallet });
  mocks.transfer.mockResolvedValue(hash);
  mocks.receipt.mockResolvedValue({ status: "success" });
});

describe("wallet transfer token selection", () => {
  it.each([
    { label: "malformed address", flags: ["--token", "not-an-address"] },
    { label: "missing value", flags: ["--token"] },
    { label: "empty value", flags: ["--token", ""] },
    { label: "another flag as the value", flags: ["--token", "--unused"] },
    { label: "duplicate token flags", flags: ["--token", token, "--token", recipient] },
    { label: "unsupported equals syntax", flags: [`--token=${token}`] },
  ])("rejects $label before configuration or transfer", async ({ flags }) => {
    for (const isDryRun of [true, false]) {
      await expect(run([...args, ...flags], isDryRun)).rejects.toThrow(/--token/);
    }
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.transfer).not.toHaveBeenCalled();
    expect(mocks.result).not.toHaveBeenCalled();
  });

  it("retains the default token only when the option is omitted", async () => {
    await run(args, false);

    expect(mocks.transfer).toHaveBeenCalledWith(wallet, {
      to: recipient, amount: 1000000000000000000n, token: undefined,
    });
    expect(mocks.receipt).toHaveBeenCalledWith({ hash });
  });

  it("passes an explicit token and its base-unit amount unchanged", async () => {
    await run([...args, "--token", token], false);

    expect(mocks.transfer).toHaveBeenCalledOnce();
    expect(mocks.transfer).toHaveBeenCalledWith(wallet, {
      to: recipient, amount: 1000000000000000000n, token,
    });
    expect(mocks.result).toHaveBeenCalledWith({
      txHash: hash, status: "success", to: recipient, amount: "1000000000000000000",
    });
  });

  it("previews an explicit token without sending a transaction", async () => {
    await run([...args, "--token", token], true);

    expect(mocks.result).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true, token, amount: "1000000000000000000",
    }));
    expect(mocks.transfer).not.toHaveBeenCalled();
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
});
