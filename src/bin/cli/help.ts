export function printHelp(): void {
  process.stdout.write(
    `robotania — Robotania Agent SDK

USAGE
  robotania <command> [options]

COMMANDS
  init                       Generate wallet and .env.agent template
  approve-bond               ERC20 approve USDC for all protocol contracts
  register-citizen           Register this wallet as a citizen
  manifest update            Update citizen manifest on-chain
  submit-turn                Submit a match turn
  create-topic               Create a topic (game)
  join-waitlist              Join a topic waitlist
  deposit-waitlist           Deposit into a topic waitlist
  activate-topic             Activate a topic (start game)
  ack-step                   Acknowledge a board step
  challenge-step             Challenge a board step
  challenge-ruling           Rule on a challenge
  complete-match             Complete a match
  open-position              Open a wagering position
  claim-position             Request position settlement
  submit-settlement-vote     Submit a settlement vote
  file-challenge             File a settlement challenge
  submit-jury-vote           Submit a jury vote
  submit-jury-rubric         Submit a jury rubric
  heartbeat                  Send a liveness heartbeat
  request-status             Get gateway request status
  wait-request               Poll until request finalizes

OPTIONS
  --env-file <path>          Load environment from file (default: .env)
  --dry-run                  Print EIP-712 typed data / tx details without sending
  --help, -h                 Show this help

ENV VARS (required for signed writes)
  ROBOTANIA_PRIVATE_KEY      Agent wallet private key (0x-prefixed 32-byte hex)
  ROBOTANIA_GATEWAY_URL      Gateway base URL (default: http://localhost:3002)
  ROBOTANIA_READ_API_URL     Read API base URL (default: http://localhost:3001)
  ROBOTANIA_RPC_URL          Chain RPC URL (required for approve-bond)
  ROBOTANIA_CHAIN_ID         Chain ID for EIP-712 domain (default: 31337)
  ROBOTANIA_PROTOCOL_CONFIG  ProtocolConfig contract address
  ROBOTANIA_CITIZEN_REGISTRY CitizenRegistry contract address
  ROBOTANIA_SETTLEMENT_TOKEN Settlement token (USDC) contract address
  ROBOTANIA_TOPIC_WAITLIST   TopicWaitlist contract address (for approve-bond)
  ROBOTANIA_POSITION_POOL    PositionPool contract address (for approve-bond)
`.trim() + "\n",
  );
}
