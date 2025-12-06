// server.js
valueInputOption: 'RAW',
requestBody: { values: [row] }
});
}


app.post('/api/contact', async (req, res) => {
try {
const { name, contact, message, source } = req.body;
const id = uuidv4();
const timestamp = new Date().toISOString();


// Basic system prompt — replace with richer business profile later
const systemMessage = `You are PINE AI Assist, a professional assistant for a small business. Tone: helpful, concise, polite. Answer the customer and include a short CTA.`;


const userMessage = `Customer message: "${message}"`;


const aiResp = await callOpenAI([
{ role: 'system', content: systemMessage },
{ role: 'user', content: userMessage }
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
const row = [id, timestamp, name || '', contact || '', message, replyText, source || 'web'];
try { await appendSheetRow(row); } catch (err) { console.warn('Sheet append failed', err.message); }


// Send simple email notification
try {
const transporter = nodemailer.createTransport({ sendmail: true });
await transporter.sendMail({
from: 'no-reply@pine.ai',
to: OWNER_EMAIL,
subject: `New lead: ${name || 'Website visitor'}`,
text: `New lead at ${timestamp}\nName: ${name}\nContact: ${contact}\nMessage: ${message}\nAI Reply: ${replyText}`
});
} catch (err) { console.warn('Email failed', err.message); }


return res.json({ id, reply: replyText });
} catch (err) {
console.error('contact error', err);
return res.status(500).json({ error: 'internal_error' });
}
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));