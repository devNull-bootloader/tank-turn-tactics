const en = require('./en');
const de = require('./de');

const LOCALES = {
    en,
    de
};

const SUPPORTED = Object.keys(LOCALES);
const DEFAULT_LOCALE = 'en';

function resolveLocale(code) {
    if (!code) return DEFAULT_LOCALE;
    const normalized = String(code).toLowerCase().slice(0, 2);
    return SUPPORTED.includes(normalized) ? normalized : DEFAULT_LOCALE;
}

function lookup(dict, key) {
    return key.split('.').reduce((acc, part) => (acc && acc[part] != null ? acc[part] : null), dict);
}

function format(template, vars = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_, name) => (
        vars[name] != null ? String(vars[name]) : `{${name}}`
    ));
}

function t(locale, key, vars) {
    const lang = resolveLocale(locale);
    const primary = lookup(LOCALES[lang], key);
    const fallback = primary == null ? lookup(LOCALES[DEFAULT_LOCALE], key) : primary;
    if (fallback == null) return key;
    return format(fallback, vars);
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    String(header).split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        out[k] = decodeURIComponent(v);
    });
    return out;
}

function localeMiddleware(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const fromQuery = req.query && req.query.lang;
    const locale = resolveLocale(fromQuery || cookies.lang || req.acceptsLanguages(SUPPORTED) || DEFAULT_LOCALE);

    if (fromQuery && SUPPORTED.includes(resolveLocale(fromQuery))) {
        res.setHeader('Set-Cookie', `lang=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`);
    }

    req.locale = locale;
    res.locals.lang = locale;
    res.locals.t = (key, vars) => t(locale, key, vars);
    res.locals.i18nJson = JSON.stringify(LOCALES[locale]);
    next();
}

module.exports = {
    LOCALES,
    SUPPORTED,
    DEFAULT_LOCALE,
    resolveLocale,
    t,
    localeMiddleware
};
