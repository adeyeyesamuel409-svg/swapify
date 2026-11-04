// Transactional email via Resend (https://resend.com). Thin fetch wrapper -
// no SDK dependency. Fails loudly in production when unconfigured so a broken
// verification flow is caught at startup rather than by silent non-delivery.

const RESEND_API_URL = 'https://api.resend.com/emails';

function apiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: RESEND_API_KEY is not configured - cannot send verification emails.');
    }
    return '';
  }
  return key;
}

function fromAddress(): string {
  return process.env.EMAIL_FROM ?? 'Swapify <noreply@swapifyuk.com>';
}

function webBaseUrl(): string {
  return (process.env.WEB_BASE_URL ?? 'https://swapifyuk.com').replace(/\/+$/, '');
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  const key = apiKey();
  if (!key) {
    // Local development without a key: log (including the code-bearing text so
    // the verification flow is testable end-to-end) and continue.
    console.warn(`[email] RESEND_API_KEY not set - skipping email to ${opts.to}: ${opts.subject} :: ${opts.text ?? ''}`);
    return;
  }
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Email send failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:32px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
    <p style="margin:0 0 4px;font-size:13px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#881337;">Swapify</p>
    <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${title}</h1>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
    <p style="margin:0;font-size:12px;color:#64748b;">Trade what you have for what you love.</p>
  </div></body></html>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:20px 0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#64748b;">Your verification code</p>
    <p style="margin:6px 0 0;font-size:32px;font-weight:bold;letter-spacing:0.35em;color:#881337;">${code}</p>
  </div>`;
}

export async function sendVerificationCode(email: string, name: string, code: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Your Swapify verification code',
    html: shell(
      `Hi ${escapeHtml(name)}, verify your email`,
      `<p style="margin:0;color:#334155;font-size:15px;line-height:1.6;">Welcome to Swapify! Enter this code to verify your email address and activate your account.</p>
       ${codeBlock(code)}
       <p style="margin:0;color:#64748b;font-size:13px;">The code expires in 15 minutes. If you didn't create a Swapify account, you can safely ignore this email.</p>`,
    ),
    text: `Welcome to Swapify! Your verification code is ${code}. It expires in 15 minutes.`,
  });
}

export async function sendPasswordResetCode(email: string, name: string, code: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Your Swapify password reset code',
    html: shell(
      `Hi ${escapeHtml(name)}, reset your password`,
      `<p style="margin:0;color:#334155;font-size:15px;line-height:1.6;">Use this code to choose a new password for your Swapify account.</p>
       ${codeBlock(code)}
       <p style="margin:0;color:#64748b;font-size:13px;">The code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>`,
    ),
    text: `Your Swapify password reset code is ${code}. It expires in 15 minutes.`,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export { webBaseUrl };
