// POST /api/contact — sends the contact form message via Resend
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
                html: `
                    <h2>New website enquiry</h2>
                    <p><strong>Name:</strong> ${esc(name)}</p>
                    <p><strong>Email:</strong> ${esc(email)}</p>
                    <p><strong>Phone:</strong> ${esc(phone || '—')}</p>
                    <p><strong>Message:</strong></p>
                    <p>${esc(message).replace(/\n/g, '<br>')}</p>
                `,
            }),
        });

        if (r.ok) {
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
