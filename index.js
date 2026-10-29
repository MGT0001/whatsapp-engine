const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Store active pairing requests (code valid for 2 minutes)
const pairingRequests = new Map();

// Health check
app.get('/', (req, res) => {
  res.send('Bot Brother WhatsApp Engine is alive ✅');
});

// Start pairing for a user
app.post('/start-pairing', async (req, res) => {
  const { token, phone } = req.body;

  if (!token || !phone) {
    return res.status(400).json({ success: false, error: 'Token and phone required' });
  }

  const cleanPhone = phone.replace(/\D/g, '');
  const sessionPath = path.join(__dirname, 'sessions', token);

  // Create session folder
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  try {
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
      
      // Store the request for 2 minutes
      pairingRequests.set(token, {
        code: pairingCode,
        phone: cleanPhone,
        sock,
        expires: Date.now() + 2 * 60 * 1000 // 2 minutes
      });

      // Auto remove after 2 minutes
      setTimeout(() => {
        pairingRequests.delete(token);
      }, 2 * 60 * 1000);
    }

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        console.log(`User ${token} connected successfully ✅`);
        pairingRequests.delete(token);
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          // Will reconnect on next request
        }
      }
    });

    res.json({
      success: true,
      pairingCode: pairingCode,
      expiresIn: 120 // seconds
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to start pairing' });
  }
});

// Check status
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

  // Check if already connected
  const sessionPath = path.join(__dirname, 'sessions', token);
  if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
    return res.json({ success: true, status: 'connected' });
  }

  res.json({ success: true, status: 'not_started' });
});

app.listen(PORT, () => {
  console.log(`WhatsApp Engine running on port ${PORT}`);
});
