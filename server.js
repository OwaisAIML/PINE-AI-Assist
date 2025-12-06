// server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// ----- ENV -----
const OWNER_EMAIL = process.env.OWNER_EMAIL;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

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
    range: 'Sheet1!A:Z',          // change if your sheet name/range is different
    valueInputOption: 'RAW',
    requestBody: {
      values: [row],
    },
  });
}

// ----- OPENAI SETUP -----
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function callOpenAI(messages) {
  const resp = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',        // or any other model you use
    messages,
    temperature: 0.7,
  });

  return resp.choices[0].message.content;
}

// ----- ROUTES -----

// Simple health check for Render
app.get('/', (req, res) => {
  res.send('PINE AI Assist backend is running ✅');
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

    const aiResp = await callOpenAI([
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ]);

    // Attempt to parse JSON. If AI returned raw text, fallback.
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
      console.warn('Sheet append failed', err.message);
    }

    // Send simple email notification (optional if OWNER_EMAIL is set)
    if (OWNER_EMAIL) {
      try {
        const transporter = nodemailer.createTransport({ sendmail: true });
        await transporter.sendMail({
          from: 'no-reply@pine.ai',
          to: OWNER_EMAIL,
          subject: `New lead: ${name || 'Website visitor'}`,
          text: `New lead at ${timestamp}
Name: ${name || ''}
Contact: ${contact || ''}
Message: ${message || ''}
AI Reply: ${replyText}`,
        });
      } catch (err) {
        console.warn('Email failed', err.message);
      }
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
