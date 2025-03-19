const { ethers } = require("ethers");
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require("@flashbots/ethers-provider-bundle");
const readline = require("readline");
require("dotenv").config();

const CHAIN_ID = 8453;
const RPC_URL = "https://mainnet.base.org";
const FLASHBOTS_ENDPOINT = "https://rpc.beaverbuild.org";

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const sponsorWallet = new ethers.Wallet(process.env.PRIVATE_KEY_SPONSOR, provider);
const hackedWallet = new ethers.Wallet(process.env.PRIVATE_KEY_HACKED, provider);
const safeWalletAddress = process.env.SAFE_WALLET_ADDRESS;

const erc20ABI = [
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)"
];

const erc721ABI = [
  "function transferFrom(address from, address to, uint256 tokenId) external",
  "function balanceOf(address owner) external view returns (uint256)"
];

async function executeSafeTransfer() {
  try {
    console.log("🔐 Initializing Flashbots rescue module...");

    const authSigner = sponsorWallet;
    const flashbotsProvider = await FlashbotsBundleProvider.create(
      provider,
      authSigner,
      FLASHBOTS_ENDPOINT
    );

    console.log("📡 Listening for new blocks on Base...");
    provider.on("block", async (blockNumber) => {
      try {
        const currentBlock = blockNumber + 1;
        const targetBlockHex = `0x${currentBlock.toString(16)}`;
        const feeData = await provider.getFeeData();

        const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits("1", "gwei");
        const maxFeePerGas = feeData.maxFeePerGas || ethers.utils.parseUnits("2", "gwei");

        console.log(`🌀 Attempting rescue on Base | Block: ${currentBlock}`);

        const balance = await provider.getBalance(hackedWallet.address);
        if (balance.isZero()) {
          console.log("💤 No ETH found in hacked wallet. Aborting...");
          return;
        }

        console.log("📦 Preparing transactions...");
        const tx = {
          chainId: CHAIN_ID,
          to: safeWalletAddress,
          value: balance,
          type: 2,
          maxFeePerGas,
          maxPriorityFeePerGas,
          gasLimit: 21000,
          nonce: await provider.getTransactionCount(hackedWallet.address, "pending")
        };

        const signedTx = await hackedWallet.signTransaction(tx);

        console.log("🚀 Sending bundle to Base Flashbots...");
        const bundleResponse = await flashbotsProvider.sendBundle(
          [{ signedTransaction: signedTx }],
          currentBlock
        );
        const resolution = await bundleResponse.wait();

        if (resolution === FlashbotsBundleResolution.BundleIncluded) {
          console.log("✅ Rescue successful! ETH moved to the safe wallet.");
          process.exit(0);
        } else {
          console.log("❌ Bundle not included, retrying...");
        }
      } catch (error) {
        console.log(`⚠️ Error: ${error.message}`);
      }
    });
  } catch (mainError) {
    console.log(`💀 FATAL ERROR: ${mainError.message}`);
    process.exit(1);
  }
}

executeSafeTransfer();
