// GET /api/admin/verify?token=... — validates the magic link and starts a session
import { sign, verify } from '../_auth.js';

export default function handler(req, res) {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return res.status(500).send('Not configured');

    const payload = verify(req.query.token, secret);
    if (!payload || payload.kind !== 'login') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(401).send('<p style="font-family:sans-serif">This sign-in link is invalid or has expired. <a href="/admin/">Request a new one</a>.</p>');
    }

    const session = sign({ kind: 'session', email: payload.email }, secret, 7 * 24 * 3600); // 7 days
    res.setHeader('Set-Cookie',
        `dgs_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`);
    res.writeHead(302, { Location: '/admin/' });
    res.end();
}
