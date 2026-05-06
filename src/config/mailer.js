const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendEmail = async ({ to, subject, html }) => {
  try {
    const result = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'FotoKash <noreply@fotokash.com>',
      to,
      subject,
      html,
    });
    console.log('[EMAIL] Envoye a ' + to + ' : ' + subject);
    return { success: true, messageId: result.messageId };
  } catch (err) {
    console.error('[EMAIL] Erreur:', err.message);
    return { success: false, error: err.message };
  }
};

const emailTemplate = (title, content, buttonText, buttonUrl) => {
  return `
  <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0B0B0F; color: #F0F0F5; border-radius: 12px; overflow: hidden;">
    <div style="background: #141419; padding: 24px 32px; border-bottom: 2px solid #E8593C;">
      <span style="font-size: 22px; font-weight: 700; color: #F0F0F5;">Foto</span><span style="font-size: 22px; font-weight: 700; color: #E8593C;">Kash</span>
    </div>
    <div style="padding: 32px;">
      <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px; color: #F0F0F5;">${title}</h1>
      <div style="font-size: 14px; line-height: 1.7; color: #8888A0;">${content}</div>
      ${buttonText && buttonUrl ? '<div style="margin: 28px 0;"><a href="' + buttonUrl + '" style="display: inline-block; background: #E8593C; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">' + buttonText + '</a></div>' : ''}
    </div>
    <div style="padding: 20px 32px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px; color: #555568; text-align: center;">
      FotoKash &middot; Plateforme photo evenementielle &middot; Abidjan, Cote d'Ivoire<br>
      <a href="https://fotokash.com" style="color: #E8593C; text-decoration: none;">fotokash.com</a>
    </div>
  </div>`;
};

module.exports = { sendEmail, emailTemplate };
