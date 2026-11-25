// tiny static server for local preview (+ POST /save for the figure generator, docs/ only)
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/save') {
    const rel = u.searchParams.get('path') || '';
    const f = path.join(root, rel);
    if (!f.startsWith(path.join(root, 'docs') + path.sep)) { res.writeHead(403); return res.end('docs only'); }
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      const b64 = Buffer.concat(chunks).toString().replace(/^data:[^,]+,/, '');
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(b64, 'base64'));
      res.writeHead(200); res.end('saved ' + rel);
    });
    return;
  }
  let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end('404'); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(d); });
}).listen(process.env.PORT || 8765, () => console.log('up'));
