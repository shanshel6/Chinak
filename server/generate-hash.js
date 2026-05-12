import bcrypt from 'bcrypt';

const password = 'yourpassword';
const hash = bcrypt.hashSync(password, 10);
console.log('Password hash:', hash);
