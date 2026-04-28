const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const INDEX = path.join(__dirname, 'index.html');
let eventLog = [];

const server = http.createServer((req, res) => {
  const url = req.url;

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading index.html');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      }
    });
    return;
  }

  if (url === '/log-event' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const ev = JSON.parse(body);
        ev.serverTs = Date.now();
        eventLog.push(ev);
        res.writeHead(200);
        res.end('ok');
      } catch (e) {
        res.writeHead(400);
        res.end('bad json');
      }
    });
    return;
  }

  if (url === '/events') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(eventLog));
    return;
  }

  if (url === '/reset' && req.method === 'POST') {
    eventLog = [];
    res.writeHead(200);
    res.end('ok');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`TLScontact simulation running at http://127.0.0.1:${PORT}`);
});
