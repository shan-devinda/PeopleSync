const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding PeopleSync HR ERP database...');

    await prisma.auditLog.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.changeRequest.deleteMany();
    await prisma.message.deleteMany();
    await prisma.task.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();

    const hash = async (p) => bcrypt.hash(p, 10);

    const admin = await prisma.user.create({ data: { email: 'admin@peoplesync.com', password: await hash('Admin@1234'), role: 'admin', firstName: 'Super', lastName: 'Admin', dept: 'Executive', jobTitle: 'System Administrator', phone: '+1-555-0001', dateJoined: '2020-01-01', status: 'active' } });
    const hrm = await prisma.user.create({ data: { email: 'hrmanager@peoplesync.com', password: await hash('Hr@1234'), role: 'hr_manager', firstName: 'Jane', lastName: 'Doe', dept: 'Human Resources', jobTitle: 'HR Director', phone: '+1-555-0002', dateOfBirth: '1985-07-15', dateJoined: '2021-03-01', status: 'active', skills: 'SHRM-CP, Talent Acquisition', certifications: 'SHRM Certified', certExpiryDate: '2027-03-01', languages: 'English, Spanish' } });
    const hro = await prisma.user.create({ data: { email: 'hrofficer@peoplesync.com', password: await hash('Hr@1234'), role: 'hr_officer', firstName: 'Sarah', lastName: 'Williams', dept: 'Human Resources', jobTitle: 'HR Officer', phone: '+1-555-0003', dateOfBirth: '1990-02-20', dateJoined: '2022-06-01', status: 'active', skills: 'Payroll, Onboarding' } });
    const dm = await prisma.user.create({ data: { email: 'deptmanager@peoplesync.com', password: await hash('Manager@1234'), role: 'dept_manager', firstName: 'Marcus', lastName: 'Johnson', dept: 'Engineering', jobTitle: 'Engineering Manager', phone: '+1-555-0004', dateOfBirth: '1982-11-05', dateJoined: '2020-09-15', status: 'active', skills: 'Node.js, AWS, Team Leadership', certifications: 'AWS Solutions Architect', certExpiryDate: '2026-09-01', workExperience: '2020-Present: Eng Manager at PeopleSync\n2015-2020: Senior Dev at TechCorp', languages: 'English' } });
    const tl = await prisma.user.create({ data: { email: 'teamlead@peoplesync.com', password: await hash('Lead@1234'), role: 'team_leader', firstName: 'David', lastName: 'Chen', dept: 'Engineering', jobTitle: 'Senior Team Lead', phone: '+1-555-0005', dateOfBirth: '1992-04-18', dateJoined: '2021-11-01', status: 'active', skills: 'React, Python, Docker' } });
    const emp = await prisma.user.create({ data: { email: 'employee@peoplesync.com', password: await hash('Emp@1234'), role: 'employee', firstName: 'Elena', lastName: 'Rodriguez', dept: 'Engineering', jobTitle: 'Software Developer', phone: '+1-555-0006', dateOfBirth: '1995-09-12', dateJoined: '2023-02-01', status: 'active', education: 'BSc Computer Science - State University (2017)', skills: 'JavaScript, Vue.js, PostgreSQL', languages: 'English, Portuguese', workExperience: '2023-Present: Developer at PeopleSync' } });
    const aud = await prisma.user.create({ data: { email: 'auditor@peoplesync.com', password: await hash('Audit@1234'), role: 'auditor', firstName: 'Alex', lastName: 'Thompson', dept: 'Compliance', jobTitle: 'Security Auditor', phone: '+1-555-0007', dateJoined: '2022-01-15', status: 'active' } });

    // Seed Events
    await prisma.event.createMany({ data: [
        { title: 'Q3 Company Townhall', type: 'company', date: '2026-07-10', description: 'Quarterly all-hands meeting in the main auditorium.', createdBy: 'Jane Doe' },
        { title: 'Cybersecurity Awareness Training', type: 'training', date: '2026-07-15', description: 'Mandatory annual cybersecurity training for all staff.', createdBy: 'Jane Doe' },
        { title: 'Independence Day Holiday', type: 'holiday', date: '2026-07-04', description: 'Public holiday — offices closed.', createdBy: 'Jane Doe' },
        { title: 'Engineering Dept Review', type: 'meeting', date: '2026-07-22', description: 'Monthly engineering performance review.', createdBy: 'Marcus Johnson' },
    ]});

    // Seed Tasks
    const task1 = await prisma.task.create({ data: { title: 'Complete Security Audit Report', description: 'Review Q2 audit findings and prepare final report for management.', assignedToId: aud.id, createdById: admin.id, priority: 'high', deadline: '2026-07-10', status: 'in_progress' } });
    const task2 = await prisma.task.create({ data: { title: 'Onboard New Developer', description: 'Prepare workstation and access credentials for new hire starting July 14.', assignedToId: tl.id, createdById: hrm.id, priority: 'medium', deadline: '2026-07-14', status: 'pending' } });
    const task3 = await prisma.task.create({ data: { title: 'Update API Documentation', description: 'Document all new REST endpoints added in Sprint 12.', assignedToId: emp.id, createdById: tl.id, priority: 'low', deadline: '2026-07-20', status: 'pending' } });

    // Seed Change Requests
    await prisma.changeRequest.create({ data: { userId: emp.id, fieldName: 'certifications', fieldLabel: 'Certifications', oldValue: '', newValue: 'AWS Cloud Practitioner (Passed June 2026)', status: 'pending' } });

    // Seed Notifications
    await prisma.notification.createMany({ data: [
        { userId: hrm.id, title: 'Profile Change Request', message: 'Elena Rodriguez submitted a change request for Certifications.', type: 'approval' },
        { userId: admin.id, title: '📋 System Seeded', message: 'The PeopleSync ERP database has been successfully seeded with test data.', type: 'system' },
        { userId: emp.id, title: '📋 New Task Assigned', message: 'You have been assigned: "Update API Documentation" by David Chen. Deadline: 2026-07-20', type: 'task' },
    ]});

    // Seed Audit Logs
    await prisma.auditLog.createMany({ data: [
        { type: 'AUTH_SUCCESS', details: 'User admin@peoplesync.com (admin) logged in successfully', ipAddress: '192.168.1.1', userId: admin.id },
        { type: 'EMPLOYEE_CREATED', details: 'Created employee Elena Rodriguez (employee@peoplesync.com)', ipAddress: '192.168.1.1', userId: admin.id },
        { type: 'TASK_ASSIGNED', details: 'Task "Update API Documentation" assigned to Elena Rodriguez', ipAddress: '192.168.1.5', userId: tl.id },
        { type: 'CHANGE_REQUEST_SUBMITTED', details: 'Employee submitted 1 change request(s)', ipAddress: '192.168.1.10', userId: emp.id },
        { type: 'AUTH_FAILED', details: 'Invalid password for unknown@test.com. Attempt 1/5', ipAddress: '203.0.113.42' },
    ]});

    console.log('\n✅ Database seeded successfully!');
    console.log('─────────────────────────────────────');
    console.log('  Login Credentials:');
    console.log('  Super Admin  : admin@peoplesync.com        / Admin@1234');
    console.log('  HR Manager   : hrmanager@peoplesync.com   / Hr@1234');
    console.log('  HR Officer   : hrofficer@peoplesync.com   / Hr@1234');
    console.log('  Dept Manager : deptmanager@peoplesync.com / Manager@1234');
    console.log('  Team Leader  : teamlead@peoplesync.com    / Lead@1234');
    console.log('  Employee     : employee@peoplesync.com    / Emp@1234');
    console.log('  Auditor      : auditor@peoplesync.com     / Audit@1234');
    console.log('─────────────────────────────────────\n');
}

main().catch(console.error).finally(() => prisma.$disconnect());
