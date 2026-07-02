const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole, HR_ROLES } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const logAudit = async (req, type, details) => {
    await prisma.auditLog.create({ data: { type, details, ipAddress: req.ip, userAgent: req.headers['user-agent'], userId: req.user?.id } }).catch(() => {});
};

// GET /api/approvals — List change requests (HR+ sees all, employees see own)
router.get('/', requireAuth, async (req, res) => {
    try {
        const isHR = HR_ROLES.includes(req.user.role) || req.user.role === 'admin';
        const where = isHR ? {} : { userId: req.user.id };
        const where_status = req.query.status ? { ...where, status: req.query.status } : where;
        const requests = await prisma.changeRequest.findMany({
            where: where_status,
            include: { user: { select: { firstName: true, lastName: true, email: true, dept: true, jobTitle: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(requests);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch approvals' });
    }
});

// PUT /api/approvals/:id — Approve or Deny (HR only)
router.put('/:id', requireAuth, requireRole(...HR_ROLES, 'admin'), async (req, res) => {
    const { action, reviewNote } = req.body; // action: 'approve' | 'deny'
    if (!['approve', 'deny'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

    try {
        const cr = await prisma.changeRequest.findUnique({ where: { id: req.params.id } });
        if (!cr) return res.status(404).json({ error: 'Change request not found' });
        if (cr.status !== 'pending') return res.status(409).json({ error: 'Request already reviewed' });

        const newStatus = action === 'approve' ? 'approved' : 'denied';
        await prisma.changeRequest.update({ where: { id: cr.id }, data: { status: newStatus, reviewedBy: `${req.user.firstName} ${req.user.lastName}`, reviewNote: reviewNote || '' } });

        // If approved, apply the change to the user record
        if (action === 'approve') {
            await prisma.user.update({ where: { id: cr.userId }, data: { [cr.fieldName]: cr.newValue } });
        }

        // Notify the employee
        await prisma.notification.create({ data: { userId: cr.userId, title: `Change Request ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`, message: `Your request to update "${cr.fieldLabel}" has been ${newStatus} by ${req.user.firstName} ${req.user.lastName}.${reviewNote ? ' Note: ' + reviewNote : ''}`, type: 'approval' } }).catch(() => {});

        await logAudit(req, `APPROVAL_${newStatus.toUpperCase()}`, `${action}d change request for field "${cr.fieldLabel}" of user ${cr.userId}`);
        res.json({ message: `Request ${newStatus} successfully` });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to process approval' });
    }
});

module.exports = router;
