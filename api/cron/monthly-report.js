// Monthly site report — runs on Vercel Cron (1st of each month) or manually
// from the admin dashboard. Emails subscriber growth, enquiries, work done
// (from changelog.json) and upcoming work to the client.
import { getSession } from '../_auth.js';

const REPO = process.env.GITHUB_REPO || 'dgseastbourne/dgs';

async function ghFile(token, path) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dgs-report' },
    });
    if (!r.ok) return null;
    const f = await r.json();
    return JSON.parse(Buffer.from(f.content, 'base64').toString());
}

async function brevoList(apiKey, listId) {
    if (!apiKey || !listId) return null;
    const r = await fetch(
        `https://api.brevo.com/v3/contacts/lists/${listId}/contacts?limit=500&sort=desc`,
        { headers: { 'api-key': apiKey } },
    );
    if (!r.ok) return null;
    const data = await r.json();
    const contacts = data.contacts || [];
    const cutoff = Date.now() - 31 * 24 * 3600 * 1000;
    return {
        total: data.count ?? contacts.length,
        recent: contacts.filter((c) => new Date(c.createdAt || 0).getTime() > cutoff).length,
    };
}

export default async function handler(req, res) {
    // Allow: Vercel Cron (Authorization: Bearer CRON_SECRET) or a signed-in admin
    const auth = req.headers.authorization || '';
    const isCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
    const isAdmin = !!getSession(req);
    if (!isCron && !isAdmin) return res.status(401).json({ error: 'Not authorised' });

    const resendKey = process.env.RESEND_API_KEY;
    const to = process.env.REPORT_TO_EMAIL || process.env.CONTACT_TO_EMAIL;
    const from = process.env.CONTACT_FROM_EMAIL || 'onboarding@resend.dev';
    const ghToken = process.env.GITHUB_TOKEN;
    if (!resendKey || !to) return res.status(500).json({ error: 'Report email is not configured.' });

    try {
        const [subs, leads, changelog, settings] = await Promise.all([
            brevoList(process.env.BREVO_API_KEY, parseInt(process.env.BREVO_LIST_ID, 10)),
            brevoList(process.env.BREVO_API_KEY, parseInt(process.env.BREVO_LEADS_LIST_ID, 10)),
            ghToken ? ghFile(ghToken, 'changelog.json') : null,
            ghToken ? ghFile(ghToken, 'settings.json') : null,
        ]);

        const siteUrl = (settings && settings.siteUrl) || 'https://dgs-lime.vercel.app';
        const monthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        const cutoff = Date.now() - 31 * 24 * 3600 * 1000;

        const doneRecent = (changelog?.changelog || [])
            .filter((e) => new Date(e.date).getTime() > cutoff)
            .flatMap((e) => e.items);
        const upcoming = (changelog?.roadmap || []).filter((t) => t.status !== 'done');

        const li = (arr) => arr.map((x) => `<li style="margin-bottom:6px">${x}</li>`).join('') || '<li>—</li>';
        const statLabel = { 'planned': 'Planned', 'in-progress': 'In progress' };

        const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333">
            <div style="background:#0c0e0c;padding:24px;border-radius:12px 12px 0 0">
                <span style="color:#e8ece7;font-size:20px;font-weight:bold"><span style="color:#6CBE45">D</span>arrens <span style="color:#6CBE45">G</span>arage <span style="color:#6CBE45">S</span>ervices</span>
                <div style="color:#9aa39a;font-size:13px;margin-top:4px">Website report — ${monthName}</div>
            </div>
            <div style="border:1px solid #e5e5e5;border-top:none;padding:24px;border-radius:0 0 12px 12px">
                <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
                    <tr>
                        <td style="text-align:center;padding:14px;background:#f4f9f1;border-radius:10px">
                            <div style="font-size:28px;font-weight:bold;color:#4d8a2f">${subs ? subs.total : '—'}</div>
                            <div style="font-size:12px;color:#666">Newsletter subscribers<br>(${subs ? '+' + subs.recent : '—'} this month)</div>
                        </td>
                        <td style="width:12px"></td>
                        <td style="text-align:center;padding:14px;background:#f4f9f1;border-radius:10px">
                            <div style="font-size:28px;font-weight:bold;color:#4d8a2f">${leads ? leads.recent : '—'}</div>
                            <div style="font-size:12px;color:#666">Website enquiries<br>this month</div>
                        </td>
                    </tr>
                </table>

                <h3 style="color:#0c0e0c;border-bottom:2px solid #6CBE45;padding-bottom:6px">Work completed this month</h3>
                <ul style="padding-left:20px;font-size:14px;line-height:1.5">${li(doneRecent)}</ul>

                <h3 style="color:#0c0e0c;border-bottom:2px solid #6CBE45;padding-bottom:6px">Coming next</h3>
                <ul style="padding-left:20px;font-size:14px;line-height:1.5">
                    ${li(upcoming.map((t) => `${t.title} <span style="color:#999;font-size:12px">(${statLabel[t.status] || t.status})</span>`))}
                </ul>

                <p style="font-size:13px;color:#666;margin-top:24px">
                    Website: <a href="${siteUrl}" style="color:#4d8a2f">${siteUrl.replace('https://', '')}</a>
                </p>
                <p style="font-size:12px;color:#999;border-top:1px solid #eee;padding-top:14px">
                    Prepared automatically by your website — maintained by
                    <a href="https://digital-ev.co.uk/" style="color:#6d5cf6;font-weight:bold">Digital EV</a>
                </p>
            </div>
        </div>`;

        const send = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: `DGS Website Report <${from}>`,
                to: [to],
                subject: `Your website report — ${monthName} | Darrens Garage Services`,
                html,
            }),
        });
        if (!send.ok) {
            console.error('Report send failed:', send.status, await send.text());
            return res.status(502).json({ error: 'Could not send the report email.' });
        }
        return res.status(200).json({ ok: true, message: `Report sent to ${to}.` });
    } catch (err) {
        console.error('Report failed:', err);
        return res.status(502).json({ error: 'Report generation failed.' });
    }
}
