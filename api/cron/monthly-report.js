// Monthly statistics report — runs on Vercel Cron (1st of each month) or
// manually from the admin dashboard. Emails site statistics: visits, top
// pages, traffic sources, campaigns, subscribers and enquiries.
import { getSession } from '../_auth.js';
import { redisConfig, redisPipeline } from '../_redis.js';
import { emailShell } from '../_email.js';

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

async function siteStats() {
    if (!redisConfig()) return null;
    const days = [];
    for (let i = 29; i >= 0; i--) {
        days.push(new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10));
    }
    const month = days[days.length - 1].slice(0, 7);
    const [views, pages, refs, camps] = await redisPipeline([
        ['MGET', ...days.map((d) => `v:${d}`)],
        ['HGETALL', `pm:${month}`],
        ['HGETALL', `rm:${month}`],
        ['HGETALL', `cm:${month}`],
    ]);
    const toPairs = (flat) => {
        const out = [];
        for (let i = 0; i < (flat || []).length; i += 2) {
            out.push({ key: flat[i], count: parseInt(flat[i + 1], 10) || 0 });
        }
        return out.sort((a, b) => b.count - a.count).slice(0, 5);
    };
    return {
        total30: (views || []).reduce((s, v) => s + (parseInt(v, 10) || 0), 0),
        topPages: toPairs(pages),
        topReferrers: toPairs(refs),
        topCampaigns: toPairs(camps),
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
    if (!resendKey || !to) return res.status(500).json({ error: 'Report email is not configured.' });

    try {
        const [subs, leads, stats] = await Promise.all([
            brevoList(process.env.BREVO_API_KEY, parseInt(process.env.BREVO_LIST_ID, 10)),
            brevoList(process.env.BREVO_API_KEY, parseInt(process.env.BREVO_LEADS_LIST_ID, 10)),
            siteStats(),
        ]);

        const monthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

        const card = (num, label) => `
            <td style="text-align:center;padding:14px;background:#f4f9f1;border-radius:10px">
                <div style="font-size:26px;font-weight:bold;color:#4d8a2f">${num}</div>
                <div style="font-size:12px;color:#666">${label}</div>
            </td>`;
        const table = (items, empty) => items && items.length
            ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${items.map((x) => `
                <tr><td style="padding:6px 0;border-bottom:1px solid #eee;color:#444">${x.key}</td>
                <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;color:#111;font-weight:bold">${x.count}</td></tr>`).join('')}</table>`
            : `<p style="font-size:13px;color:#999">${empty}</p>`;

        const html = emailShell({
            title: 'Website statistics',
            subtitle: monthName,
            body: `
                <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin-bottom:24px"><tr>
                    ${card(stats ? stats.total30 : '—', 'Page views<br>last 30 days')}
                    ${card(subs ? subs.total : '—', `Subscribers<br>(${subs ? '+' + subs.recent : '—'} this month)`)}
                    ${card(leads ? leads.recent : '—', 'Enquiries<br>this month')}
                </tr></table>

                <h3 style="color:#0c0e0c;border-bottom:2px solid #6CBE45;padding-bottom:6px">Top pages</h3>
                ${table(stats && stats.topPages, 'No page data yet.')}

                <h3 style="color:#0c0e0c;border-bottom:2px solid #6CBE45;padding-bottom:6px;margin-top:22px">Traffic sources</h3>
                ${table(stats && stats.topReferrers, 'No referrer data yet — most visits were direct.')}

                <h3 style="color:#0c0e0c;border-bottom:2px solid #6CBE45;padding-bottom:6px;margin-top:22px">Campaigns</h3>
                ${table(stats && stats.topCampaigns, 'No campaign visits this month.')}`,
            footerNote: 'Statistics are cookie-free and store no personal data. Report prepared automatically.',
        });

        const send = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: `DGS Website Report <${from}>`,
                to: [to],
                subject: `Website statistics — ${monthName} | Darrens Garage Services`,
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
