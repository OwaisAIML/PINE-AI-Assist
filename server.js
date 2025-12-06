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

// ----- GOOGLE SHEETS SETUP -----
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  // important: convert \n in env to real newlines
  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth });

async function appendSheetRow(row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A:Z', // adjust if needed
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
      model: 'grok-2-latest', // adjust if your model name is different
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

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false, // true for 465, false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ----- ROUTES -----

// Simple health check for Render
app.get('/', (req, res) => {
  res.send('PINE AI Assist backend is running ✅');
});

// Optional: avoid "Cannot GET /api/contact" in browser
app.get('/api/contact', (req, res) => {
  res.send('Use POST with JSON body to /api/contact for AI replies.');
});

app.post('/api/contact', async (req, res) => {
  try {
    const { name, contact, message, source } = req.body;
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    // Basic system prompt — you can customize this later
    const systemMessage =
      'You are PINE AI Assist, a professional assistant for a small business. Tone: helpful, concise, polite. Answer the customer and include a short CTA.';

    const userMessage = `Customer message: "${message}"`;

    const aiResp = await callGrok([
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ]);

    // Attempt to parse JSON. If Grok returned raw text, fallback.
    let replyText = aiResp;
    try {
      const parsed = JSON.parse(aiResp);
      if (parsed.reply_text) replyText = parsed.reply_text;
    } catch (e) {
      // not JSON — use raw
    }

    // Save to Google Sheet (id, timestamp, name, contact, message, reply, source)
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
    } catch (err) {
      console.warn('Sheet append failed:', err.message);
    }

    // Send simple email notification (optional if OWNER_EMAIL is set)
    if (OWNER_EMAIL) {
      const transporter = createTransporter();
      if (transporter) {
        try {
          const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;
          await transporter.sendMail({
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
      }
    } else {
      console.warn('OWNER_EMAIL is not set; skipping notification email.');
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
