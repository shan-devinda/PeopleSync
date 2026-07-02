const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'peoplesync-super-secure-secret-2026';

const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Unauthorized: Token expired or invalid' });
    }
};

const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }
    next();
};

const HR_ROLES = ['admin', 'hr_manager', 'hr_officer'];
const MANAGER_ROLES = ['admin', 'hr_manager', 'hr_officer', 'dept_manager', 'team_leader'];

module.exports = { requireAuth, requireRole, HR_ROLES, MANAGER_ROLES, JWT_SECRET };
