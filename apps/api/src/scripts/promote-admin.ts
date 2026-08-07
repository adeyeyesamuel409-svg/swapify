import { AdminRole, prisma } from '@swapify/db';

// Dev helper: promote a user to admin by email, cognito sub, or user id.
// Usage: npx tsx src/scripts/promote-admin.ts test2@swapify.dev
async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: tsx scripts/promote-admin.ts <email|cognitoSub|userId>');
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: target },
        { cognitoSub: target },
        { id: target },
      ],
    },
  });

  if (!user) {
    console.error(`No user found for: ${target}`);
    process.exit(1);
  }

  await prisma.admin.upsert({
    where: { userId: user.id },
    create: { userId: user.id, role: AdminRole.SUPER_ADMIN },
    update: { role: AdminRole.SUPER_ADMIN },
  });

  console.log(`Promoted ${user.email} (${user.id}) to SUPER_ADMIN`);
}

main()
  .finally(() => prisma.$disconnect());
