const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Short-lived temp token secret for MFA intermediate step
const MFA_TEMP_SECRET = JWT_SECRET + '_mfa_temp';

const logAudit = async (req, type, details, userId = null) => {
    await prisma.auditLog.create({
        data: { type, details, ipAddress: req.ip, userAgent: req.headers['user-agent'], userId }
    }).catch(() => {});
};

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            await logAudit(req, 'AUTH_FAILED', `Login attempt with unknown email: ${email}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Account lockout check
        if (user.lockedUntil && new Date() < new Date(user.lockedUntil)) {
            const mins = Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000);
            return res.status(423).json({ error: `Account locked. Try again in ${mins} minute(s).` });
        }

        if (user.status === 'archived') {
            return res.status(403).json({ error: 'This account has been archived.' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            const attempts = user.failedLoginAttempts + 1;
            const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
            await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: attempts, lockedUntil } });
            await logAudit(req, 'AUTH_FAILED', `Invalid password for ${email}. Attempt ${attempts}/5`, user.id);
            if (lockedUntil) return res.status(423).json({ error: 'Account locked after 5 failed attempts. Try again in 15 minutes.' });
            return res.status(401).json({ error: `Invalid credentials. ${5 - attempts} attempt(s) remaining.` });
        }

        // Reset lock
        await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });

        // ── MFA check ────────────────────────────────────────────────────────
        if (user.mfaEnabled && user.mfaSecret) {
            // Issue a short-lived temp token (2 minutes) — only valid for MFA step
            const tempToken = jwt.sign(
                { id: user.id, mfaStep: true },
                MFA_TEMP_SECRET,
                { expiresIn: '2m' }
            );
            await logAudit(req, 'AUTH_MFA_REQUIRED', `MFA required for ${email}`, user.id);
            return res.json({ requiresMFA: true, tempToken });
        }

        // ── No MFA — issue full token ─────────────────────────────────────────
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, dept: user.dept, mfaEnabled: user.mfaEnabled },
            JWT_SECRET,
            { expiresIn: '8h' }
        );
        await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
        await logAudit(req, 'AUTH_SUCCESS', `User ${user.email} (${user.role}) logged in successfully`, user.id);

        res.json({ token, user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, dept: user.dept, mfaEnabled: user.mfaEnabled } });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/auth/mfa/validate ───────────────────────────────────────────────
// Called after login if MFA is enabled. Validates the TOTP code.
router.post('/mfa/validate', async (req, res) => {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) return res.status(400).json({ error: 'Temp token and code required' });

    try {
        // Verify temp token
        let payload;
        try {
            payload = jwt.verify(tempToken, MFA_TEMP_SECRET);
        } catch {
            return res.status(401).json({ error: 'MFA session expired. Please log in again.' });
        }

        if (!payload.mfaStep) return res.status(401).json({ error: 'Invalid MFA token' });

        const user = await prisma.user.findUnique({ where: { id: payload.id } });
        if (!user || !user.mfaSecret) return res.status(401).json({ error: 'MFA not configured for this account.' });

        // Verify TOTP code (accepts 30s window tolerance)
        const verified = speakeasy.totp.verify({
            secret: user.mfaSecret,
            encoding: 'base32',
            token: code.replace(/\s/g, ''),
            window: 1
        });

        if (!verified) {
            await logAudit(req, 'MFA_FAILED', `Invalid MFA code for ${user.email}`, user.id);
            return res.status(401).json({ error: 'Invalid or expired verification code. Please try again.' });
        }

        // MFA passed — issue full access token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, dept: user.dept, mfaEnabled: user.mfaEnabled },
            JWT_SECRET,
            { expiresIn: '8h' }
        );
        await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
        await logAudit(req, 'AUTH_SUCCESS', `User ${user.email} (${user.role}) logged in with MFA successfully`, user.id);

        res.json({ token, user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, dept: user.dept, mfaEnabled: user.mfaEnabled } });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── GET /api/auth/mfa/setup ───────────────────────────────────────────────────
// Generates a new TOTP secret and returns QR code for the authenticated user.
router.get('/mfa/setup', requireAuth, async (req, res) => {
    try {
        const secret = speakeasy.generateSecret({
            name: `PeopleSync ERP (${req.user.email})`,
            issuer: 'PeopleSync Secure ERP'
        });

        // Store temp secret on user record (not yet activated until confirmed)
        await prisma.user.update({ where: { id: req.user.id }, data: { mfaSecret: secret.base32 } });

        // Generate QR code as data URL
        const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

        res.json({
            secret: secret.base32,
            qrCode: qrDataUrl,
            manualEntry: secret.base32
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to generate MFA secret' });
    }
});

// ── POST /api/auth/mfa/verify-setup ──────────────────────────────────────────
// Confirms MFA setup by verifying first TOTP code. Activates MFA on the account.
router.post('/mfa/verify-setup', requireAuth, async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Verification code required' });

    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user.mfaSecret) return res.status(400).json({ error: 'MFA setup not initiated. Call /mfa/setup first.' });

        const verified = speakeasy.totp.verify({
            secret: user.mfaSecret,
            encoding: 'base32',
            token: code.replace(/\s/g, ''),
            window: 1
        });

        if (!verified) return res.status(400).json({ error: 'Invalid code. Please scan the QR code again and retry.' });

        await prisma.user.update({ where: { id: req.user.id }, data: { mfaEnabled: true } });
        await logAudit(req, 'MFA_ENABLED', `User ${req.user.email} enabled MFA`, req.user.id);

        res.json({ message: 'MFA enabled successfully! Your account is now protected.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to verify MFA setup' });
    }
});

// ── POST /api/auth/mfa/disable ────────────────────────────────────────────────
router.post('/mfa/disable', requireAuth, async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required to disable MFA' });

    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Incorrect password' });

        await prisma.user.update({ where: { id: req.user.id }, data: { mfaEnabled: false, mfaSecret: null } });
        await logAudit(req, 'MFA_DISABLED', `User ${req.user.email} disabled MFA`, req.user.id);

        res.json({ message: 'MFA disabled. Your account will no longer require a verification code.' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to disable MFA' });
    }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, email: true, role: true, firstName: true, lastName: true, dept: true, jobTitle: true, phone: true, emergencyContact: true, address: true, dateOfBirth: true, dateJoined: true, status: true, education: true, qualifications: true, certifications: true, certExpiryDate: true, workExperience: true, skills: true, languages: true, mfaEnabled: true, lastLogin: true }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: req.user.id }, data: { password: hashed } });
    await logAudit(req, 'PASSWORD_CHANGE', `User ${req.user.email} changed their password`, req.user.id);
    res.json({ message: 'Password changed successfully' });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
    await logAudit(req, 'AUTH_LOGOUT', `User ${req.user.email} logged out`, req.user.id);
    res.json({ message: 'Logged out successfully' });
});

module.exports = router;
