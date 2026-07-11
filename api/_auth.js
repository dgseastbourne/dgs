// Shared auth helpers — signed tokens via HMAC (no dependencies)
import crypto from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function sign(payload, secret, ttlSeconds) {
    const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 }));
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
}

export function verify(token, secret) {
    if (!token || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    if (sig.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (payload.exp < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

export function getSession(req) {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return null;
    const cookies = Object.fromEntries(
        (req.headers.cookie || '').split(';').map((c) => {
            const i = c.indexOf('=');
            return [c.slice(0, i).trim(), c.slice(i + 1).trim()];
        }),
    );
    const payload = verify(cookies.dgs_session, secret);
    return payload && payload.kind === 'session' ? payload : null;
}
