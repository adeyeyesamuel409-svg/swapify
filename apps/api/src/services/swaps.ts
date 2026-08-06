import { GapPayer, Prisma, SwapStatus, prisma } from '@swapify/db';

// HTTP-style error the routes can throw; the app-level error handler
// turns these into proper status codes instead of a generic 500.
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const ACTIVE_SWAP_STATUSES = [
  SwapStatus.REQUESTED,
  SwapStatus.AGREED,
  SwapStatus.ESCROWED,
  SwapStatus.SHIPPED,
];

export type GapInfo = { gapMicroTokens: bigint; gapPayer: GapPayer };

// Who pays the value difference and by how much.
//   offered < requested -> the offering user pays, so they can get a more valuable item.
//   offered > requested -> the requesting user pays, compensating the person giving more.
//   equal              -> no gap.
export function computeGap(offeredValue: bigint, requestedValue: bigint): GapInfo {
  if (offeredValue === requestedValue) return { gapMicroTokens: 0n, gapPayer: GapPayer.NONE };
  if (offeredValue < requestedValue) {
    return { gapMicroTokens: requestedValue - offeredValue, gapPayer: GapPayer.OFFERING_USER };
  }
  return { gapMicroTokens: offeredValue - requestedValue, gapPayer: GapPayer.REQUESTING_USER };
}

// One item can only be in a single active swap at a time. Throws a 409
// if either item is already claimed by an in-progress swap.
export async function assertNoActiveSwap(tx: Prisma.TransactionClient, itemId: string): Promise<void> {
  const active = await tx.swap.count({
    where: {
      status: { in: ACTIVE_SWAP_STATUSES },
      OR: [{ offeringItemId: itemId }, { requestedItemId: itemId }],
    },
  });
  if (active > 0) {
    throw new HttpError(409, 'One of the items is already involved in a swap');
  }
}

// Runs a callback in a SERIALIZABLE transaction with retry on concurrent
// write conflicts, so two people can never create swaps on the same item.
export async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034' && attempt < 2) {
        continue;
      }
      throw err;
    }
  }
}
