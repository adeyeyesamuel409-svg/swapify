import { prisma } from '../src/index.js';
import { Category, Condition } from '@prisma/client';

async function main() {
  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      email: 'alice@example.com',
      name: 'Alice Johnson',
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: {
      email: 'bob@example.com',
      name: 'Bob Smith',
    },
  });

  await prisma.item.upsert({
    where: { id: 'item-alice-headphones' },
    update: {},
    create: {
      id: 'item-alice-headphones',
      ownerId: alice.id,
      title: 'Sony WH-1000XM4 Headphones',
      description: 'Great noise-cancelling headphones, very lightly used.',
      category: Category.ELECTRONICS,
      condition: Condition.LIKE_NEW,
      valuePence: 18000,
      images: { create: [{ url: 'https://placehold.co/600x400?text=headphones', position: 0 }] },
    },
  });

  await prisma.item.upsert({
    where: { id: 'item-bob-nintendo' },
    update: {},
    create: {
      id: 'item-bob-nintendo',
      ownerId: bob.id,
      title: 'Nintendo Switch OLED',
      description: 'Console with two joy-cons and dock, barely used.',
      category: Category.ELECTRONICS,
      condition: Condition.GOOD,
      valuePence: 25000,
      images: { create: [{ url: 'https://placehold.co/600x400?text=switch', position: 0 }] },
    },
  });

  console.log(`Seeded: ${alice.name}, ${bob.name}, and 2 items.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
