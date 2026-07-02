const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole, MANAGER_ROLES } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const logAudit = async (req, type, details) => {
    await prisma.auditLog.create({ data: { type, details, ipAddress: req.ip, userAgent: req.headers['user-agent'], userId: req.user?.id } }).catch(() => {});
};

// GET /api/tasks
router.get('/', requireAuth, async (req, res) => {
    try {
        const isManager = MANAGER_ROLES.includes(req.user.role);
        const where = isManager ? {} : { assignedToId: req.user.id };
        const tasks = await prisma.task.findMany({
            where,
            include: {
                assignedTo: { select: { firstName: true, lastName: true, dept: true } },
                createdBy: { select: { firstName: true, lastName: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(tasks);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// POST /api/tasks — Managers+ can create
router.post('/', requireAuth, requireRole(...MANAGER_ROLES), async (req, res) => {
    const { title, description, assignedToId, priority, deadline } = req.body;
    if (!title || !assignedToId) return res.status(400).json({ error: 'Title and assignedToId required' });
    try {
        const task = await prisma.task.create({ data: { title, description, assignedToId, priority: priority || 'medium', deadline, createdById: req.user.id } });
        // Notify assignee
        await prisma.notification.create({ data: { userId: assignedToId, title: '📋 New Task Assigned', message: `You have been assigned: "${title}" by ${req.user.firstName} ${req.user.lastName}.${deadline ? ' Deadline: ' + deadline : ''}`, type: 'task' } }).catch(() => {});
        await logAudit(req, 'TASK_ASSIGNED', `Task "${title}" assigned to user ${assignedToId}`);
        res.status(201).json(task);
    } catch (e) {
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// PUT /api/tasks/:id — Update status
router.put('/:id', requireAuth, async (req, res) => {
    const { status, title, description, priority, deadline } = req.body;
    try {
        const task = await prisma.task.findUnique({ where: { id: req.params.id } });
        if (!task) return res.status(404).json({ error: 'Task not found' });
        const isManager = MANAGER_ROLES.includes(req.user.role);
        const isAssignee = task.assignedToId === req.user.id;
        if (!isManager && !isAssignee) return res.status(403).json({ error: 'Forbidden' });

        const data = {};
        if (status) data.status = status;
        if (isManager) { if (title) data.title = title; if (description !== undefined) data.description = description; if (priority) data.priority = priority; if (deadline !== undefined) data.deadline = deadline; }
        await prisma.task.update({ where: { id: req.params.id }, data });
        await logAudit(req, 'TASK_UPDATED', `Task ${req.params.id} updated (status: ${status || 'unchanged'})`);
        res.json({ message: 'Task updated' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// DELETE /api/tasks/:id — Managers only
router.delete('/:id', requireAuth, requireRole(...MANAGER_ROLES), async (req, res) => {
    try {
        await prisma.task.delete({ where: { id: req.params.id } });
        res.json({ message: 'Task deleted' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

module.exports = router;
