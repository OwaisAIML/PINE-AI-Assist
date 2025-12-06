// server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// ----- ENV -----
const OWNER_EMAIL = process.env.OWNER_EMAIL;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GROK_API_KEY = process.env.GROK_API_KEY;

// Log env presence (no secrets)
console.log('=== ENV CHECK AT STARTUP ===');
console.log('GROK_API_KEY set:', !!GROK_API_KEY);
console.log('GOOGLE_SHEET_ID:', SHEET_ID ? 'present' : 'MISSING');
console.log('OWNER_EMAIL:', OWNER_EMAIL || 'MISSING');
console.log('SMTP_HOST:', process.env.SMTP_HOST || 'MISSING');
console.log('SMTP_PORT:', process.env.SMTP_PORT || 'MISSING');
console.log('SMTP_USER set:', !!process.env.SMTP_USER);
console.log('=============================');

// ----- GOOGLE SHEETS SETUP -----
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth });

async function appendSheetRow(row) {
  if (!SHEET_ID) {
    console.error('appendSheetRow: SHEET_ID is missing, not calling Sheets API.');
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A:Z',
    valueInputOption: 'RAW',
    requestBody: {
      values: [row],
    },
  });
}

// ----- GROK (xAI) CALLER -----
async function callGrok(messages) {
  if (!GROK_API_KEY) {
    console.error('Missing GROK_API_KEY in environment');
    return 'Sorry, my AI configuration is incomplete.';
  }

  const resp = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-2-latest',
      messages,
      temperature: 0.7,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error('Grok API error:', resp.status, text);
    return 'Sorry, I could not generate a reply right now.';
  }

  const data = await resp.json();
  return (
    data.choices?.[0]?.message?.content ||
    'Sorry, I could not generate a reply.'
  );
}

// ----- EMAIL (SMTP) SETUP -----
function createTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('SMTP not fully configured, emails will not be sent.');
    return null;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465, // true if 465, else false
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // Optional: verify connection at startup
  transporter.verify((err, success) => {
    if (err) {
      console.warn('SMTP verify failed:', err.message);
    } else {
      console.log('SMTP server is ready to take messages.');
    }
  });

  return transporter;
}

// Create one transporter instance (or null if misconfigured)
const emailTransporter = createTransporter();

// ----- ROUTES -----

// Health check
app.get('/', (req, res) => {
  res.send('PINE AI Assist backend is running ✅');
});

// Debug route to see env status (no secrets)
app.get('/debug', (req, res) => {
  res.json({
    env: {
      GROK_API_KEY: !!process.env.GROK_API_KEY,
      GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID ? 'present' : 'missing',
      OWNER_EMAIL: !!process.env.OWNER_EMAIL,
      SMTP_HOST: process.env.SMTP_HOST || 'MISSING',
      SMTP_PORT: process.env.SMTP_PORT || 'MISSING',
      SMTP_USER: !!process.env.SMTP_USER,
    },
  });
});

// Avoid "Cannot GET /api/contact" confusion
app.get('/api/contact', (req, res) => {
  res.send('Use POST with JSON body to /api/contact for AI replies.');
});

app.post('/api/contact', async (req, res) => {
  try {
    const { name, contact, message, source } = req.body;
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    console.log('Incoming lead:', { name, contact, source });

    const systemMessage =
      'You are PINE AI Assist, a professional assistant for a small business. Tone: helpful, concise, polite. Answer the customer and include a short CTA.';

    const userMessage = `Customer message: "${message}"`;

    const aiResp = await callGrok([
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ]);

    let replyText = aiResp;
    try {
      const parsed = JSON.parse(aiResp);
      if (parsed.reply_text) replyText = parsed.reply_text;
    } catch (e) {
      // ignore, plain text
    }

    const row = [
      id,
      timestamp,
      name || '',
      contact || '',
      message || '',
      replyText,
      source || 'web',
    ];

    try {
      await appendSheetRow(row);
      console.log('Sheet append OK for lead', id);
    } catch (err) {
      console.warn('Sheet append failed:', err.message);
    }

    if (OWNER_EMAIL && emailTransporter) {
      try {
        const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;
        await emailTransporter.sendMail({
          from: fromEmail,
          to: OWNER_EMAIL,
          subject: `New lead: ${name || 'Website visitor'}`,
          text: `New lead at ${timestamp}
Name: ${name || ''}
Contact: ${contact || ''}
Message: ${message || ''}
AI Reply: ${replyText}`,
        });
        console.log('Lead email sent to', OWNER_EMAIL);
      } catch (err) {
        console.warn('Email failed:', err.message);
      }
    } else {
      console.warn('Skipping email: OWNER_EMAIL or SMTP config missing.');
    }

    return res.json({ id, reply: replyText });
  } catch (err) {
    console.error('contact error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ----- SERVER START -----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
