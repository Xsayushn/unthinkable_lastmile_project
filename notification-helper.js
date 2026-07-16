const nodemailer = require('nodemailer');

let transporter = null;
let isEthereal = false;

async function getTransporter() {
  if (transporter) return transporter;

  // In test mode, we don't need a real transporter
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    console.log(`[NotificationHelper] Initializing real SMTP transporter for ${host}:${port}`);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
    isEthereal = false;
  } else {
    console.log('[NotificationHelper] SMTP credentials missing. Initializing Ethereal Email test account...');
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      isEthereal = true;
      console.log(`[NotificationHelper] Ethereal test account created: User=${testAccount.user}`);
    } catch (err) {
      console.warn('[NotificationHelper] Failed to create Ethereal test account. Falling back to mock logs only:', err.message);
      transporter = null;
    }
  }

  return transporter;
}

/**
 * Sends an email notification.
 * @param {string} to Recipient email address
 * @param {string} subject Email subject
 * @param {string} text Plain text content
 * @returns {Promise<boolean>} Resolves to true if sent, false otherwise
 */
async function sendEmailNotification(to, subject, text) {
  if (process.env.NODE_ENV === 'test') {
    return true; // Skip sending in test mode
  }

  try {
    const tx = await getTransporter();
    if (!tx) {
      return false;
    }

    const from = process.env.SMTP_FROM || (isEthereal ? '"Last-Mile Tracker" <noreply@ethereal.email>' : 'noreply@tracker.com');
    const info = await tx.sendMail({
      from,
      to,
      subject,
      text
    });

    if (isEthereal) {
      console.log(`[NOTIFICATION] Ethereal Email sent: ${info.messageId}`);
      console.log(`[NOTIFICATION] Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
    } else {
      console.log(`[NOTIFICATION] Real Email sent: ${info.messageId}`);
    }
    return true;
  } catch (error) {
    console.error('[NotificationHelper] Error sending email:', error.message);
    return false;
  }
}

module.exports = { sendEmailNotification };
