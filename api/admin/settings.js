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
        if ('siteUrl' in body && String(body.siteUrl || '').trim()) {
            const v = String(body.siteUrl).trim().replace(/\/+$/, '');
            if (!/^https:\/\/[a-z0-9][a-z0-9.-]+[a-z0-9]$/i.test(v)) {
                return res.status(400).json({ error: 'Site address must look like https://www.example.co.uk (https only, no trailing slash).' });
            }
            updates.siteUrl = v;
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
            const oldSiteUrl = settings.siteUrl || 'https://dgs-lime.vercel.app';
            Object.assign(settings, updates);

            // Domain change: rewrite canonical/OG/schema/sitemap across the site in ONE commit
            if (updates.siteUrl && updates.siteUrl !== oldSiteUrl) {
                await rewriteSiteUrl(token, oldSiteUrl, updates.siteUrl, settings);
                return res.status(200).json({
                    ok: true, settings,
                    message: 'Saved — the new address is being applied across the whole site (live in about a minute).',
                });
            }

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

// Replaces the site base URL in every page + sitemap + robots + settings, as one git commit
async function rewriteSiteUrl(token, oldUrl, newUrl, newSettings) {
    const gh = (path, opts = {}) =>
        fetch(`https://api.github.com/repos/${REPO}${path}`, {
            ...opts,
            headers: { ...ghHeaders(token), 'Content-Type': 'application/json', ...(opts.headers || {}) },
        });

    const ref = await (await gh('/git/ref/heads/master')).json();
    const headSha = ref.object.sha;
    const commit = await (await gh(`/git/commits/${headSha}`)).json();

    const tree = await (await gh(`/git/trees/${headSha}?recursive=1`)).json();
    const targets = tree.tree.filter((t) =>
        t.type === 'blob' && (
            /^[^/]+\.html$/.test(t.path) ||
            /^services\/[^/]+\.html$/.test(t.path) ||
            t.path === 'sitemap.xml' || t.path === 'robots.txt'
        ));

    const newTreeItems = [];
    for (const t of targets) {
        const file = await (await gh(`/contents/${t.path}`)).json();
        const text = Buffer.from(file.content, 'base64').toString();
        if (!text.includes(oldUrl)) continue;
        newTreeItems.push({
            path: t.path, mode: '100644', type: 'blob',
            content: text.split(oldUrl).join(newUrl),
        });
    }
    newTreeItems.push({
        path: 'settings.json', mode: '100644', type: 'blob',
        content: JSON.stringify(newSettings, null, 2) + '\n',
    });

    const newTree = await (await gh('/git/trees', {
        method: 'POST',
        body: JSON.stringify({ base_tree: commit.tree.sha, tree: newTreeItems }),
    })).json();
    if (!newTree.sha) throw new Error('tree creation failed');

    const newCommit = await (await gh('/git/commits', {
        method: 'POST',
        body: JSON.stringify({
            message: `Admin: change site address ${oldUrl} -> ${newUrl}`,
            tree: newTree.sha,
            parents: [headSha],
            committer: { name: 'DGS Admin', email: 'admin@users.noreply.github.com' },
        }),
    })).json();
    if (!newCommit.sha) throw new Error('commit creation failed');

    const upd = await gh('/git/refs/heads/master', {
        method: 'PATCH',
        body: JSON.stringify({ sha: newCommit.sha }),
    });
    if (!upd.ok) throw new Error('ref update failed');
}
