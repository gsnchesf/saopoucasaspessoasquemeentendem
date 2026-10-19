// Servidor local do organizador: serve esta pasta em http://localhost:4321,
// acessível só por este computador. Sem dependências — basta ter o Node instalado.
// Mantenha sempre a mesma porta: os dados ficam guardados por endereço.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4321;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end(); }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.join(ROOT, path.normalize(pathname));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache', // sempre confere se há versão nova
    });
    res.end(data);
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`O organizador já está rodando em http://localhost:${PORT}`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => console.log(`Organizador rodando em http://localhost:${PORT}`));
