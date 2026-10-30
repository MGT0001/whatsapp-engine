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

// ======================
// TEMPORARY TEST TOKENS
// ======================
const validTokens = {
  "TEST1234": { expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, plan: "test" },
  "ADMIN001": { expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, plan: "admin" },
  "BBT00001": { expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, plan: "monthly" },
};

function isTokenValid(token) {
  if (!token) return { valid: false, reason: "Token is required" };
  
  const cleanToken = token.trim().toUpperCase();
  const data = validTokens[cleanToken];
  
  if (!data) {
    return { valid: false, reason: "Invalid token. Token does not exist." };
  }
  
  if (data.expiresAt < Date.now()) {
    return { valid: false, reason: "This token has expired." };
  }
  
  return { valid: true, data, cleanToken };
}

app.get('/', (req, res) => {
  res.send('Bot Brother WhatsApp Engine is alive ✅');
});

app.post('/start-pairing', async (req, res) => {
  try {
    const { token, phone } = req.body;

    console.log('Received request:', { token, phone });

    if (!token || !phone) {
      return res.status(400).json({ success: false, error: 'Token and phone number are required' });
    }

    // Validate token
    const tokenCheck = isTokenValid(token);
    if (!tokenCheck.valid) {
      console.log('Token rejected:', tokenCheck.reason);
      return res.status(403).json({ success: false, error: tokenCheck.reason });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ success: false, error: 'Invalid phone number' });
    }

    const sessionPath = path.join(__dirname, 'sessions', tokenCheck.cleanToken);

    // Clear old session
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

    await new Promise(resolve => setTimeout(resolve, 2000));

    let pairingCode = null;

    if (!sock.authState.creds.registered) {
      try {
        pairingCode = await sock.requestPairingCode(cleanPhone);
        console.log(`[${tokenCheck.cleanToken}] Pairing code: ${pairingCode}`);
      } catch (err) {
        console.error('Pairing error:', err?.message || err);
        return res.status(500).json({
          success: false,
          error: 'WhatsApp rejected the request. Wait 3 minutes and try again.'
        });
      }

      pairingRequests.set(tokenCheck.cleanToken, {
        code: pairingCode,
        expires: Date.now() + 5 * 60 * 1000 // 5 minutes
      });

      setTimeout(() => {
        pairingRequests.delete(tokenCheck.cleanToken);
      }, 5 * 60 * 1000);
    }

    sock.ev.on('connection.update', (update) => {
      const { connection } = update;
      if (connection === 'open') {
        console.log(`✅ [${tokenCheck.cleanToken}] Connected successfully`);
        pairingRequests.delete(tokenCheck.cleanToken);
      }
    });

    res.json({
      success: true,
      pairingCode: pairingCode,
      expiresIn: 300
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error. Please try again.' });
  }
});

app.get('/status/:token', (req, res) => {
  const token = req.params.token.toUpperCase();
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
