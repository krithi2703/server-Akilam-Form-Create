// authMiddleware.js
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Use environment variable for JWT secret
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Middleware to verify JWT token and attach user info to request
 */
function verifyToken(req, res, next) {
  //console.log('🔹 verifyToken middleware triggered');

  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    //console.log('🔹 Auth Header:', authHeader);

    const token = authHeader && authHeader.split(' ')[1]; // Expected format: "Bearer <token>"
    //console.log('🔹 Token:', token);

    // Optional: Allow preview mode via a custom header
    const userIdHeader = req.headers['userid'];
    if (userIdHeader === 'preview') {
      //console.log('🔹 Preview mode enabled');
      req.user = { UserId: 0, isPreview: true }; // Placeholder for preview
      return next();
    }

    const isFormOnlyUser = req.headers['is-form-only-user'] === 'true';
    const userIdFromHeader = req.headers['userid'];

    if (isFormOnlyUser && userIdFromHeader) {
      req.user = { UserId: userIdFromHeader };
      return next();
    }

    if (userIdFromHeader && !isNaN(parseInt(userIdFromHeader, 10))) {
     // console.log('🔹 User ID from header:', userIdFromHeader);
      req.user = { UserId: parseInt(userIdFromHeader, 10) };
      return next();
    }
    // No token provided
    if (!token) {
      console.warn('⚠️ Access denied: No token provided');
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    // Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET);
    //console.log('🔹 Decoded Token:', decoded);

    // Normalize user ID from token (handles different naming conventions)
    const userId = decoded.UserId || decoded.id || decoded.userId || decoded.Id;
    const parsedUserId = parseInt(userId, 10);

    if (isNaN(parsedUserId) || !Number.isInteger(parsedUserId) || parsedUserId < -2147483648 || parsedUserId > 2147483647) {
      console.warn('⚠️ Invalid token: UserId is not a valid integer or out of range');
      return res.status(401).json({ message: 'Invalid token: UserId is not a valid integer or out of range' });
    }

    // Attach user info to request object
    req.user = { UserId: parsedUserId, ...decoded };
    //console.log('🔹 User attached to request:', req.user);

    next(); // Proceed to the next middleware or route handler
  } catch (err) {
    console.error('❌ Token verification failed:', err.message);
    return res.status(403).json({ message: 'Invalid or expired token.' });
  }
}

module.exports = verifyToken;
