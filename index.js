const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 3000;
const pairingRequests = new Map();

app.get('/', (req, res) => {
  res.send('Bot Brother WhatsApp Engine is alive ✅');
});

app.post('/start-pairing', async (req, res) => {
  try {
    const { token, phone } = req.body;

    if (!token || !phone) {
      return res.status(400).json({ success: false, error: 'Token and phone are required' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const sessionPath = path.join(__dirname, 'sessions', token);

    // Delete old session to avoid "Connection Closed" error
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    fs.mkdirSync(sessionPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Bot Brother', 'Chrome', '122.0.0'],
      markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

    // Wait a bit before requesting pairing code
    await new Promise(resolve => setTimeout(resolve, 2000));

    let pairingCode = null;

    if (!sock.authState.creds.registered) {
      try {
        pairingCode = await sock.requestPairingCode(cleanPhone);
        console.log(`Pairing code for ${token}: ${pairingCode}`);
      } catch (err) {
        console.error('Pairing code error:', err);
        return res.status(500).json({ 
          success: false, 
          error: 'WhatsApp rejected the request. Wait 2 minutes and try again.' 
        });
      }

      pairingRequests.set(token, {
        code: pairingCode,
        expires: Date.now() + 2 * 60 * 1000
      });

      setTimeout(() => {
        pairingRequests.delete(token);
      }, 2 * 60 * 1000);
    }

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        console.log(`✅ User ${token} connected successfully`);
        pairingRequests.delete(token);
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log(`Connection closed for ${token}. Code:`, code);
      }
    });

    res.json({
      success: true,
      pairingCode: pairingCode,
      expiresIn: 120
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to start pairing. Try again later.' });
  }
});

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
