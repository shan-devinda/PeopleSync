const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 8080;

// ── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.socket.io"],
            imgSrc: ["'self'", "data:", "https://ui-avatars.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            connectSrc: ["'self'", "ws:", "wss:"],
        }
    }
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many requests. Please wait 15 minutes.' } });

// ── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/approvals', require('./routes/approvals'));
app.use('/api/events', require('./routes/events'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/notifications', require('./routes/notifications'));

// ── Reports API ──────────────────────────────────────────────────────────────
const { requireAuth, requireRole } = require('./middleware/auth');
app.get('/api/reports/summary', requireAuth, requireRole('admin', 'hr_manager', 'hr_officer', 'auditor'), async (req, res) => {
    try {
        const [totalEmployees, activeEmployees, onLeave, archived, pendingApprovals, totalTasks, completedTasks] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { status: 'active' } }),
            prisma.user.count({ where: { status: 'leave' } }),
            prisma.user.count({ where: { status: 'archived' } }),
            prisma.changeRequest.count({ where: { status: 'pending' } }),
            prisma.task.count(),
            prisma.task.count({ where: { status: 'completed' } }),
        ]);

        const deptDist = await prisma.user.groupBy({ by: ['dept'], where: { status: 'active' }, _count: { dept: true } });
        const roleDist = await prisma.user.groupBy({ by: ['role'], where: { status: 'active' }, _count: { role: true } });
        const recentAuth = await prisma.auditLog.findMany({ where: { type: { in: ['AUTH_SUCCESS', 'AUTH_FAILED'] } }, orderBy: { createdAt: 'desc' }, take: 5 });

        res.json({ totalEmployees, activeEmployees, onLeave, archived, pendingApprovals, totalTasks, completedTasks, deptDist, roleDist, recentAuth });
    } catch (e) {
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// Messages API
app.get('/api/messages/:channel', requireAuth, async (req, res) => {
    try {
        const messages = await prisma.message.findMany({
            where: { channel: req.params.channel },
            include: { sender: { select: { firstName: true, lastName: true, role: true, dept: true } } },
            orderBy: { createdAt: 'asc' },
            take: 50
        });
        res.json(messages);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// ── Socket.io Real-Time Chat ─────────────────────────────────────────────────
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
        socket.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        next(new Error('Invalid token'));
    }
});

io.on('connection', (socket) => {
    console.log(`[WS] ${socket.user.firstName} ${socket.user.lastName} connected`);

    socket.on('join-channel', (channel) => {
        socket.join(channel);
    });

    socket.on('send-message', async (data) => {
        try {
            const { channel, content } = data;
            if (!content || !channel) return;
            const msg = await prisma.message.create({
                data: { channel, content, senderId: socket.user.id },
                include: { sender: { select: { firstName: true, lastName: true, role: true, dept: true } } }
            });
            io.to(channel).emit('new-message', msg);
            await prisma.auditLog.create({ data: { type: 'MESSAGE_SENT', details: `Message sent in channel: ${channel}`, userId: socket.user.id } }).catch(() => {});
        } catch (e) {
            console.error('Socket message error:', e);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[WS] ${socket.user.firstName} disconnected`);
    });
});

// ── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════╗');
    console.log('  ║   PeopleSync Secure HR ERP System     ║');
    console.log(`  ║   Server running on port ${PORT}          ║`);
    console.log('  ║   http://localhost:' + PORT + '              ║');
    console.log('  ╚═══════════════════════════════════════╝');
    console.log('');
});
