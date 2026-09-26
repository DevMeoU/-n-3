const jwt = require('jsonwebtoken');
const config = require('./config');

const ROLES = ['READER', 'LIBRARIAN', 'ADMIN'];

function signUserToken(user) {
  return jwt.sign({
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role
  }, config.jwtSecret, { expiresIn: '8h', subject: String(user.id) });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

function identityFromHeaders(req) {
  const id = Number(req.get('x-user-id'));
  const role = req.get('x-user-role');
  const encodedName = req.get('x-user-name');
  if (!Number.isInteger(id) || id < 1 || !ROLES.includes(role) || !encodedName) return null;
  let fullName;
  try { fullName = decodeURIComponent(encodedName); } catch { return null; }
  return { id, role, fullName, username: req.get('x-username') || '' };
}

function requireRoles(req, res, roles) {
  const identity = identityFromHeaders(req);
  if (!identity) {
    res.status(401).json({ error: 'Thiếu thông tin xác thực hợp lệ' });
    return null;
  }
  if (!roles.includes(identity.role)) {
    res.status(403).json({ error: 'Bạn không có quyền thực hiện chức năng này' });
    return null;
  }
  return identity;
}

module.exports = { ROLES, signUserToken, verifyToken, identityFromHeaders, requireRoles };
