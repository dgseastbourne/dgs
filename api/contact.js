// POST /api/contact — sends the contact form message via Resend
import { emailShell } from './_email.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { name, email, phone, message, website } = req.body || {};

    // Honeypot field — real users never fill this in
    if (website) {
        return res.status(200).json({ ok: true });
    }

    if (!name || !email || !message) {
        return res.status(400).json({ error: 'Please fill in your name, email and message.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (String(message).length > 5000) {
        return res.status(400).json({ error: 'Message is too long.' });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.CONTACT_TO_EMAIL;
    const from = process.env.CONTACT_FROM_EMAIL || 'onboarding@resend.dev';
    if (!apiKey || !to) {
        return res.status(500).json({ error: 'Contact form is not configured yet.' });
    }

    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    try {
        const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: `DGS Website <${from}>`,
                to: [to],
                reply_to: email,
                subject: `New enquiry from ${name} — DGS website`,
                html: emailShell({
                    title: 'New website enquiry',
                    subtitle: 'Someone just sent a message through the contact form.',
                    body: `
                        <table style="width:100%;border-collapse:collapse;font-size:14px">
                            <tr><td style="padding:8px 0;color:#999;width:90px">Name</td><td style="padding:8px 0;color:#111;font-weight:bold">${esc(name)}</td></tr>
                            <tr><td style="padding:8px 0;color:#999;border-top:1px solid #eee">Email</td><td style="padding:8px 0;border-top:1px solid #eee"><a href="mailto:${esc(email)}" style="color:#4d8a2f">${esc(email)}</a></td></tr>
                            <tr><td style="padding:8px 0;color:#999;border-top:1px solid #eee">Phone</td><td style="padding:8px 0;color:#111;border-top:1px solid #eee">${esc(phone || '—')}</td></tr>
                        </table>
                        <div style="background:#f4f9f1;border-left:3px solid #6CBE45;border-radius:6px;padding:14px 16px;margin-top:16px;font-size:14px;color:#333">
                            ${esc(message).replace(/\n/g, '<br>')}
                        </div>
                        <p style="font-size:12px;color:#999;margin-top:14px">Tip: just hit Reply — it goes straight to the customer.</p>`,
                }),
            }),
        });

        if (r.ok) {
            // CRM: also store the lead in Brevo (non-blocking, optional)
            const brevoKey = process.env.BREVO_API_KEY;
            const leadsList = parseInt(process.env.BREVO_LEADS_LIST_ID, 10);
            if (brevoKey && leadsList) {
                fetch('https://api.brevo.com/v3/contacts', {
                    method: 'POST',
                    headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email,
                        listIds: [leadsList],
                        updateEnabled: true,
                        attributes: { FIRSTNAME: String(name).slice(0, 100) },
                    }),
                }).catch((e) => console.error('Lead save failed:', e));
            }
            return res.status(200).json({ ok: true });
        }
        const data = await r.json().catch(() => ({}));
        console.error('Resend error:', r.status, data);
        return res.status(502).json({ error: 'Could not send your message right now. Please call us instead.' });
    } catch (err) {
        console.error('Resend request failed:', err);
        return res.status(502).json({ error: 'Could not send your message right now. Please call us instead.' });
    }
}
