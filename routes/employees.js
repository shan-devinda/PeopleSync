const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole, HR_ROLES } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const logAudit = async (req, type, details, userId = null) => {
    await prisma.auditLog.create({ data: { type, details, ipAddress: req.ip, userAgent: req.headers['user-agent'], userId: userId || req.user?.id } }).catch(() => {});
};

// GET /api/employees — Get all employees (protected)
router.get('/', requireAuth, async (req, res) => {
    try {
        const where = {};
        if (!HR_ROLES.includes(req.user.role) && req.user.role !== 'auditor' && req.user.role !== 'admin') {
            // Dept managers/team leaders see their dept; employees see only themselves
            if (req.user.role === 'dept_manager' || req.user.role === 'team_leader') {
                where.dept = req.user.dept;
            } else {
                where.id = req.user.id;
            }
        }
        const employees = await prisma.user.findMany({
            where,
            select: { id: true, email: true, role: true, firstName: true, lastName: true, dept: true, jobTitle: true, phone: true, emergencyContact: true, address: true, dateOfBirth: true, dateJoined: true, status: true, avatar: true, education: true, qualifications: true, certifications: true, certExpiryDate: true, workExperience: true, skills: true, languages: true, lastLogin: true, createdAt: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(employees);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to fetch employees' });
    }
});

// GET /api/employees/:id
router.get('/:id', requireAuth, async (req, res) => {
    try {
        // Employees can only view their own full profile
        if (!HR_ROLES.includes(req.user.role) && req.user.role !== 'admin' && req.user.id !== req.params.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const emp = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, role: true, firstName: true, lastName: true, dept: true, jobTitle: true, phone: true, emergencyContact: true, address: true, dateOfBirth: true, dateJoined: true, status: true, avatar: true, education: true, qualifications: true, certifications: true, certExpiryDate: true, workExperience: true, skills: true, languages: true, mfaEnabled: true, lastLogin: true, createdAt: true } });
        if (!emp) return res.status(404).json({ error: 'Employee not found' });
        res.json(emp);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch employee' });
    }
});

// POST /api/employees — HR only creates employee
router.post('/', requireAuth, requireRole(...HR_ROLES, 'admin'), async (req, res) => {
    const { email, password, role, firstName, lastName, dept, jobTitle, phone, dateJoined, dateOfBirth } = req.body;
    if (!email || !password || !firstName || !lastName) return res.status(400).json({ error: 'Required fields missing' });
    try {
        const exists = await prisma.user.findUnique({ where: { email } });
        if (exists) return res.status(409).json({ error: 'Email already in use' });
        const hashed = await bcrypt.hash(password, 10);
        const emp = await prisma.user.create({ data: { email, password: hashed, role: role || 'employee', firstName, lastName, dept: dept || 'Unassigned', jobTitle: jobTitle || 'Employee', phone, dateJoined, dateOfBirth } });
        await logAudit(req, 'EMPLOYEE_CREATED', `Created employee ${firstName} ${lastName} (${email})`);
        res.status(201).json({ id: emp.id, email: emp.email, firstName: emp.firstName, lastName: emp.lastName, role: emp.role, dept: emp.dept });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to create employee' });
    }
});

// PUT /api/employees/:id — HR full edit; employees submit change requests
router.put('/:id', requireAuth, async (req, res) => {
    const isHR = HR_ROLES.includes(req.user.role) || req.user.role === 'admin';
    const isSelf = req.user.id === req.params.id;

    if (!isHR && !isSelf) return res.status(403).json({ error: 'Forbidden' });

    try {
        if (isHR) {
            // HR can update any field directly
            const { email, role, firstName, lastName, dept, jobTitle, phone, emergencyContact, address, dateOfBirth, dateJoined, status, education, qualifications, certifications, certExpiryDate, workExperience, skills, languages } = req.body;
            const data = {};
            if (email) data.email = email;
            if (role) data.role = role;
            if (firstName) data.firstName = firstName;
            if (lastName) data.lastName = lastName;
            if (dept !== undefined) data.dept = dept;
            if (jobTitle !== undefined) data.jobTitle = jobTitle;
            if (phone !== undefined) data.phone = phone;
            if (emergencyContact !== undefined) data.emergencyContact = emergencyContact;
            if (address !== undefined) data.address = address;
            if (dateOfBirth !== undefined) data.dateOfBirth = dateOfBirth;
            if (dateJoined !== undefined) data.dateJoined = dateJoined;
            if (status !== undefined) data.status = status;
            if (education !== undefined) data.education = education;
            if (qualifications !== undefined) data.qualifications = qualifications;
            if (certifications !== undefined) data.certifications = certifications;
            if (certExpiryDate !== undefined) data.certExpiryDate = certExpiryDate;
            if (workExperience !== undefined) data.workExperience = workExperience;
            if (skills !== undefined) data.skills = skills;
            if (languages !== undefined) data.languages = languages;
            const updated = await prisma.user.update({ where: { id: req.params.id }, data });
            await logAudit(req, 'PROFILE_UPDATED', `HR updated profile for employee ID ${req.params.id}`);
            res.json({ message: 'Profile updated', user: { id: updated.id, firstName: updated.firstName, lastName: updated.lastName } });
        } else {
            // Employees submit change requests for allowed fields
            const ALLOWED_FIELDS = ['qualifications', 'certifications', 'certExpiryDate', 'skills', 'languages', 'education', 'workExperience', 'emergencyContact', 'phone'];
            const FIELD_LABELS = { qualifications: 'Qualifications', certifications: 'Certifications', certExpiryDate: 'Cert. Expiry Date', skills: 'Skills', languages: 'Languages', education: 'Education', workExperience: 'Work Experience', emergencyContact: 'Emergency Contact', phone: 'Phone' };
            const currentUser = await prisma.user.findUnique({ where: { id: req.params.id } });
            const requests = [];
            for (const field of ALLOWED_FIELDS) {
                if (req.body[field] !== undefined && req.body[field] !== currentUser[field]) {
                    const cr = await prisma.changeRequest.create({ data: { userId: req.params.id, fieldName: field, fieldLabel: FIELD_LABELS[field] || field, oldValue: currentUser[field] || '', newValue: req.body[field] } });
                    requests.push(cr);

                    // Notify HR managers
                    const hrUsers = await prisma.user.findMany({ where: { role: { in: ['admin', 'hr_manager'] }, status: 'active' } });
                    for (const hr of hrUsers) {
                        await prisma.notification.create({ data: { userId: hr.id, title: 'Profile Change Request', message: `${currentUser.firstName} ${currentUser.lastName} submitted a change request for ${FIELD_LABELS[field] || field}.`, type: 'approval' } }).catch(() => {});
                    }
                }
            }
            await logAudit(req, 'CHANGE_REQUEST_SUBMITTED', `Employee submitted ${requests.length} change request(s)`);
            res.json({ message: `${requests.length} change request(s) submitted for approval`, requests });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to update' });
    }
});

// DELETE /api/employees/:id — Archive (soft delete)
router.delete('/:id', requireAuth, requireRole(...HR_ROLES, 'admin'), async (req, res) => {
    try {
        await prisma.user.update({ where: { id: req.params.id }, data: { status: 'archived' } });
        await logAudit(req, 'EMPLOYEE_ARCHIVED', `Archived employee ID ${req.params.id}`);
        res.json({ message: 'Employee archived successfully' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to archive employee' });
    }
});

module.exports = router;
