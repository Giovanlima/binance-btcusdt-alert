const express = require('express');
const morgan = require('morgan');
const path = require('path');
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});