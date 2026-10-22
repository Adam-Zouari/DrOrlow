'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { hashPassword, verifyPassword } = require('./password');

const cookieName = 'super_orlow_session';
const token = () => randomBytes(32).toString('base64url');
const digest = (value) => createHash('sha256').update(value).digest('hex');

function readSessionId(req) {
  const cookies = (req.get('Cookie') || '').split(';').map((part) => part.trim());
  const matches = cookies.filter((cookie) => cookie.startsWith(`${cookieName}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function createSuperAuth({ password, now = Date.now, ttlMs = 12 * 60 * 60 * 1000, maxSessions = 1000, siteOrigin } = {}) {
  const sessions = new Map();
  const passwordHash = password ? hashPassword(password) : null;
  const options = (req) => ({
    httpOnly: true, sameSite: 'strict', path: '/api/super',
    secure: req.secure || Boolean(siteOrigin && siteOrigin.startsWith('https://'))
  });
  const current = (req) => {
    const id = readSessionId(req);
    if (!id) return null;
    const key = digest(id);
    const session = sessions.get(key);
    if (session && session.expiresAt <= now()) {
      sessions.delete(key);
      return null;
    }
    return session ? { ...session, key } : null;
  };
  return {
    configured: Boolean(passwordHash),
    current,
    async login(req, res, candidate) {
      if (!passwordHash || !await verifyPassword(candidate, await passwordHash)) return null;
      // Expired sessions never accumulate, and session storage has a fixed bound.
      for (const [key, session] of sessions) {
        if (session.expiresAt <= now()) sessions.delete(key);
      }
      const previous = readSessionId(req);
      if (previous) sessions.delete(digest(previous));
      if (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value);
      const id = token();
      const session = { csrfToken: token(), expiresAt: now() + ttlMs };
      sessions.set(digest(id), session);
      res.cookie(cookieName, id, { ...options(req), maxAge: ttlMs });
      return session;
    },
    logout(req, res, session) {
      sessions.delete(session.key);
      res.clearCookie(cookieName, options(req));
    },
    validCsrf(session, candidate) {
      if (typeof candidate !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(candidate)) return false;
      return timingSafeEqual(Buffer.from(candidate), Buffer.from(session.csrfToken));
    }
  };
}

module.exports = { createSuperAuth };
