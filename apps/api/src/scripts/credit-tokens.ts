import 'dotenv/config';
import { prisma, TransactionDirection, TransactionType } from '@swapify/db';
import { applyLedgerEntry } from '../services/ledger.js';

// Dev helper: credit tokens to a user's wallet.
// Usage: npx tsx src/scripts/credit-tokens.ts <email|sub> <tokens> [note]
const email = process.argv[2];
const tokens = BigInt(process.argv[3] ?? '0');
const note = process.argv[4];

if (!email || tokens <= 0n) {
  console.error('Usage: credit-tokens.ts <email|sub> <tokens> [note]');
  process.exit(1);
}

const user = await prisma.user.findFirst({
  where: { OR: [{ email }, { cognitoSub: email }] },
  include: { wallet: true },
});
if (!user?.wallet) {
  console.error(`No user/wallet for ${email}`);
  process.exit(1);
}

const { transaction } = await applyLedgerEntry({
  walletId: user.wallet.id,
  type: TransactionType.ADJUSTMENT,
  direction: TransactionDirection.CREDIT,
  amountMicroTokens: tokens * 1_000_000n,
  note: note ?? `Dev credit ${tokens} tokens`,
});

console.log(`Credited ${tokens} tokens to ${email}. New balance: ${Number(transaction.balanceAfterMicroTokens) / 1_000_000}`);
