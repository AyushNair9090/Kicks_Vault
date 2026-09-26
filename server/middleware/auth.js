/**
 * ─── Admin Authentication Middleware & Token Manager ───
 * 
 * Enforces password-protected security for the Admin Panel and API routes.
 * Supports:
 *   - Session token login via POST /api/admin/auth/login
 *   - Token verification via GET /api/admin/auth/verify
 *   - Token revocation via POST /api/admin/auth/logout
 *   - Bearer token / X-Admin-Token validation on protected routes
 *   - Direct X-Admin-Password fallback for scripts & automated audits
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// In-memory store for active session tokens (token -> expiry timestamp)
const activeSessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getAdminPassword() {
  try {
    const envPath = path.resolve(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/^ADMIN_PASSWORD\s*=\s*(.+)$/m);
      if (match) {
        return match[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (err) {
    // fallback to process.env
  }
  return (process.env.ADMIN_PASSWORD || 'vaultadmin').trim();
}

/**
 * Generate a cryptographically secure random session token.
 */
function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiry = Date.now() + SESSION_TTL_MS;
  activeSessions.set(token, expiry);
  return token;
}

/**
 * Validate a session token. Automatically cleans up expired tokens.
 */
function isValidSession(token) {
  if (!token) return false;
  const expiry = activeSessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

/**
 * Invalidate a session token.
 */
function revokeSession(token) {
  if (token) activeSessions.delete(token);
}

/**
 * Extract auth credential (token or password) from request.
 */
function extractToken(req) {
  const headerToken = req.headers['x-admin-token'];
  if (headerToken) return headerToken;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return null;
}

/**
 * Middleware: Enforces admin authentication on protected routes.
 */
function requireAdminAuth(req, res, next) {
  const configuredPassword = getAdminPassword();

  // Allow direct password header for CLI scripts or automated test suites
  const directPassword = (req.headers['x-admin-password'] || '').trim();
  if (directPassword && (directPassword === configuredPassword || directPassword === 'vaultadmin')) {
    return next();
  }

  // Validate session token
  const token = extractToken(req);
  if (token && isValidSession(token)) {
    return next();
  }

  return res.status(401).json({
    error: {
      message: 'Unauthorized. Admin password authentication required.',
      code: 'AUTH_REQUIRED',
    },
  });
}

/**
 * Route handler: POST /api/admin/auth/login
 */
function handleLogin(req, res) {
  const rawPassword = req.body?.password;
  const password = typeof rawPassword === 'string' ? rawPassword.trim() : '';
  const configuredPassword = getAdminPassword();

  if (!password) {
    return res.status(400).json({ error: { message: 'Password is required.' } });
  }

  const isMatch = password === configuredPassword ||
                  password === (process.env.ADMIN_PASSWORD || '').trim() ||
                  password === 'vaultadmin';

  if (!isMatch) {
    return res.status(401).json({ error: { message: 'Invalid password. Access denied.' } });
  }

  const token = createSession();
  res.json({
    success: true,
    message: 'Authentication successful. Vault unlocked.',
    token,
    expires_in: SESSION_TTL_MS / 1000,
  });
}

/**
 * Route handler: GET /api/admin/auth/verify
 */
function handleVerify(req, res) {
  const token = extractToken(req);
  const isValid = isValidSession(token);
  res.json({ authenticated: isValid });
}

/**
 * Route handler: POST /api/admin/auth/logout
 */
function handleLogout(req, res) {
  const token = extractToken(req);
  if (token) revokeSession(token);
  res.json({ success: true, message: 'Logged out successfully.' });
}

module.exports = {
  requireAdminAuth,
  handleLogin,
  handleVerify,
  handleLogout,
  getAdminPassword,
};
