// Bypass local DNS hijacking by querying public resolvers directly (DoH / DNS over HTTPS).
// Shows what viaduct.proxy.rlwy.net SHOULD resolve to.

const resolvers = [
  { name: 'Google',     url: 'https://dns.google/resolve?name=viaduct.proxy.rlwy.net&type=A' },
  { name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query?name=viaduct.proxy.rlwy.net&type=A', headers: { Accept: 'application/dns-json' } },
  { name: 'Quad9',      url: 'https://dns.quad9.net/dns-query?name=viaduct.proxy.rlwy.net&type=A', headers: { Accept: 'application/dns-json' } },
];

for (const r of resolvers) {
  process.stdout.write(`[${r.name}] ... `);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(r.url, { headers: r.headers || {}, signal: ctrl.signal });
    clearTimeout(t);
    const j = await resp.json();
    const ips = (j.Answer || []).filter((a) => a.type === 1).map((a) => a.data);
    console.log(ips.length ? ips.join(', ') : '(no A record)');
  } catch (e) {
    console.log('ERR:', e.message);
  }
}

console.log('\n[Local DNS] (your machine\'s default resolver)');
import dns from 'dns';
await new Promise((r) => dns.lookup('viaduct.proxy.rlwy.net', { all: true }, (err, addrs) => {
  if (err) { console.log('  ERR:', err.code, err.message); return r(); }
  console.log('  ', addrs.map((a) => a.address).join(', '));
  r();
}));

console.log('\nIf public resolvers give DIFFERENT IPs than your local DNS,');
console.log('your local DNS is hijacked. Fix by changing DNS to 1.1.1.1 or 8.8.8.8:');