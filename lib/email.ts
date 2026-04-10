const RESEND_API_URL = 'https://api.resend.com/emails';

export async function sendWaitlistConfirmation(email: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    throw new Error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL environment variable');
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: email,
      subject: 'You’re on the Laksh beta waitlist',
      html: `
        <div style="font-family: system-ui, sans-serif; background: #020617; color: #f8fafc; padding: 24px; border-radius: 18px;">
          <h1 style="font-size: 1.5rem; margin-bottom: 16px;">You’re on the Laksh beta waitlist</h1>
          <p style="font-size: 1rem; line-height: 1.6; margin-bottom: 16px;">Thanks for joining the Laksh beta waitlist.</p>
          <p style="font-size: 1rem; line-height: 1.6; margin-bottom: 24px;">You’re officially on the list, and we’ll reach out when beta spots open up.</p>
          <p style="font-size: 0.95rem; color: #94a3b8;">— Laksh</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API request failed: ${response.status} ${body}`);
  }
}

export async function sendApprovalNotification(email: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    throw new Error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL environment variable');
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: email,
      subject: 'Your Laksh beta access is approved',
      html: `
        <div style="font-family: system-ui, sans-serif; background: #020617; color: #f8fafc; padding: 24px; border-radius: 18px;">
          <h1 style="font-size: 1.5rem; margin-bottom: 16px;">Your Laksh beta access is approved</h1>
          <p style="font-size: 1rem; line-height: 1.6; margin-bottom: 16px;">Good news — your account has been approved for Laksh beta access.</p>
          <p style="font-size: 1rem; line-height: 1.6; margin-bottom: 24px;">Sign in anytime to access the app and start using your portfolio tools.</p>
          <p style="font-size: 0.95rem; color: #94a3b8;">— Laksh</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API request failed: ${response.status} ${body}`);
  }
}

export async function sendAdminWaitlistNotification(email: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'nikhil@laksh.app';

  if (!apiKey || !fromEmail) {
    throw new Error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL environment variable');
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: adminEmail,
      subject: `New Laksh beta waitlist signup: ${email}`,
      html: `
        <div style="font-family: system-ui, sans-serif; background: #020617; color: #f8fafc; padding: 24px; border-radius: 18px;">
          <h1 style="font-size: 1.5rem; margin-bottom: 16px;">New waitlist signup</h1>
          <p style="font-size: 1rem; line-height: 1.6; margin-bottom: 24px;"><strong>${email}</strong> just joined the Laksh beta waitlist.</p>
          <p style="font-size: 0.9rem; color: #94a3b8;"><a href="https://laksh.app/admin/waitlist" style="color: #6ee7b7; text-decoration: none;">Review in admin panel →</a></p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API request failed: ${response.status} ${body}`);
  }
}
