import { PrismaClient } from '@swapify/db';
const p = new PrismaClient();
(async () => {
  const users = await p.user.findMany({ where: { email: { contains: 'pgmanual-seller' } }, select: { id: true, email: true, cognitoSub: true } });
  console.log('USERS:', JSON.stringify(users, null, 2));
  await p.$disconnect();
})();
