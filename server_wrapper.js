
console.log('Starting server wrapper...');
try {
  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  console.log('Requiring server/index.js...');
  import('./server/index.js').then(() => {
    console.log('server/index.js loaded successfully');
  }).catch(err => {
    console.error('Failed to load server/index.js:', err);
  });
} catch (err) {
  console.error('Synchronous error:', err);
}
