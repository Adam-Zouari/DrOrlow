'use strict';

const path = require('node:path');
const express = require('express');
const { loadConfig } = require('./config');
const { validateSubmission } = require('./validation');
const { createSuperAuth } = require('./super-auth');

const securityPolicy = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'",
  "img-src 'self'", "font-src 'self'", "connect-src 'self'",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function sendError(req, res, status, message, errors) {
  res.set('Cache-Control', 'no-store');
  if (/^\/api(?:\/|$)/i.test(req.originalUrl) || req.is('application/json') || req.accepts(['html', 'json']) === 'json') {
    return res.status(status).json({ message, ...(errors ? { errors } : {}) });
  }
  const details = errors
    ? `<ul>${Object.values(errors).map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`
    : '';
  return res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dr Orlow — Please try again</title><link rel="stylesheet" href="/assets/css/common.css"></head>
<body><main><h1>${escapeHtml(message)}</h1>${details}
<p><a href="/join%20me.html">Return to the form</a> or <a href="/Home.html">go home</a>.</p>
</main></body></html>`);
}

function createSubmissionLimiter({ now, max = 10, windowMs = 15 * 60 * 1000, message = 'Too many form submissions. Please try again later.' }) {
  const clients = new Map();
  return (req, res, next) => {
    const time = now();
    // A fixed maximum also bounds memory when requests arrive from many IPs.
    if (clients.size >= 10000) {
      for (const [key, value] of clients) {
        if (value.resetAt <= time) clients.delete(key);
      }
    }
    const key = req.ip;
    let client = clients.get(key);
    if (!client || client.resetAt <= time) {
      if (!client && clients.size >= 10000) {
        res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
        return sendError(req, res, 429, message);
      }
      client = { count: 0, resetAt: time + windowMs };
      clients.set(key, client);
    }
    client.count += 1;
    if (client.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((client.resetAt - time) / 1000))));
      return sendError(req, res, 429, message);
    }
    next();
  };
}

function createApp({
  repository = null,
  adminRepository = null,
  now = Date.now,
  logger = console,
  config = loadConfig(),
  rateLimit = {},
  loginRateLimit = {},
  authOptions = {}
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxyHops) app.set('trust proxy', config.trustProxyHops);
  const auth = createSuperAuth({ ...authOptions, password: config.superPassword, now, siteOrigin: config.siteOrigin });
  const sameOrigin = (req, res, next) => {
    const origin = req.get('Origin');
    const expectedOrigin = config.siteOrigin || `${req.protocol}://${req.get('host')}`;
    if (req.get('Sec-Fetch-Site') === 'cross-site' || (origin && origin !== expectedOrigin)) {
      return sendError(req, res, 403, 'Please use this website to send your request.');
    }
    next();
  };
  const requireSession = (req, res, next) => {
    const session = auth.current(req);
    if (!session) return sendError(req, res, 401, 'Please unlock Super Orlow to continue.');
    res.locals.session = session;
    next();
  };

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': securityPolicy,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', submissions: repository ? 'configured' : 'unavailable' });
  });

  app.post('/submit', sameOrigin, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.is('application/json') && !req.is('application/x-www-form-urlencoded')) {
      return sendError(req, res, 415, 'Please submit the form using a supported format.');
    }
    next();
  }, createSubmissionLimiter({ now, ...rateLimit }),
  express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 40 }),
  express.json({ limit: '64kb', strict: true }), async (req, res) => {
    const { value, errors } = validateSubmission(req.body, new Date(now()));
    if (Object.keys(errors).length) {
      return sendError(req, res, 422, 'Please check your form details.', errors);
    }
    if (!repository) {
      return sendError(req, res, 503, 'The form is currently unavailable. Please try again later.');
    }

    try {
      await repository.createSubmission(value);
      if (req.is('application/json') || req.accepts(['html', 'json']) === 'json') {
        return res.status(201).json({
          message: 'Your form has been sent to Dr Orlow. Thank you, friend!',
          redirect: '/Home.html?submitted=1'
        });
      }
      return res.redirect(303, '/Home.html?submitted=1');
    } catch (error) {
      // Error codes help the operator diagnose outages without logging personal data.
      logger.error('Form submission failed:', error.code || error.name || 'Unknown error');
      return sendError(req, res, 503, 'The form is currently unavailable. Please try again later.');
    }
  });

  app.use('/api/super', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    next();
  }, sameOrigin);

  app.get('/api/super/session', (req, res) => {
    const session = auth.current(req);
    res.json(session ? { authenticated: true, csrfToken: session.csrfToken } : { authenticated: false });
  });
  app.post('/api/super/login', createSubmissionLimiter({
    now, ...loginRateLimit, message: 'Too many unlock attempts. Please try again later.'
  }), (req, res, next) => {
    if (!req.is('application/json')) return sendError(req, res, 415, 'Please send a JSON request.');
    next();
  }, express.json({ limit: '2kb', strict: true }), async (req, res) => {
    if (!auth.configured) return sendError(req, res, 503, 'Super Orlow is currently unavailable.');
    const password = req.body && req.body.password;
    if (typeof password !== 'string' || !password || password.length > 256) {
      return sendError(req, res, 400, 'Please enter the Super Orlow password.');
    }
    const session = await auth.login(req, res, password);
    if (!session) return sendError(req, res, 401, 'The password was not recognized.');
    res.status(201).json({ authenticated: true, csrfToken: session.csrfToken });
  });
  app.post('/api/super/logout', requireSession, (req, res) => {
    if (!auth.validCsrf(res.locals.session, req.get('X-CSRF-Token'))) {
      return sendError(req, res, 403, 'Please refresh Super Orlow and try again.');
    }
    auth.logout(req, res, res.locals.session);
    res.json({ authenticated: false });
  });
  app.get('/api/super/forms', requireSession, async (req, res) => {
    const parsePage = (input, fallback, max) => {
      if (input === undefined) return fallback;
      if (typeof input !== 'string' || !/^[1-9]\d*$/.test(input) || Number(input) > max) return null;
      return Number(input);
    };
    const page = parsePage(req.query.page, 1, 1000000);
    const pageSize = parsePage(req.query.pageSize, 20, 100);
    if (!page || !pageSize) return sendError(req, res, 400, 'Please request a valid page and a page size between 1 and 100.');
    if (!adminRepository) return sendError(req, res, 503, 'The private inbox is currently unavailable.');
    try {
      const result = await adminRepository.listSubmissions({ page, pageSize });
      res.json({ forms: result.forms, total: result.total, page, pageSize });
    } catch (error) {
      logger.error('Private inbox failed:', error.code || error.name || 'Unknown error');
      return sendError(req, res, 503, 'The private inbox is currently unavailable.');
    }
  });
  app.use('/api/super', (req, res) => sendError(req, res, 404, 'This private-area endpoint could not be found.'));

  app.get('/super-orlow', (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    res.sendFile(path.resolve(__dirname, '../public/Super Orlow.html'));
  });

  app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, '../public/Home.html')));
  app.use(express.static(path.resolve(__dirname, '../public'), {
    dotfiles: 'deny', index: false, maxAge: '1h',
    setHeaders(res, filePath) {
      if (/\.(?:html|css|js)$/.test(filePath)) res.set('Cache-Control', 'no-cache');
    }
  }));
  app.use((req, res) => sendError(req, res, 404, 'This page could not be found.'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large' || error.type === 'parameters.too.many') {
      return sendError(req, res, 413, 'The form is too large. Please shorten your answers.');
    }
    if (error.type === 'entity.parse.failed' || error instanceof URIError) {
      return sendError(req, res, 400, 'The request could not be read. Please try again.');
    }
    const status = error.status || error.statusCode;
    if (status === 415) {
      return sendError(req, res, 415, 'This request format is not supported. Please try again.');
    }
    // Body parsers also report invalid compression, charsets, and aborted reads.
    // Preserve their client status without exposing error messages or stack traces.
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return sendError(req, res, status, status === 404
        ? 'This page could not be found.'
        : 'The request could not be read. Please try again.');
    }
    logger.error('Request failed:', error.code || error.name || 'Unknown error');
    return sendError(req, res, 500, 'Something went wrong. Please try again later.');
  });
  return app;
}

module.exports = { createApp };
