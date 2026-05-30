import { createPublicClient, http, defineChain, parseAbi } from "viem";
const chain = defineChain({id:31337,name:"Anvil",nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},rpcUrls:{default:{http:["http://104.168.122.108:8546"]}}});
const pub = createPublicClient({ chain, transport: http("http://104.168.122.108:8546") });
const JURY_MANAGER = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const abi = parseAbi(["function getJuryCase(uint256 matchId) external view returns (uint256 juryCaseId, uint256[] memory jurorCitizenIds, uint8 status)"]);
const [caseId, jurors, status] = await pub.readContract({ address: JURY_MANAGER, abi, functionName: "getJuryCase", args: [16n] });
console.log(JSON.stringify({ matchId: 16, juryCaseId: caseId.toString(), jurors: jurors.map(String), status: status.toString() }));
