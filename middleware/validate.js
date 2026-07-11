/**
 * Input validation and sanitization helpers.
 * Used across route handlers to validate incoming request bodies.
 */

/**
 * Sanitize a string value: trim whitespace, enforce max length.
 * @param {any} val
 * @param {number} maxLength
 * @returns {string|null}
 */
function sanitizeString(val, maxLength = 500) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

/**
 * Validate latitude value.
 * @param {any} val
 * @returns {number|null}
 */
function validateLat(val) {
  const num = parseFloat(val);
  if (isNaN(num) || num < -90 || num > 90) return null;
  return num;
}

/**
 * Validate longitude value.
 * @param {any} val
 * @returns {number|null}
 */
function validateLng(val) {
  const num = parseFloat(val);
  if (isNaN(num) || num < -180 || num > 180) return null;
  return num;
}

/**
 * Validate a positive number.
 * @param {any} val
 * @returns {number|null}
 */
function validatePositiveNumber(val) {
  const num = parseFloat(val);
  if (isNaN(num) || num <= 0) return null;
  return num;
}

/**
 * Validate email format.
 * @param {any} val
 * @returns {string|null}
 */
function validateEmail(val) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim().toLowerCase();
  // Basic email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed) || trimmed.length > 254) return null;
  return trimmed;
}

/**
 * Validate password (min 6 chars, max 128).
 * @param {any} val
 * @returns {string|null}
 */
function validatePassword(val) {
  if (typeof val !== 'string') return null;
  if (val.length < 6 || val.length > 128) return null;
  return val;
}

module.exports = {
  sanitizeString,
  validateLat,
  validateLng,
  validatePositiveNumber,
  validateEmail,
  validatePassword
};
