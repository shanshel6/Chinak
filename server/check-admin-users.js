import { PrismaClient } from '@prisma/client';

async function checkAdminUsers() {
  const prisma = new PrismaClient();
  
  try {
    const adminUsers = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true, email: true, role: true, name: true }
    });
    
    console.log('Admin users found:', adminUsers.length);
    console.log(JSON.stringify(adminUsers, null, 2));
    
    // If no admin users, check all users
    if (adminUsers.length === 0) {
      const allUsers = await prisma.user.findMany({
        select: { id: true, email: true, role: true, name: true }
      });
      console.log('All users:', JSON.stringify(allUsers, null, 2));
    }
    
  } catch (error) {
    console.error('Error checking users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAdminUsers();