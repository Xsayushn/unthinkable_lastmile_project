const rateLimit = require('express-rate-limit');

const IS_TEST = process.env.NODE_ENV === 'test';

// A pass-through middleware for use in test environments
const noopMiddleware = (req, res, next) => next();

/**
 * Rate limiter for authentication endpoints.
 * Limits to 10 requests per 15 minutes per IP to prevent brute-force attacks.
 * Disabled in test environment.
 */
const authLimiter = IS_TEST
  ? noopMiddleware
  : rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Too many login attempts from this IP. Please try again after 15 minutes.'
      }
    });

/**
 * General API limiter — 100 requests per minute per IP.
 * Disabled in test environment.
 */
const apiLimiter = IS_TEST
  ? noopMiddleware
  : rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Too many requests from this IP. Please slow down.'
      }
    });

module.exports = { authLimiter, apiLimiter };
