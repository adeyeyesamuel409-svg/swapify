import { PrismaClient } from '@swapify/db';
const p = new PrismaClient();
(async () => {
  const subs = ['5488e458-e0d1-703a-c142-ec199b75ec14', 'c4181418-7001-70b6-0af3-497cc83757b9'];
  const u = await p.user.findMany({ where: { cognitoSub: { in: subs } } });
  const ids = u.map(x => x.id);
  const swaps = await p.swap.findMany({ where: { OR: [{ offeringUserId: { in: ids } }, { requestedUserId: { in: ids } }] }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, status: true, createdAt: true, offeringUserId: true, requestedUserId: true } });
  console.log('SWAPS:');
  for (const s of swaps) {
    const ships = await p.shipment.findMany({ where: { swapId: s.id }, select: { senderUserId: true, receiverUserId: true, status: true } });
    console.log(' ', s.id, s.status, 'offering=', s.offeringUserId.slice(0,6), 'requested=', s.requestedUserId.slice(0,6), 'shipments=', JSON.stringify(ships.map(x => ({ s: x.senderUserId.slice(0,6), r: x.receiverUserId.slice(0,6), st: x.status }))));
  }
  await p.$disconnect();
})();
