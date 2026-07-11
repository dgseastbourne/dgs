// POST /api/admin/login — emails a magic sign-in link if the address matches ADMIN_EMAIL
import { sign } from '../_auth.js';
import { emailShell, emailButton } from '../_email.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email } = req.body || {};
    const adminEmail = process.env.ADMIN_EMAIL;
    const secret = process.env.SESSION_SECRET;
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.CONTACT_FROM_EMAIL || 'onboarding@resend.dev';

    if (!adminEmail || !secret || !apiKey) {
        return res.status(500).json({ error: 'Admin login is not configured yet.' });
    }

    // Always answer the same way — don't reveal whether an email is the admin
    const genericOk = { ok: true, message: 'If that address is registered, a sign-in link is on its way.' };

    if (!email || email.trim().toLowerCase() !== adminEmail.trim().toLowerCase()) {
        return res.status(200).json(genericOk);
    }

    const token = sign({ kind: 'login', email: adminEmail }, secret, 15 * 60); // 15 min
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const link = `${proto}://${host}/api/admin/verify?token=${encodeURIComponent(token)}`;

    try {
        const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: `DGS Admin <${from}>`,
                to: [adminEmail],
                subject: 'Your DGS admin sign-in link',
                html: emailShell({
                    title: 'Sign in to the dashboard',
                    subtitle: 'Use the button below — the link expires in 15 minutes.',
                    body: `
                        ${emailButton(link, 'Sign in to the dashboard')}
                        <p style="font-size:12px;color:#999;text-align:center;margin:0">
                            Button not working? Copy this address into your browser:<br>
                            <span style="word-break:break-all;color:#777">${link}</span>
                        </p>`,
                    footerNote: "If you didn't request this email, you can safely ignore it.",
                }),
            }),
        });
        if (!r.ok) {
            console.error('Resend error:', r.status, await r.text());
            return res.status(502).json({ error: 'Could not send the sign-in email. Try again shortly.' });
        }
        return res.status(200).json(genericOk);
    } catch (err) {
        console.error('Login email failed:', err);
        return res.status(502).json({ error: 'Could not send the sign-in email. Try again shortly.' });
    }
}
