// Servidor Express para servir a UI e registrar logs simples.
require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint para receber eventos de alerta do frontend e logar
app.post('/alert', (req, res) => {
  const { type, message, price, drawdownPct, timestamp } = req.body || {};
  console.log(`[ALERT] ${new Date(timestamp || Date.now()).toISOString()} | ${type} | ${message} | price=${price} | drawdown=${drawdownPct}%`);
  res.json({ ok: true });
});

// Healthcheck
app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});