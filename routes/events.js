const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole, HR_ROLES } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/events
router.get('/', requireAuth, async (req, res) => {
    try {
        const events = await prisma.event.findMany({ orderBy: { date: 'asc' } });
        // Also add birthday events from employees
        const employees = await prisma.user.findMany({ where: { status: 'active', NOT: { dateOfBirth: null } }, select: { firstName: true, lastName: true, dateOfBirth: true } });
        const year = new Date().getFullYear();
        const birthdayEvents = employees.filter(e => e.dateOfBirth).map(e => {
            const parts = e.dateOfBirth.split('-');
            const month = parts.length >= 2 ? parts[1] : '01';
            const day = parts.length >= 3 ? parts[2] : '01';
            return { id: `bd_${e.firstName}`, title: `🎂 ${e.firstName} ${e.lastName}'s Birthday`, type: 'birthday', date: `${year}-${month}-${day}`, description: '' };
        });
        res.json([...events, ...birthdayEvents]);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// POST /api/events — HR only
router.post('/', requireAuth, requireRole(...HR_ROLES, 'admin'), async (req, res) => {
    const { title, type, date, description } = req.body;
    if (!title || !type || !date) return res.status(400).json({ error: 'Title, type, and date required' });
    try {
        const event = await prisma.event.create({ data: { title, type, date, description, createdBy: `${req.user.firstName} ${req.user.lastName}` } });
        res.status(201).json(event);
    } catch (e) {
        res.status(500).json({ error: 'Failed to create event' });
    }
});

// DELETE /api/events/:id
router.delete('/:id', requireAuth, requireRole(...HR_ROLES, 'admin'), async (req, res) => {
    try {
        await prisma.event.delete({ where: { id: req.params.id } });
        res.json({ message: 'Event deleted' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

module.exports = router;
