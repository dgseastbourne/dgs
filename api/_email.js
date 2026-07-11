// Shared branded email template — used by every email the site sends
const PHONE = '01323 724241';
const WHATSAPP = '447305255963';

export function siteUrl() {
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || 'dgs-lime.vercel.app';
    return `https://${host}`;
}

// Wraps any content in the DGS branded shell: logo header, useful links, footer
export function emailShell({ title, subtitle = '', body, footerNote = '' }) {
    const base = siteUrl();
    const link = (href, label) =>
        `<a href="${href}" style="color:#4d8a2f;text-decoration:none;font-weight:bold;font-size:13px">${label}</a>`;

    return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px 12px;background:#f2f4f1">
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333">

    <div style="background:#0c0e0c;padding:22px 24px;border-radius:12px 12px 0 0">
        <img src="${base}/assets/email-logo.png" alt="Darrens Garage Services" width="260" style="display:block;max-width:260px;height:auto">
    </div>

    <div style="border:1px solid #e2e5e1;border-top:none;background:#ffffff;padding:28px 24px;border-radius:0 0 12px 12px">
        <h2 style="margin:0 0 4px;color:#0c0e0c;font-size:20px">${title}</h2>
        ${subtitle ? `<p style="margin:0 0 20px;color:#777;font-size:13px">${subtitle}</p>` : '<div style="height:14px"></div>'}

        ${body}

        <table style="width:100%;border-collapse:collapse;margin-top:28px;border-top:1px solid #eee">
            <tr><td style="padding:16px 0 6px;text-align:center">
                ${link(base, 'Website')} &nbsp;&bull;&nbsp;
                ${link(base + '/#services', 'Services')} &nbsp;&bull;&nbsp;
                ${link(base + '/faq', 'FAQ')} &nbsp;&bull;&nbsp;
                ${link('tel:' + PHONE.replace(/\s/g, ''), 'Call ' + PHONE)} &nbsp;&bull;&nbsp;
                ${link('https://wa.me/' + WHATSAPP, 'WhatsApp')}
            </td></tr>
            <tr><td style="text-align:center;padding-top:10px;color:#999;font-size:12px">
                Darrens Garage Services &mdash; Unit 1, 64 Belmore Road, Eastbourne BN22 8BP<br>
                ${footerNote ? footerNote + '<br>' : ''}
                <a href="https://www.facebook.com/DarrensGarageServices/" style="color:#999">Facebook</a>
                &nbsp;&bull;&nbsp; website by <a href="https://digital-ev.co.uk/" style="color:#6d5cf6;font-weight:bold;text-decoration:none">Digital EV</a>
            </td></tr>
        </table>
    </div>

</div>
</body>
</html>`;
}

// A bulletproof button that renders in all major email clients
export function emailButton(href, label) {
    return `
        <table style="border-collapse:collapse;margin:18px auto"><tr>
            <td style="background:#6CBE45;border-radius:8px">
                <a href="${href}" style="display:inline-block;padding:13px 30px;color:#0c0e0c;font-weight:bold;font-size:15px;text-decoration:none;font-family:Arial,Helvetica,sans-serif">${label}</a>
            </td>
        </tr></table>`;
}
