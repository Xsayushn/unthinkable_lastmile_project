const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'lastmile-secret-key-98765';

/**
 * Middleware: Strict JWT Authentication.
 * Reads token from httpOnly cookie or Bearer Authorization header.
 */
function authenticateToken(req, res, next) {
  const token =
    req.cookies.token ||
    (req.headers['authorization'] && req.headers['authorization'].split(' ')[1]);

  if (!token) {
    return res.status(401).json({ error: 'Access denied. Please log in first.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

/**
 * Middleware: Require admin role.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access forbidden. Admin only.' });
  }
  next();
}

module.exports = { authenticateToken, requireAdmin };
