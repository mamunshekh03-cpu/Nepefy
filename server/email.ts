import nodemailer from 'nodemailer';

export interface SendOtpResult {
  delivered: boolean;
  provider: 'resend' | 'smtp' | 'preview';
  error?: string;
}

function resolveSmtpConfig() {
  const gmailUser = process.env.GMAIL_USER?.trim() || '';
  const gmailAppPass = process.env.GMAIL_APP_PASSWORD?.trim() || '';
  const smtpUserEnv = process.env.SMTP_USER?.trim() || '';
  const smtpPassEnv = process.env.SMTP_PASS?.trim() || '';
  const looksLikeGmail = /@(gmail|googlemail)\.com$/i.test(smtpUserEnv);

  const rawHost =
    process.env.SMTP_HOST?.trim() ||
    ((gmailUser && gmailAppPass) || (looksLikeGmail && smtpPassEnv) ? 'smtp.gmail.com' : '');
  const isGmail = rawHost.toLowerCase().includes('gmail.com');
  const rawUser = (isGmail && gmailUser) || smtpUserEnv || gmailUser;
  const rawPass = (isGmail && gmailAppPass) || smtpPassEnv || gmailAppPass;

  // Google App Passwords are often copied with spaces ("xxxx xxxx xxxx xxxx")
  const normalizedPass =
    isGmail && rawPass.replace(/\s+/g, '').length === 16 ? rawPass.replace(/\s+/g, '') : rawPass;

  const defaultPort = isGmail ? 465 : 587;
  const rawPort = Number(process.env.SMTP_PORT || defaultPort);
  const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : defaultPort;

  return {
    host: rawHost,
    port,
    user: rawUser,
    pass: normalizedPass,
    isGmail,
    configured: Boolean(rawHost && rawUser && normalizedPass),
  };
}

export function isEmailProviderConfigured(): boolean {
  const hasResend = Boolean(process.env.RESEND_API_KEY?.trim());
  const smtp = resolveSmtpConfig();
  return hasResend || smtp.configured;
}

export async function sendOtpEmail(params: {
  to: string;
  code: string;
  purpose: 'SIGNUP_OTP' | 'PASSWORD_RESET';
}): Promise<SendOtpResult> {
  const rawFrom = process.env.EMAIL_FROM?.trim() || 'Nepefy <no-reply@nepefy.app>';
  const isPublicWebmailFrom = /@(gmail|yahoo|outlook|hotmail|live|icloud)\.com/i.test(rawFrom);
  const fromEmail = rawFrom;

  const isSignup = params.purpose === 'SIGNUP_OTP';
  const subject = isSignup
    ? `${params.code} is your Nepify verification code`
    : `${params.code} is your Nepify password reset code`;
  const validMinutes = isSignup ? 10 : 15;
  const heading = isSignup ? 'Verify Your Email Address' : 'Reset Your Password';
  const intro = isSignup
    ? 'Welcome to Nepify! Please use the 6-digit verification code below to verify your email address and activate your account.'
    : 'We received a request to reset your Nepify account password. Use the verification code below to proceed.';

  const textBody = `${heading}\n\n${intro}\n\nVerification Code: ${params.code}\nThis code expires in ${validMinutes} minutes.\n\nIf you did not request this, please ignore this email.`;
  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 28px 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; color: #0f172a; line-height: 1.5;">
      <div style="font-size: 20px; font-weight: 700; color: #1e3a8a; margin-bottom: 8px; letter-spacing: -0.5px;">Nepify</div>
      <div style="font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px;">${heading}</div>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px;">${intro}</p>
      <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 18px; text-align: center; margin-bottom: 20px;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #2563eb; font-family: monospace;">${params.code}</span>
      </div>
      <p style="font-size: 12px; color: #64748b; margin: 0 0 8px;">This code will expire in ${validMinutes} minutes. Never share this code with anyone.</p>
      <p style="font-size: 12px; color: #94a3b8; margin: 0;">If you didn't request this email, you can safely ignore it.</p>
    </div>
  `;

  const smtp = resolveSmtpConfig();
  const hasCustomNonResendSmtp = Boolean(smtp.configured && !smtp.host.toLowerCase().includes('resend.com'));
  const errors: string[] = [];

  const attemptSmtpPort = async (portToUse: number) => {
    const transportOptions = smtp.isGmail
      ? {
          service: 'gmail',
          auth: {
            user: smtp.user,
            pass: smtp.pass,
          },
        }
      : {
          host: smtp.host,
          port: portToUse,
          secure: portToUse === 465,
          connectionTimeout: 8000,
          greetingTimeout: 8000,
          socketTimeout: 10000,
          auth: {
            user: smtp.user,
            pass: smtp.pass,
          },
        };
    const transporter = nodemailer.createTransport(transportOptions as any);
    const smtpFrom =
      smtp.isGmail ||
      (smtp.user.includes('@') && (/@resend\.dev/i.test(fromEmail) || /@nepefy\.app/i.test(fromEmail)))
        ? `"Nepify" <${smtp.user}>`
        : fromEmail;
    await transporter.sendMail({
      from: smtpFrom,
      to: params.to,
      subject,
      text: textBody,
      html: htmlBody,
      headers: {
        'X-Entity-Ref-ID': `${Date.now()}-${params.code}`,
      },
    });
  };

  const trySmtp = async (): Promise<SendOtpResult | null> => {
    if (!smtp.configured) return null;
    try {
      await attemptSmtpPort(smtp.port);
      return { delivered: true, provider: 'smtp' };
    } catch (err: any) {
      const firstMsg = String(err?.message || err || 'SMTP delivery failed');
      const isConnectionErr = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Greeting never received|Connection timeout/i.test(
        firstMsg
      );
      if (smtp.isGmail && isConnectionErr) {
        const altPort = smtp.port === 465 ? 587 : 465;
        try {
          await attemptSmtpPort(altPort);
          return { delivered: true, provider: 'smtp' };
        } catch (altErr: any) {
          const altMsg = String(altErr?.message || altErr || firstMsg);
          console.warn('[email] SMTP fallback port error:', altMsg);
          errors.push(`SMTP(${smtp.host}:${altPort}): ${altMsg}`);
          return null;
        }
      }
      console.warn('[email] SMTP error:', firstMsg);
      errors.push(`SMTP(${smtp.host}:${smtp.port}): ${firstMsg}`);
      return null;
    }
  };

  // 1. If a non-Resend SMTP (e.g. Gmail SMTP with App Password / Brevo) is configured, use it first
  if (hasCustomNonResendSmtp) {
    const smtpRes = await trySmtp();
    if (smtpRes) return smtpRes;
  }

  // 2. Try Resend API if configured
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    const sendViaResend = async (sender: string) => {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: sender,
          to: [params.to],
          subject,
          html: htmlBody,
          text: textBody,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) return { ok: true as const, status: resp.status, errBody: '' };
      const errBody = await resp.text().catch(() => '');
      return { ok: false as const, status: resp.status, errBody };
    };

    try {
      const primarySender = isPublicWebmailFrom ? 'Nepefy <onboarding@resend.dev>' : fromEmail;
      let attempt = await sendViaResend(primarySender);

      if (!attempt.ok && attempt.status === 403 && !primarySender.includes('onboarding@resend.dev')) {
        const retryOnboarding = await sendViaResend('Nepefy <onboarding@resend.dev>');
        if (retryOnboarding.ok) {
          return { delivered: true, provider: 'resend' };
        }
        attempt = retryOnboarding;
      }

      if (attempt.ok) {
        return { delivered: true, provider: 'resend' };
      }

      let parsedMsg = attempt.errBody;
      try {
        const j = JSON.parse(attempt.errBody);
        if (j?.message) parsedMsg = String(j.message);
      } catch {
        // keep raw text
      }
      console.warn(`[email] Resend HTTP ${attempt.status}:`, parsedMsg.slice(0, 240));
      errors.push(`Resend HTTP ${attempt.status}: ${parsedMsg.slice(0, 260)}`);
    } catch (err: any) {
      const msg = String(err?.message || err || 'Resend request failed');
      console.warn('[email] Resend error:', msg);
      errors.push(`Resend: ${msg}`);
    }
  }

  // 3. Fallback to configured SMTP (skip smtp.resend.com if user is not 'resend' and Resend API already failed)
  if (
    !hasCustomNonResendSmtp &&
    smtp.configured &&
    (!smtp.host.toLowerCase().includes('resend.com') || smtp.user === 'resend')
  ) {
    const smtpRes = await trySmtp();
    if (smtpRes) return smtpRes;
  }

  return {
    delivered: false,
    provider: 'preview',
    error: errors.length > 0 ? errors.join(' | ') : 'No email provider configured',
  };
}
