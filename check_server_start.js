const fs = require('fs');
const http = require('http');

try {
    fs.writeFileSync('check_status.txt', 'STARTING\n');
    const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('OK');
    });

    server.on('error', (err) => {
        fs.appendFileSync('check_status.txt', 'ERROR: ' + err.message + '\n');
        process.exit(1);
    });

    server.listen(5001, () => {
        fs.appendFileSync('check_status.txt', 'LISTENING 5001\n');
        console.log('Listening on 5001');
    });
} catch (e) {
    fs.writeFileSync('check_status.txt', 'CRASH: ' + e.message + '\n');
}
