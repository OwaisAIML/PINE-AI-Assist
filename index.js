// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();

// ---- ENV ----
const PORT = process.env.PORT || 3000;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const OWNER_EMAIL = process.env.OWNER_EMAIL || process.env.SMTP_USER;
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER;

// ---- BASIC MIDDLEWARE ----
app.use(
  cors({
    origin: "*", // later you can restrict to your domain
  })
);
app.use(express.json());

// ---- CHECK EMAIL CONFIG ----
if (!SMTP_USER || !SMTP_PASS) {
  console.warn("⚠️ SMTP_USER or SMTP_PASS is missing in .env. Emails will fail.");
} else {
  console.log("✅ SMTP config loaded for:", SMTP_USER);
}

// ---- CREATE TRANSPORTER ----
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

// Optional: verify transporter on startup
transporter.verify((err, success) => {
  if (err) {
    console.error("❌ SMTP verification failed:", err.message);
  } else {
    console.log("✅ SMTP server is ready to take messages");
  }
});

// ---- HEALTH CHECK ----
app.get("/", (req, res) => {
  res.send("PINE backend is running ✅");
});

// ---- MAIN WEBSITE WEBHOOK ----
app.post("/webhook/website", async (req, res) => {
  try {
    console.log("📩 Website lead received:", req.body);

    const { message, from, source } = req.body || {};

    if (!message) {
      console.warn("⚠️ No 'message' field in payload");
      return res
        .status(400)
        .json({ success: false, error: "Missing 'message' field" });
    }

    // Email to YOU (owner)
    const mailOptions = {
      from: `"PINE Website" <${EMAIL_FROM}>`,
      to: OWNER_EMAIL,
      subject: `New lead from PINE website (${source || "contact-form"})`,
      text:
        message +
        (from
          ? `\n\nReply to: ${from}`
          : "\n\n(No email address provided by user)"),
      replyTo: from || undefined,
    };

    console.log("📨 Sending email to owner:", OWNER_EMAIL);
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Owner email sent, messageId:", info.messageId);

    // Optional: send confirmation to visitor
    if (from) {
      try {
        const confirmInfo = await transporter.sendMail({
          from: `"PINE Digital Systems" <${EMAIL_FROM}>`,
          to: from,
          subject: "Thanks for contacting PINE Digital Systems",
          text:
            "Thanks for reaching out! We received your project details and will reply soon.\n\n---\n" +
            message,
        });
        console.log("✅ Confirmation email sent to visitor:", confirmInfo.messageId);
      } catch (err) {
        console.warn("⚠️ Could not send confirmation email to visitor:", err.message);
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Error in /webhook/website:", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
});

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log(`PINE backend listening on http://localhost:${PORT}`);
});
