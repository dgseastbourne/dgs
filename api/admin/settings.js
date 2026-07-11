// GET  /api/admin/settings — current settings (session required)
// POST /api/admin/settings — update settings; commits settings.json to GitHub,
//                            which triggers an automatic Vercel redeploy (~1 min)
import { getSession } from '../_auth.js';

const REPO = process.env.GITHUB_REPO || 'dgseastbourne/dgs';
const API = `https://api.github.com/repos/${REPO}/contents/settings.json`;

const ghHeaders = (token) => ({
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dgs-admin',
});

export default async function handler(req, res) {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });

    const token = process.env.GITHUB_TOKEN;
    if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN is not configured in Vercel yet.' });

    if (req.method === 'GET') {
        try {
            const r = await fetch(API, { headers: ghHeaders(token) });
            if (!r.ok) throw new Error(`GitHub ${r.status}`);
            const file = await r.json();
            const settings = JSON.parse(Buffer.from(file.content, 'base64').toString());
            return res.status(200).json({ settings });
        } catch (err) {
            console.error('Settings read failed:', err);
            return res.status(502).json({ error: 'Could not read settings.' });
        }
    }

    if (req.method === 'POST') {
        const body = req.body || {};

        const updates = {};
        if ('whatsapp' in body) {
            const clean = String(body.whatsapp || '').replace(/[\s+\-()]/g, '');
            if (!/^\d{8,15}$/.test(clean)) {
                return res.status(400).json({ error: 'Enter the WhatsApp number in international format, e.g. 447815981647.' });
            }
            updates.whatsapp = clean;
        }
        if ('ga4Id' in body) {
            const v = String(body.ga4Id || '').trim();
            if (v && !/^G-[A-Z0-9]{4,14}$/i.test(v)) {
                return res.status(400).json({ error: 'The Google Analytics ID looks wrong — it should be like G-XXXXXXXXXX.' });
            }
            updates.ga4Id = v.toUpperCase();
        }
        for (const key of ['gscToken', 'bingToken']) {
            if (key in body) {
                const v = String(body[key] || '').trim();
                if (v && !/^[A-Za-z0-9_-]{8,100}$/.test(v)) {
                    return res.status(400).json({ error: `The ${key === 'gscToken' ? 'Google Search Console' : 'Bing'} token contains invalid characters — paste only the content value of the meta tag.` });
                }
                updates[key] = v;
            }
        }
        if (!Object.keys(updates).length) {
            return res.status(400).json({ error: 'Nothing to save.' });
        }

        try {
            // current SHA is required to update the file
            const cur = await fetch(API, { headers: ghHeaders(token) });
            if (!cur.ok) throw new Error(`GitHub read ${cur.status}`);
            const { sha, content } = await cur.json();
            const settings = JSON.parse(Buffer.from(content, 'base64').toString());
            Object.assign(settings, updates);

            const put = await fetch(API, {
                method: 'PUT',
                headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: `Admin: update site settings (${Object.keys(updates).join(', ')})`,
                    content: Buffer.from(JSON.stringify(settings, null, 2) + '\n').toString('base64'),
                    sha,
                    committer: { name: 'DGS Admin', email: 'admin@users.noreply.github.com' },
                }),
            });
            if (!put.ok) {
                console.error('GitHub write failed:', put.status, await put.text());
                throw new Error('write failed');
            }
            return res.status(200).json({
                ok: true,
                settings,
                message: 'Saved — the site updates automatically in about a minute.',
            });
        } catch (err) {
            console.error('Settings update failed:', err);
            return res.status(502).json({ error: 'Could not save settings. Check the GitHub token in Vercel.' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
