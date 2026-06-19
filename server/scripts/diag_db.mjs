// Diagnose what hangs: SSL handshake vs auth vs DNS.
// Each test times out in 8 seconds so you see results fast.

import net from 'net';
import dns from 'dns';

const HOST = 'viaduct.proxy.rlwy.net';
const PORT = 34644;

console.log('[Diag] Step 1: DNS lookup');
await new Promise((r) => dns.lookup(HOST, { all: true }, (err, addrs) => {
  if (err) { console.log('  DNS FAIL:', err.code, err.message); return r(); }
  console.log('  DNS OK:', addrs.map((a) => `${a.address}(v${a.family})`).join(', '));
  r();
}));

console.log('[Diag] Step 2: Raw TCP connect (8s timeout)');
await new Promise((r) => {
  const s = new net.Socket();
  s.setTimeout(8000);
  s.on('connect', () => { console.log('  TCP OK'); s.destroy(); r(); });
  s.on('timeout', () => { console.log('  TCP TIMEOUT'); s.destroy(); r(); });
  s.on('error', (e) => { console.log('  TCP ERR:', e.code, e.message); r(); });
  s.connect(PORT, HOST);
});

console.log('[Diag] Step 3: Send Postgres SSLRequest packet, wait for response (8s)');
await new Promise((r) => {
  const s = new net.Socket();
  s.setTimeout(8000);
  s.on('connect', () => {
    // SSLRequest: length=8, code=80877103 (0x04d2162f)
    const sslReq = Buffer.alloc(8);
    sslReq.writeUInt32BE(8, 0);
    sslReq.writeUInt32BE(0x04d2162f, 4);
    s.write(sslReq);
  });
  s.on('data', (d) => {
    console.log('  Got response:', d.toString('hex'), '(S = SSL supported, N = no SSL)');
    s.destroy(); r();
  });
  s.on('timeout', () => { console.log('  NO RESPONSE (proxy may be blocking wire protocol)'); s.destroy(); r(); });
  s.on('error', (e) => { console.log('  ERR:', e.code, e.message); r(); });
  s.connect(PORT, HOST);
});

console.log('[Diag] Done. Share the output so we know where it hangs.');