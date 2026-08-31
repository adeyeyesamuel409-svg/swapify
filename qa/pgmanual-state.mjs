import { PrismaClient } from '@swapify/db';
const p = new PrismaClient();
(async () => {
  const cognitoSub = process.argv[2];
  const u = await p.user.findUnique({ where: { cognitoSub } });
  console.log('USER:', JSON.stringify({ id: u.id, email: u.email }, null, 2));
  const c = await p.connectedAccount.findUnique({ where: { userId: u.id } });
  console.log('ConnectedAccount:', JSON.stringify(c, null, 2));
  const ba = await p.balanceAccount.findUnique({ where: { userId: u.id } });
  console.log('BalanceAccount:', JSON.stringify(ba, null, 2));
  const pm = await p.payoutMethod.findMany({ where: { userId: u.id } });
  console.log('PayoutMethods:', JSON.stringify(pm.map(x => ({ displayName: x.displayName, last4: x.last4, bankName: x.bankName, stripeMethodRef: x.stripeMethodRef, isDefault: x.isDefault, isActive: x.isActive, type: x.type })), null, 2));
  await p.$disconnect();
})();
