// Mobile menu toggle
const menuBtn = document.querySelector('.menu-btn');
const navLinks = document.querySelector('.nav-links');
if (menuBtn && navLinks) {
    menuBtn.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.querySelectorAll('a').forEach((a) =>
        a.addEventListener('click', () => navLinks.classList.remove('open')));
}

// ---------- Cookie consent (UK GDPR / PECR) ----------
// 'granted' | 'denied' | null (no choice yet). Storing the choice itself is
// strictly necessary and exempt from consent requirements.
const CONSENT_KEY = 'dgs_consent';
const getConsent = () => {
    try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
};
const consentListeners = [];
const onConsentGranted = (fn) => {
    if (getConsent() === 'granted') fn();
    else consentListeners.push(fn);
};
const setConsent = (value) => {
    try { localStorage.setItem(CONSENT_KEY, value); } catch {}
    document.querySelector('.cookie-banner')?.remove();
    if (value === 'granted') consentListeners.splice(0).forEach((fn) => fn());
};

const showBanner = () => {
    if (document.querySelector('.cookie-banner')) return;
    const b = document.createElement('div');
    b.className = 'cookie-banner';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Cookie consent');
    b.innerHTML = `
        <p>We'd like to use optional analytics cookies to understand how the site is used —
        we won't set any unless you accept. Our basic visit statistics are cookie-free.
        <a href="/privacy">Privacy &amp; cookies</a></p>
        <div class="cookie-actions">
            <button type="button" class="btn cb-accept">Accept</button>
            <button type="button" class="btn btn-outline cb-reject">Reject</button>
        </div>`;
    b.querySelector('.cb-accept').addEventListener('click', () => setConsent('granted'));
    b.querySelector('.cb-reject').addEventListener('click', () => setConsent('denied'));
    document.body.appendChild(b);
};

if (!getConsent()) showBanner();

// "Cookie settings" link in the footer (lets visitors change their mind)
const footerLinks = document.querySelector('.footer-links');
if (footerLinks) {
    const cs = document.createElement('a');
    cs.href = '#';
    cs.textContent = 'Cookie settings';
    cs.addEventListener('click', (e) => { e.preventDefault(); showBanner(); });
    footerLinks.appendChild(cs);
}

// ---------- Click-to-load Google Maps (no Google cookies until then) ----------
const loadMap = (ph) => {
    const f = document.createElement('iframe');
    f.width = '600';
    f.height = '380';
    f.src = ph.dataset.mapSrc;
    f.loading = 'lazy';
    f.referrerPolicy = 'no-referrer-when-downgrade';
    f.title = ph.dataset.mapTitle || 'Map — Darrens Garage Services, Eastbourne';
    ph.replaceWith(f);
};
document.querySelectorAll('.map-consent').forEach((ph) => {
    ph.querySelector('.map-load-btn')?.addEventListener('click', () => loadMap(ph));
    onConsentGranted(() => { if (ph.isConnected) loadMap(ph); });
});

// Site settings (settings.json): WhatsApp number + trackers
const prefix = document.querySelector('link[href*="assets/style.css"]')
    .getAttribute('href').startsWith('../') ? '../' : '';

fetch(prefix + 'settings.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
        if (!s) return;

        // WhatsApp links (number + pre-filled message)
        if (/^\d{8,15}$/.test(s.whatsapp || '')) {
            const text = encodeURIComponent(s.waMessage || "Hi! I'd like to book my car in.");
            document.querySelectorAll('.wa-link').forEach((a) => {
                a.href = `https://wa.me/${s.whatsapp}?text=${text}`;
            });
        }

        // Social links
        if (s.facebook) document.querySelectorAll('.soc-fb').forEach((a) => { a.href = s.facebook; });
        if (s.google) document.querySelectorAll('.soc-g').forEach((a) => { a.href = s.google; });

        // Google Analytics 4 — only ever loaded AFTER the visitor accepts
        // analytics cookies (Google Consent Mode v2, default denied).
        if (/^G-[A-Z0-9]{4,14}$/.test(s.ga4Id || '')) {
            onConsentGranted(() => {
                window.dataLayer = window.dataLayer || [];
                function gtag() { window.dataLayer.push(arguments); }
                window.gtag = gtag;
                gtag('consent', 'default', {
                    ad_storage: 'denied',
                    ad_user_data: 'denied',
                    ad_personalization: 'denied',
                    analytics_storage: 'denied',
                });
                gtag('consent', 'update', { analytics_storage: 'granted' });
                const gs = document.createElement('script');
                gs.async = true;
                gs.src = `https://www.googletagmanager.com/gtag/js?id=${s.ga4Id}`;
                document.head.appendChild(gs);
                gtag('js', new Date());
                gtag('config', s.ga4Id);
            });
        }

        // Verification meta tags (best effort — DNS/GA methods are more reliable)
        const addMeta = (name, content) => {
            if (!content || document.querySelector(`meta[name="${name}"]`)) return;
            const m = document.createElement('meta');
            m.name = name;
            m.content = content;
            document.head.appendChild(m);
        };
        addMeta('google-site-verification', s.gscToken);
        addMeta('msvalidate.01', s.bingToken);
    })
    .catch(() => {});

// Anonymous page-view beacon (no cookies, no personal data)
try {
    if (location.protocol.startsWith('http')) {
        const q = new URLSearchParams(location.search);
        const payload = JSON.stringify({
            p: location.pathname,
            r: document.referrer || '',
            us: q.get('utm_source') || '',
            uc: q.get('utm_campaign') || '',
        });
        if (!(navigator.sendBeacon &&
              navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' })))) {
            fetch('/api/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true,
            }).catch(() => {});
        }
    }
} catch {}

// Animated stat counters
const counters = document.querySelectorAll('.stat .num[data-count]');
if (counters.length && 'IntersectionObserver' in window &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
            if (!en.isIntersecting) return;
            const el = en.target;
            io.unobserve(el);
            const target = +el.dataset.count;
            const suffix = el.dataset.suffix || '';
            const t0 = performance.now();
            const dur = 1500;
            const step = (t) => {
                const p = Math.min((t - t0) / dur, 1);
                const eased = 1 - Math.pow(1 - p, 3); // ease-out
                el.textContent = Math.round(target * eased) + suffix;
                if (p < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    }, { threshold: 0.5 });
    counters.forEach((el) => {
        el.textContent = '0' + (el.dataset.suffix || '');
        io.observe(el);
    });
}
