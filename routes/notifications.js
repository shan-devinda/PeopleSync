const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/notifications — Get user's notifications
router.get('/', requireAuth, async (req, res) => {
    try {
        const notifications = await prisma.notification.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' },
            take: 20
        });
        res.json(notifications);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', requireAuth, async (req, res) => {
    try {
        await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
        res.json({ message: 'Marked as read' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to mark notification' });
    }
});

// PUT /api/notifications/read-all
router.put('/read-all', requireAuth, async (req, res) => {
    try {
        await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } });
        res.json({ message: 'All marked as read' });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

module.exports = router;
