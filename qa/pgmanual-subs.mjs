import { PrismaClient } from '@swapify/db';
const p = new PrismaClient();
(async () => {
  const subs = ['5488e458-e0d1-703a-c142-ec199b75ec14', 'c4181418-7001-70b6-0af3-497cc83757b9'];
  for (const sub of subs) {
    const u = await p.user.findUnique({ where: { cognitoSub: sub }, select: { id: true, email: true, cognitoSub: true } });
    console.log(sub, '=>', JSON.stringify(u));
  }
  await p.$disconnect();
})();
