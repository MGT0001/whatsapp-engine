const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Store active pairing requests (valid for 2 minutes)
const pairingRequests = new Map();

// Health check - this must work
app.get('/', (req, res) => {
  res.send('Bot Brother WhatsApp Engine is alive ✅');
});

// Start pairing
app.post('/start-pairing', async (req, res) => {
  try {
    const { token, phone } = req.body;

    if (!token || !phone) {
      return res.status(400).json({ success: false, error: 'Token and phone are required' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const sessionPath = path.join(__dirname, 'sessions', token);

    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Bot Brother', 'Chrome', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    let pairingCode = null;

    if (!sock.authState.creds.registered) {
      pairingCode = await sock.requestPairingCode(cleanPhone);

      pairingRequests.set(token, {
        code: pairingCode,
        expires: Date.now() + 2 * 60 * 1000
      });

      setTimeout(() => {
        pairingRequests.delete(token);
      }, 2 * 60 * 1000);
    }

    sock.ev.on('connection.update', (update) => {
      const { connection } = update;
      if (connection === 'open') {
        console.log(`User ${token} connected successfully ✅`);
        pairingRequests.delete(token);
      }
    });

    res.json({
      success: true,
      pairingCode: pairingCode,
      expiresIn: 120
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to start pairing' });
  }
});

// Status check
app.get('/status/:token', (req, res) => {
  const { token } = req.params;
  const request = pairingRequests.get(token);

  if (request && Date.now() < request.expires) {
    return res.json({
      success: true,
      status: 'waiting',
      pairingCode: request.code,
      expiresIn: Math.floor((request.expires - Date.now()) / 1000)
    });
  }

  const sessionPath = path.join(__dirname, 'sessions', token);
  if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
    return res.json({ success: true, status: 'connected' });
  }

  res.json({ success: true, status: 'not_started' });
});

app.listen(PORT, () => {
  console.log(`Bot Brother WhatsApp Engine running on port ${PORT}`);
});
