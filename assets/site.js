// Mobile menu toggle
const menuBtn = document.querySelector('.menu-btn');
const navLinks = document.querySelector('.nav-links');
if (menuBtn && navLinks) {
    menuBtn.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.querySelectorAll('a').forEach((a) =>
        a.addEventListener('click', () => navLinks.classList.remove('open')));
}

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

        // Google Analytics 4
        if (/^G-[A-Z0-9]{4,14}$/.test(s.ga4Id || '')) {
            const gs = document.createElement('script');
            gs.async = true;
            gs.src = `https://www.googletagmanager.com/gtag/js?id=${s.ga4Id}`;
            document.head.appendChild(gs);
            window.dataLayer = window.dataLayer || [];
            function gtag() { window.dataLayer.push(arguments); }
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', s.ga4Id);
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
        const payload = JSON.stringify({ p: location.pathname, r: document.referrer || '' });
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
