import 'dotenv/config';
import express from 'express';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import P from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DEFAULT_REPLY =
  process.env.DEFAULT_REPLY ||
  'Thanks for your message. Bot Brother engine is online.';

let status = 'starting';

const COMMANDS = {
  '/start': 'Welcome to Bot Brother WhatsApp engine.',
  '/menu': 'Menu:\n1. Info\n2. Support\n3. Prices',
  '/price': 'See plans in Bot Brother Telegram bot.',
  '/help': 'Commands: /start /menu /price /help'
};

app.get('/health', (req, res) => {
  res.json({ ok: true, status, time: new Date().toISOString() });
});

app.get('/status', (req, res) => {
  res.json({ status });
});

function matchCommand(text) {
  const t = (text || '').trim().toLowerCase();
  if (COMMANDS[t]) return COMMANDS[t];
  if (t.includes('hello') || t.includes('hi')) {
    return 'Hello! Bot Brother WhatsApp engine is online.';
  }
  return null;
}

async function startWhatsApp() {
  const authDir = path.join(process.cwd(), 'auth_info');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '22.04.4'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      status = 'qr';
      console.log('\n=== SCAN QR (WhatsApp → Linked devices) ===\n');
      qrcode.generate(qr, { small: true });
      console.log('\nIf QR is hard to scan, we can retry pairing after connect is stable.\n');
    }

    if (connection === 'open') {
      status = 'connected';
      console.log('\n✅ WhatsApp connected\n');
    }

    if (connection === 'close') {
      status = 'disconnected';
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('Connection closed', code, lastDisconnect?.error?.message || '');

      // 401 = logged out / bad session → do not loop forever
      if (code === DisconnectReason.loggedOut || code === 401) {
        console.log('\nSession rejected (401). Delete auth_info and run npm start again.\n');
        return;
      }

      console.log('Reconnecting in 3s...');
      setTimeout(() => startWhatsApp(), 3000);
    }
  });

  // Pairing code AFTER short delay (only if not registered)
  const pairNumber = (process.env.PAIRING_NUMBER || '').replace(/\D/g, '');
  if (pairNumber && !state.creds?.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairNumber);
        status = 'pairing';
        console.log('\n=== PAIRING CODE ===');
        console.log(code);
        console.log('WhatsApp → Linked devices → Link with phone number');
        console.log('Enter this code on the phone.\n');
      } catch (e) {
        console.log('Pairing code error:', e.message);
        console.log('Use the QR above instead.\n');
      }
    }, 5000);
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    if (!from || from.endsWith('@g.us')) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '';
    if (!text) return;

    try {
      const reply = matchCommand(text) || DEFAULT_REPLY;
      await sock.sendMessage(from, { text: reply });
    } catch (e) {
      console.log('Reply error:', e.message);
    }
  });
}

app.listen(PORT, () => {
  console.log('Health server on', PORT);
  startWhatsApp().catch((e) => {
    status = 'error';
    console.error(e);
  });
});