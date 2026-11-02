import { PrismaClient } from '@prisma/client';
import { provisionCompany, seedRolesAndPermissions } from '../src/company/provision-company';

const prisma = new PrismaClient();

// Development-only sample company; production companies come from `npm run provision:company`.
const DEV_COMPANY_SLUG = 'default';
const DEV_ADMIN_EMAIL = 'admin@checkpoint.local';

async function main() {
  console.log('🌱 Starting CheckPoint database seeding...');

  // Platform-wide reference data, safe to repeat
  await seedRolesAndPermissions(prisma);
  console.log('✅ Roles and permissions seeded: ADMIN, EMPLOYEE');

  if (process.env.NODE_ENV === 'production') {
    console.log('⏭️  Production: no sample company. Use `npm run provision:company`.');
    return;
  }

  if (await prisma.company.findUnique({ where: { slug: DEV_COMPANY_SLUG } })) {
    console.log('✅ Development company already exists');
  } else {
    await provisionCompany(prisma, {
      name: 'CheckPoint Company',
      slug: DEV_COMPANY_SLUG,
      adminEmail: DEV_ADMIN_EMAIL,
      adminFullName: 'System Administrator',
      adminPassword: 'AdminPassword123!',
      mustChangePassword: false,
    });
    console.log(`✅ Development company and admin seeded: ${DEV_ADMIN_EMAIL}`);
  }

  console.log('🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
