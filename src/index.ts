import { config } from "dotenv";

config();

import { IBundler, Bundler } from "@biconomy/bundler";
import { BiconomySmartAccountV2, DEFAULT_ENTRYPOINT_ADDRESS } from "@biconomy/account";
import { ChainId } from "@biconomy/core-types";
import {
  IPaymaster,
  BiconomyPaymaster,
  IHybridPaymaster,
  PaymasterMode,
  SponsorUserOperationDto,
  PaymasterFeeQuote,
} from "@biconomy/paymaster";
import {
  ECDSAOwnershipValidationModule,
  DEFAULT_ECDSA_OWNERSHIP_MODULE,
} from "@biconomy/modules";


import { Wallet, providers, ethers } from "ethers";

const chainId = ChainId.POLYGON_MUMBAI;
const erc20TokenAddress = '0xda5289fcaaf71d52a80a254da614a192b693e977'; // USDC contract address on Polygon Mumbai
const nftAddress = "0x1758f42Af7026fBbB559Dc60EcE0De3ef81f665e"; // NFT contract address which we want to mint on Polygon Mumbai

const bundler: IBundler = new Bundler({
  bundlerUrl: `https://bundler.biconomy.io/api/v2/${chainId}/nJPK7B3ru.dd7f7861-190d-41bd-af80-6877f74b8f44`,
  chainId,
  entryPointAddress: DEFAULT_ENTRYPOINT_ADDRESS,
});

const provider = new providers.JsonRpcProvider(
  "https://rpc.ankr.com/polygon_mumbai",
);
const wallet = new Wallet(process.env.PRIVATE_KEY || "", provider);

const paymaster: IPaymaster = new BiconomyPaymaster({
  paymasterUrl: "https://paymaster.biconomy.io/api/v1/80001/C6zf1tB-p.6b4fcb36-b7e6-4c49-8f2b-79d39d8c7f49",
});

async function createAccount() {
  const module = await ECDSAOwnershipValidationModule.create({
    signer: wallet,
    moduleAddress: DEFAULT_ECDSA_OWNERSHIP_MODULE,
  });

  let biconomySmartAccount = await BiconomySmartAccountV2.create({
    chainId: ChainId.POLYGON_MUMBAI,
    bundler,
    paymaster,
    entryPointAddress: DEFAULT_ENTRYPOINT_ADDRESS,
    defaultValidationModule: module,
    activeValidationModule: module,
  });
  console.log("address: ", await biconomySmartAccount.getAccountAddress());
  return biconomySmartAccount;
}

async function mintNFT() {
  const smartAccount = await createAccount();
  const address = await smartAccount.getAccountAddress();
  const nftInterface = new ethers.utils.Interface([
    "function safeMint(address _to)",
  ]);

  const data = nftInterface.encodeFunctionData("safeMint", [address]);

  const transaction = {
    to: nftAddress,
    data: data,
  };

  console.log("creating nft mint userop");
  let partialUserOp = await smartAccount.buildUserOp([transaction]);
  let finalUserOp = partialUserOp;

  const biconomyPaymaster = smartAccount.paymaster as IHybridPaymaster<SponsorUserOperationDto>;
  const feeQuotesResponse = await biconomyPaymaster.getPaymasterFeeQuotesOrData(
    partialUserOp,
    {
      mode: PaymasterMode.ERC20,
      tokenList: [erc20TokenAddress], 
    },
  );
  const feeQuotes = feeQuotesResponse.feeQuotes as PaymasterFeeQuote[];
  const spender = feeQuotesResponse.tokenPaymasterAddress || "";
  const usdcFeeQuotes = feeQuotes[0];
  finalUserOp = await smartAccount.buildTokenPaymasterUserOp(partialUserOp, {
    feeQuote: usdcFeeQuotes,
    spender: spender,
    maxApproval: false,
  });
  
  let paymasterServiceData = {
    mode: PaymasterMode.ERC20,
    feeTokenAddress: usdcFeeQuotes.tokenAddress,
    calculateGasLimits: true, // Always recommended and especially when using token paymaster
  };
  
  try {
    const paymasterAndDataWithLimits =
      await biconomyPaymaster.getPaymasterAndData(
        finalUserOp,
        paymasterServiceData,
      );
    finalUserOp.paymasterAndData = paymasterAndDataWithLimits.paymasterAndData;
  
    // below code is only needed if you sent the flag calculateGasLimits = true
    if (
      paymasterAndDataWithLimits.callGasLimit &&
      paymasterAndDataWithLimits.verificationGasLimit &&
      paymasterAndDataWithLimits.preVerificationGas
    ) {
      // Returned gas limits must be replaced in your op as you update paymasterAndData.
      // Because these are the limits paymaster service signed on to generate paymasterAndData
      // If you receive AA34 error check here..
      console.log('errrrrr');
      console.log(paymasterAndDataWithLimits.callGasLimit);
      console.log(paymasterAndDataWithLimits.verificationGasLimit);
      console.log(paymasterAndDataWithLimits.preVerificationGas);
  
      finalUserOp.callGasLimit = paymasterAndDataWithLimits.callGasLimit;
      console.log('errrrrr1');
      finalUserOp.verificationGasLimit = paymasterAndDataWithLimits.verificationGasLimit;
      console.log('errrrrr2');
      finalUserOp.preVerificationGas = paymasterAndDataWithLimits.preVerificationGas;
      console.log('errrrrr3');
    }
  } catch (e) {
    console.log("error received 1", e);
  }
  
  try {
    const paymasterAndDataWithLimits =
      await biconomyPaymaster.getPaymasterAndData(
        finalUserOp,
        paymasterServiceData,
      );
    finalUserOp.paymasterAndData = paymasterAndDataWithLimits.paymasterAndData;
  } catch (e) {
    console.log("error received 2", e);
  }

  try {
    const userOpResponse = await smartAccount.sendUserOp(finalUserOp);
    const transactionDetails = await userOpResponse.wait();
    console.log(
      `transactionDetails: https://mumbai.polygonscan.com/tx/${transactionDetails.logs[0].transactionHash}`,
    );
    console.log(
      `view minted nfts for smart account: https://testnets.opensea.io/${address}`,
    );
  } catch (e) {
    console.log("error received 3", e);
  }
}

mintNFT();