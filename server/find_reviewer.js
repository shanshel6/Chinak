import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function findReviewer() {
  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: 'reviewer', mode: 'insensitive' } },
          { name: { contains: 'reviewer', mode: 'insensitive' } },
          { phone: { contains: 'reviewer', mode: 'insensitive' } }
        ]
      }
    });
    
    if (users.length === 0) {
      console.log('No users found matching "reviewer".');
      // List all users to be sure
      const allUsers = await prisma.user.findMany({
        take: 10,
        select: { email: true, name: true, phone: true, role: true }
      });
      console.log('Last 10 users in database:');
      console.table(allUsers);
    } else {
      console.log('Found matching users:');
      console.table(users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role
      })));
    }
  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

findReviewer();
