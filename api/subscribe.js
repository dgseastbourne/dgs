// POST /api/subscribe — adds a contact to the Brevo newsletter list
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const apiKey = process.env.BREVO_API_KEY;
    const listId = parseInt(process.env.BREVO_LIST_ID, 10);
    if (!apiKey || !listId) {
        return res.status(500).json({ error: 'Newsletter is not configured yet.' });
    }

    try {
        const r = await fetch('https://api.brevo.com/v3/contacts', {
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email,
                listIds: [listId],
                updateEnabled: true, // re-subscribing an existing contact is fine
            }),
        });

        if (r.status === 201 || r.status === 204) {
            return res.status(200).json({ ok: true });
        }

        const data = await r.json().catch(() => ({}));
        // "duplicate_parameter" means the contact already exists — treat as success
        if (data.code === 'duplicate_parameter') {
            return res.status(200).json({ ok: true });
        }
        console.error('Brevo error:', r.status, data);
        return res.status(502).json({ error: 'Could not subscribe right now. Please try again later.' });
    } catch (err) {
        console.error('Brevo request failed:', err);
        return res.status(502).json({ error: 'Could not subscribe right now. Please try again later.' });
    }
}
