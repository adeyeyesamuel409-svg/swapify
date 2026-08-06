import {
  prisma,
  TokenTransaction,
  TransactionDirection,
  TransactionType,
  Prisma,
} from '@swapify/db';

export const MICRO_TOKENS_PER_TOKEN = 1_000_000n;
export const WELCOME_BONUS_TOKENS = 10n;

export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient token balance');
    this.name = 'InsufficientFundsError';
  }
}

export type LedgerEntryInput = {
  walletId: string;
  type: TransactionType;
  direction: TransactionDirection;
  amountMicroTokens: bigint;
  referenceId?: string;
  note?: string;
  // Guarantees the same operation is never applied twice, even on retries
  // or a network blip between the client and the API.
  idempotencyKey?: string;
};

export type LedgerResult =
  | { alreadyProcessed: true; transaction: TokenTransaction }
  | { alreadyProcessed: false; transaction: TokenTransaction };

// Moves tokens in or out of a wallet, recording every change in the
// append-only ledger. Runs in a SERIALIZABLE transaction so concurrent
// operations can never lose money or record a wrong balance.
export async function applyLedgerEntry(input: LedgerEntryInput): Promise<LedgerResult> {
  const { walletId, type, direction, amountMicroTokens, referenceId, note, idempotencyKey } = input;

  if (amountMicroTokens <= 0n) {
    throw new Error('Amount must be positive');
  }

  // Retry a few times: SERIALIZABLE can abort concurrent writers with P2034.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Fast path: this operation already ran. Never double-apply.
          if (idempotencyKey) {
            const existing = await tx.tokenTransaction.findUnique({
              where: { idempotencyKey },
            });
            if (existing) {
              return { alreadyProcessed: true, transaction: existing } satisfies LedgerResult;
            }
          }

          // Move the balance first so the ledger records the true balance after.
          let balanceAfterMicroTokens: bigint;

          if (direction === TransactionDirection.DEBIT) {
            const result = await tx.wallet.updateMany({
              where: { id: walletId, balanceMicroTokens: { gte: amountMicroTokens } },
              data: { balanceMicroTokens: { decrement: amountMicroTokens } },
            });
            if (result.count === 0) {
              throw new InsufficientFundsError();
            }
            const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
            balanceAfterMicroTokens = wallet.balanceMicroTokens;
          } else {
            const wallet = await tx.wallet.update({
              where: { id: walletId },
              data: { balanceMicroTokens: { increment: amountMicroTokens } },
            });
            balanceAfterMicroTokens = wallet.balanceMicroTokens;
          }

          const transaction = await tx.tokenTransaction.create({
            data: {
              walletId,
              type,
              direction,
              amountMicroTokens,
              balanceAfterMicroTokens,
              referenceId,
              note,
              idempotencyKey,
            },
          });

          return { alreadyProcessed: false, transaction } satisfies LedgerResult;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 },
      );
    } catch (err) {
      // Concurrent write conflict - retry the whole operation.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        if (attempt >= 2) throw err;
        continue;
      }
      // Unique violation on idempotencyKey: a concurrent request already
      // applied it, so our balance update was rolled back - all good.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await prisma.tokenTransaction.findUniqueOrThrow({
          where: { idempotencyKey: idempotencyKey! },
        });
        return { alreadyProcessed: true, transaction: existing };
      }
      throw err;
    }
  }
}
