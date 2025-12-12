const express = require('express');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.post('/alert', (req, res) => {
  console.log('[ALERT]', req.body);
  res.json({ received: true });
});

// Cria HTTP server para acoplar o WebSocket
const server = http.createServer(app);

// Proxy WebSocket: cliente conecta em ws(s)://host/ws?symbol=btcusdt&stream=aggTrade
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (client, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const symbol = (url.searchParams.get('symbol') || 'btcusdt').toLowerCase();
    const stream = (url.searchParams.get('stream') || 'aggTrade');

    const upstreamUrl = `wss://stream.binance.com:9443/ws/${symbol}@${stream}`;
    const upstream = new WebSocket(upstreamUrl);

    const closeBoth = (code, reason) => {
      try { upstream.close(); } catch (_) {}
      try { client.close(code, reason); } catch (_) {}
    };

    upstream.on('open', () => {});

    upstream.on('message', (data) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });

    upstream.on('error', (err) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ proxy_error: true, message: err?.message || String(err) }));
      }
      closeBoth();
    });

    upstream.on('close', () => { closeBoth(); });

    client.on('close', () => { try { upstream.close(); } catch (_) {} });
    client.on('error', () => { try { upstream.close(); } catch (_) {} });
  } catch (e) {
    try { client.close(); } catch (_) {}
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});