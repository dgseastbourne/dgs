// GET /api/admin/subscribers — returns the Brevo newsletter list (session required)
// POST with {action:"logout"} clears the session cookie
import { getSession } from '../_auth.js';

export default async function handler(req, res) {
    if (req.method === 'POST' && (req.body || {}).action === 'logout') {
        res.setHeader('Set-Cookie', 'dgs_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
        return res.status(200).json({ ok: true });
    }

    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });

    const apiKey = process.env.BREVO_API_KEY;
    const listId = parseInt(process.env.BREVO_LIST_ID, 10);
    if (!apiKey || !listId) return res.status(500).json({ error: 'Brevo is not configured.' });

    try {
        const r = await fetch(
            `https://api.brevo.com/v3/contacts/lists/${listId}/contacts?limit=500&sort=desc`,
            { headers: { 'api-key': apiKey } },
        );
        if (!r.ok) {
            console.error('Brevo error:', r.status, await r.text());
            return res.status(502).json({ error: 'Could not load subscribers.' });
        }
        const data = await r.json();
        return res.status(200).json({
            total: data.count ?? (data.contacts || []).length,
            subscribers: (data.contacts || []).map((c) => ({
                email: c.email,
                addedAt: c.createdAt || c.addedAt || null,
                blacklisted: !!c.emailBlacklisted,
            })),
        });
    } catch (err) {
        console.error('Subscribers fetch failed:', err);
        return res.status(502).json({ error: 'Could not load subscribers.' });
    }
}
