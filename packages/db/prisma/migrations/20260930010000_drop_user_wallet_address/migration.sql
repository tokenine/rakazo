-- Personal wallet was cut from the Wallet settings panel; agent wallets live
-- on the bot computers, so the user-level address column is not needed.
ALTER TABLE "user" DROP COLUMN "walletAddress";
