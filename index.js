const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

// Health check for Render + UptimeRobot
app.get('/', (req, res) => {
  res.send('Bot Brother WhatsApp Engine is alive ✅');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Bot Brother', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  // Request pairing code
  if (!sock.authState.creds.registered) {
    const phoneNumber = '2347038885825'; // without +
    setTimeout(async () => {
      const code = await sock.requestPairingCode(phoneNumber);
      console.log('=================================');
      console.log('PAIRING CODE:', code);
      console.log('=================================');
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === 'open') {
      console.log('WhatsApp connected successfully ✅');
    }
  });

  // Basic message handler
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    if (text.toLowerCase() === 'ping') {
      await sock.sendMessage(from, { text: 'Pong from Bot Brother 🚀' });
    }
  });
}

startBot();
