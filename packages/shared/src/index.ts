// One token = 1,000,000 micro-tokens. All stored amounts are integer
// micro-tokens so we never suffer floating-point rounding on money.
export const MICRO_TOKENS_PER_TOKEN = 1_000_000n;

export function tokensToMicroTokens(tokens: number | bigint): bigint {
  return BigInt(tokens) * MICRO_TOKENS_PER_TOKEN;
}

export function microTokensToTokens(microTokens: bigint): number {
  return Number(microTokens) / Number(MICRO_TOKENS_PER_TOKEN);
}
