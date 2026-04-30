const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 8080;
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); }
      else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data); }
    });
  } else if (req.url === '/log-event' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { res.writeHead(200); res.end('ok'); });
  } else {
    res.writeHead(404); res.end();
  }
});
server.listen(PORT, () => console.log(`Simulation running at http://localhost:${PORT}`));
