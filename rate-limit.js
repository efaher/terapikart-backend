function normalizeKeyPart(value) {
  return String(value || '').trim().toLowerCase().slice(0, 256);
}

function requestIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (forwarded) return forwarded;
  return String(req?.ip || req?.socket?.remoteAddress || 'unknown');
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 20,
  key = requestIp,
  code = 'RATE_LIMITED',
  message = 'Çok fazla istek gönderildi. Lütfen bir süre sonra tekrar deneyin.'
} = {}) {
  const safeWindowMs = positiveNumber(windowMs, 15 * 60 * 1000);
  const safeMax = Math.max(1, Math.floor(positiveNumber(max, 20)));
  const buckets = new Map();
  let requestCounter = 0;

  function cleanup(now) {
    for (const [bucketKey, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    requestCounter += 1;
    if (requestCounter >= 100) {
      cleanup(now);
      requestCounter = 0;
    }

    const rawKey = typeof key === 'function' ? key(req) : requestIp(req);
    const bucketKey = normalizeKeyPart(rawKey) || 'unknown';
    let bucket = buckets.get(bucketKey);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + safeWindowMs };
      buckets.set(bucketKey, bucket);
    }

    if (bucket.count >= safeMax) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Limit', String(safeMax));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
      return res.status(429).json({ code, message, retryAfterSeconds });
    }

    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(safeMax));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, safeMax - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    return next();
  };
}

module.exports = {
  createRateLimiter,
  requestIp,
  normalizeKeyPart
};
