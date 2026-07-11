// GET  /api/admin/changelog — current changelog + roadmap (session required)
// POST /api/admin/changelog — replace changelog.json; commits to GitHub (auto-redeploy)
import { getSession } from '../_auth.js';

const REPO = process.env.GITHUB_REPO || 'dgseastbourne/dgs';
const API = `https://api.github.com/repos/${REPO}/contents/changelog.json`;

const ghHeaders = (token) => ({
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dgs-admin',
});

function validate(data) {
    if (!data || typeof data !== 'object') return 'Invalid data';
    if (!Array.isArray(data.changelog) || !Array.isArray(data.roadmap)) return 'Invalid structure';
    if (data.changelog.length > 500 || data.roadmap.length > 200) return 'Too many entries';
    for (const e of data.changelog) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) return 'Invalid date in changelog';
        if (!Array.isArray(e.items) || e.items.some((i) => typeof i !== 'string' || i.length > 500)) return 'Invalid changelog items';
    }
    for (const t of data.roadmap) {
        if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 300) return 'Invalid task title';
        if (!['planned', 'in-progress', 'done'].includes(t.status)) return 'Invalid task status';
    }
    return null;
}

export default async function handler(req, res) {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });

    const token = process.env.GITHUB_TOKEN;
    if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN is not configured in Vercel yet.' });

    try {
        const cur = await fetch(API, { headers: ghHeaders(token) });
        if (!cur.ok) throw new Error(`GitHub read ${cur.status}`);
        const file = await cur.json();
        const data = JSON.parse(Buffer.from(file.content, 'base64').toString());

        if (req.method === 'GET') {
            return res.status(200).json({ data });
        }

        if (req.method === 'POST') {
            const next = req.body || {};
            const err = validate(next);
            if (err) return res.status(400).json({ error: err });

            const put = await fetch(API, {
                method: 'PUT',
                headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'Admin: update changelog / roadmap',
                    content: Buffer.from(JSON.stringify({ changelog: next.changelog, roadmap: next.roadmap }, null, 2) + '\n').toString('base64'),
                    sha: file.sha,
                    committer: { name: 'DGS Admin', email: 'admin@users.noreply.github.com' },
                }),
            });
            if (!put.ok) {
                console.error('GitHub write failed:', put.status, await put.text());
                throw new Error('write failed');
            }
            return res.status(200).json({ ok: true, message: 'Saved.' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('Changelog error:', err);
        return res.status(502).json({ error: 'Could not access the changelog. Check the GitHub token.' });
    }
}
