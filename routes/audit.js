const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/audit — Admin & Auditor only
router.get('/', requireAuth, requireRole('admin', 'auditor', 'hr_manager'), async (req, res) => {
    try {
        const { type, limit = 100 } = req.query;
        const where = type ? { type } : {};
        const logs = await prisma.auditLog.findMany({
            where,
            include: { user: { select: { firstName: true, lastName: true, email: true, role: true } } },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit)
        });
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

module.exports = router;
