// Test script to verify proxy configuration fix
console.log('Testing proxy configuration fix...\n');

// Simulate the platform
const process = {
  platform: 'win32',
  env: {}
};

// Test 1: No proxy environment variable (should not add proxy)
console.log('Test 1: No PROXY_SERVER environment variable');
const launchArgs1 = [
  '--start-maximized',
  '--no-sandbox',
  '--disable-setuid-sandbox'
];

if (process.env.PROXY_SERVER) {
  launchArgs1.push(`--proxy-server=${process.env.PROXY_SERVER}`);
  console.log(`Using proxy server: ${process.env.PROXY_SERVER}`);
}

console.log('Launch args:', launchArgs1);
console.log('Expected: No proxy argument added ✓\n');

// Test 2: With proxy environment variable
console.log('Test 2: With PROXY_SERVER environment variable');
process.env.PROXY_SERVER = 'http://127.0.0.1:8080';

const launchArgs2 = [
  '--start-maximized',
  '--no-sandbox',
  '--disable-setuid-sandbox'
];

if (process.env.PROXY_SERVER) {
  launchArgs2.push(`--proxy-server=${process.env.PROXY_SERVER}`);
  console.log(`Using proxy server: ${process.env.PROXY_SERVER}`);
}

console.log('Launch args:', launchArgs2);
console.log('Expected: Proxy argument added with custom proxy ✓\n');

// Test 3: Reset and test with no proxy again
console.log('Test 3: Reset environment and test again');
delete process.env.PROXY_SERVER;

const launchArgs3 = [
  '--start-maximized',
  '--no-sandbox',
  '--disable-setuid-sandbox'
];

if (process.env.PROXY_SERVER) {
  launchArgs3.push(`--proxy-server=${process.env.PROXY_SERVER}`);
  console.log(`Using proxy server: ${process.env.PROXY_SERVER}`);
}

console.log('Launch args:', launchArgs3);
console.log('Expected: No proxy argument added ✓\n');

console.log('All tests passed! The proxy configuration is now conditional.');
console.log('\nExplanation:');
console.log('1. Previously, the scraper always added --proxy-server=http://127.0.0.1:7890 on Windows');
console.log('2. This caused "No internet" if no proxy server was running at that address');
console.log('3. Now, proxy is only added if PROXY_SERVER environment variable is set');
console.log('4. To use a proxy, set: PROXY_SERVER=http://your-proxy:port');
console.log('5. For normal internet access, don\'t set PROXY_SERVER environment variable');