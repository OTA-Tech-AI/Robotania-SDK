import { createPublicClient, http, defineChain } from "viem";
const chain = defineChain({id:31337,name:"Anvil",nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},rpcUrls:{default:{http:["http://104.168.122.108:8546"]}}});
const pub = createPublicClient({ chain, transport: http("http://104.168.122.108:8546") });
const JURY_MANAGER = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";

// JuryCaseCreated event: topic[0]=sig, topic[1]=juryCaseId, topic[2]=matchId
const JURY_CASE_CREATED = "0x70679ad4f1eca62755e0fe39b4c933e6884072af580d7e52ee879e7c807e6e5a";
const blockNum = await pub.getBlockNumber();
console.log("current block:", blockNum.toString());

const logs = await pub.getLogs({
  address: JURY_MANAGER,
  fromBlock: blockNum - 2000n,
  toBlock: blockNum,
});

for (const log of logs) {
  if (log.topics[0] === JURY_CASE_CREATED) {
    const caseId = BigInt(log.topics[1]).toString();
    const matchId = BigInt(log.topics[2]).toString();
    console.log(`JuryCaseCreated: caseId=${caseId} matchId=${matchId} block=${log.blockNumber}`);
  }
}
