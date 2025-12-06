# PINE AI Assist — MVP (Quick start)


1. Clone repo.
2. Create a Google Cloud service account with Sheets API access and share the sheet with the service account email.
3. Copy `.env.example` -> `.env` and fill variables.
4. `npm install`
5. `npm run dev` (or `npm start`)
6. Open `http://localhost:3000` and test the contact form.


Notes:
- This scaffold is intentionally minimal. Replace sendmail transport with SendGrid/Mailgun or SMTP in production.
- The OpenAI model, system prompt, and sheet layout are easy to customize.