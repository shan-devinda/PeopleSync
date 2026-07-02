// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let token = null;
let employees = [];
let calendarEvents = [];
let tasks = [];
let currentEmpId = null;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let currentChannel = 'engineering';
let socket = null;

// ─── Auth Guard ───────────────────────────────────────────────────────────────
function init() {
    token = localStorage.getItem('erp_token');
    if (!token) return (window.location.href = 'login.html');
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp * 1000 < Date.now()) throw new Error('expired');
        currentUser = payload;
    } catch {
        localStorage.removeItem('erp_token');
        return (window.location.href = 'login.html');
    }
    setupUI();
}

// ─── API Helper ───────────────────────────────────────────────────────────────
async function api(method, path, body = null) {
    const opts = { method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { localStorage.removeItem('erp_token'); window.location.href = 'login.html'; throw new Error('Unauthorized'); }
    return { ok: res.ok, status: res.status, data };
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
    const icons = { success: 'ph-check-circle', error: 'ph-warning-circle', info: 'ph-info' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="ph ${icons[type]}"></i> ${msg}`;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

// ─── Modal Helpers ────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
document.querySelectorAll('.modal-overlay').forEach(overlay => overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); }));

// ─── Navigation ───────────────────────────────────────────────────────────────
function navigate(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const view = document.getElementById(`view-${viewId}`);
    if (view) view.classList.add('active');
    const navItem = document.querySelector(`.nav-item[data-view="${viewId}"]`);
    if (navItem) navItem.classList.add('active');

    if (viewId === 'dashboard') loadDashboard();
    if (viewId === 'employees') loadEmployees();
    if (viewId === 'approvals') loadApprovals();
    if (viewId === 'tasks') loadTasks();
    if (viewId === 'calendar') renderCalendar();
    if (viewId === 'chat') initChat();
    if (viewId === 'reports') loadReports();
    if (viewId === 'audit') loadAudit();
    if (viewId === 'selfservice') loadSelfService();
    if (viewId === 'settings') loadSettings();
}

document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.view));
});

document.getElementById('mobileMenuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    localStorage.removeItem('erp_token');
    window.location.href = 'login.html';
});

// ─── Setup UI ────────────────────────────────────────────────────────────────
function setupUI() {
    const avatarUrl = `https://ui-avatars.com/api/?name=${currentUser.firstName}+${currentUser.lastName}&background=6366f1&color=fff`;
    document.getElementById('sidebarAvatar').src = avatarUrl;
    document.getElementById('sidebarName').textContent = `${currentUser.firstName} ${currentUser.lastName}`;
    document.getElementById('sidebarRole').textContent = roleLabel(currentUser.role);
    document.getElementById('headerAvatar').src = avatarUrl;
    document.getElementById('headerName').textContent = `${currentUser.firstName} ${currentUser.lastName}`;
    document.getElementById('headerRole').textContent = roleLabel(currentUser.role);

    applyRBAC();
    loadNotifications();
    navigate('dashboard');
    initSocketIO();
    setInterval(loadNotifications, 30000);
}

function roleLabel(r) {
    const map = { admin: 'Super Administrator', hr_manager: 'HR Manager', hr_officer: 'HR Officer', dept_manager: 'Department Manager', team_leader: 'Team Leader', employee: 'Employee', auditor: 'Auditor' };
    return map[r] || r;
}

function applyRBAC() {
    const r = currentUser.role;
    const isHR = ['admin', 'hr_manager', 'hr_officer'].includes(r);
    const isAdmin = r === 'admin';
    const isAuditor = r === 'auditor';
    const isManager = ['admin', 'hr_manager', 'hr_officer', 'dept_manager', 'team_leader'].includes(r);

    document.querySelectorAll('.hr-only').forEach(el => el.style.display = isHR ? '' : 'none');
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = (isAdmin || isAuditor) ? '' : 'none');
    document.querySelectorAll('.audit-only').forEach(el => el.style.display = (isAdmin || isAuditor) ? '' : 'none');
    document.querySelectorAll('.manager-only').forEach(el => el.style.display = isManager ? '' : 'none');
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function loadNotifications() {
    const { ok, data } = await api('GET', '/api/notifications');
    if (!ok) return;
    const unread = data.filter(n => !n.isRead);
    const countEl = document.getElementById('notifCount');
    if (unread.length > 0) { countEl.textContent = unread.length; countEl.style.display = 'flex'; }
    else { countEl.style.display = 'none'; }

    const list = document.getElementById('notifList');
    if (!data.length) { list.innerHTML = '<div class="notif-empty">No notifications</div>'; return; }
    list.innerHTML = data.map(n => `
        <div class="notif-item ${n.isRead ? '' : 'unread'}" onclick="markRead('${n.id}')">
            <div class="notif-icon ${n.type}"><i class="ph ph-${n.type === 'approval' ? 'check-square' : n.type === 'task' ? 'clipboard-text' : n.type === 'birthday' ? 'cake' : 'bell'}"></i></div>
            <div>
                <div class="notif-title">${n.title}</div>
                <div class="notif-msg">${n.message}</div>
                <div class="notif-time">${timeAgo(n.createdAt)}</div>
            </div>
        </div>`).join('');
}

async function markRead(id) { await api('PUT', `/api/notifications/${id}/read`); loadNotifications(); }

document.getElementById('notifBtn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('notifDropdown').classList.toggle('open');
});
document.addEventListener('click', () => document.getElementById('notifDropdown').classList.remove('open'));
document.getElementById('notifDropdown').addEventListener('click', e => e.stopPropagation());
document.getElementById('markAllReadBtn').addEventListener('click', async () => {
    await api('PUT', '/api/notifications/read-all');
    loadNotifications();
    toast('All notifications marked as read', 'success');
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
    // Load report summary for stats
    const r = await api('GET', '/api/reports/summary');
    if (r.ok) {
        const d = r.data;
        document.getElementById('stat-total').textContent = d.totalEmployees;
        document.getElementById('stat-active').textContent = d.activeEmployees;
        document.getElementById('stat-pending').textContent = d.pendingApprovals;
        document.getElementById('stat-tasks').textContent = d.totalTasks - d.completedTasks;
    }

    const ea = await api('GET', '/api/audit?limit=5');
    const actDiv = document.getElementById('dashActivity');
    if (ea.ok && ea.data.length) {
        actDiv.innerHTML = ea.data.map(log => `
            <div class="activity-item">
                <div class="activity-dot"></div>
                <div>
                    <div class="activity-text">${log.details}</div>
                    <div class="activity-time">${timeAgo(log.createdAt)} · ${log.ipAddress || 'Unknown IP'}</div>
                </div>
            </div>`).join('');
    } else {
        actDiv.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:0.83rem;">No recent activity</div>';
    }

    const ev = await api('GET', '/api/events');
    const evDiv = document.getElementById('dashEvents');
    if (ev.ok && ev.data.length) {
        const upcoming = ev.data.filter(e => e.date >= new Date().toISOString().slice(0, 10)).slice(0, 5);
        evDiv.innerHTML = upcoming.map(e => `
            <div class="event-item">
                <span class="event-dot ${e.type}"></span>
                <div>
                    <div class="event-title">${e.title}</div>
                    <div class="event-date">${formatDate(e.date)}</div>
                </div>
            </div>`).join('');
    } else {
        evDiv.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:0.83rem;">No upcoming events</div>';
    }
}

// ─── Employees ────────────────────────────────────────────────────────────────
async function loadEmployees() {
    const { ok, data } = await api('GET', '/api/employees');
    if (!ok) return toast('Failed to load employees', 'error');
    employees = data;
    renderEmployeeTable(employees);
    populateDeptFilter(employees);
}

function renderEmployeeTable(list) {
    const body = document.getElementById('empTableBody');
    if (!list.length) { body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">No employees found</td></tr>'; return; }
    body.innerHTML = list.map(e => `
        <tr>
            <td><div class="emp-cell">
                <img src="https://ui-avatars.com/api/?name=${e.firstName}+${e.lastName}&background=random&color=fff" class="avatar avatar-sm">
                <div><div class="emp-name">${e.firstName} ${e.lastName}</div><div class="emp-id">${e.email}</div></div>
            </div></td>
            <td><div class="role-text">${roleLabel(e.role)}</div><span class="dept-pill">${e.dept}</span></td>
            <td style="color:var(--text-secondary);font-size:0.8rem;">${e.phone || '—'}</td>
            <td><span class="status-badge ${e.status}">${e.status.charAt(0).toUpperCase() + e.status.slice(1)}</span></td>
            <td>
                <button class="action-btn" onclick="openEmpModal('${e.id}')" title="View/Edit"><i class="ph ph-pencil"></i></button>
                <button class="action-btn danger hr-only" onclick="archiveEmp('${e.id}','${e.firstName} ${e.lastName}')" title="Archive"><i class="ph ph-archive"></i></button>
            </td>
        </tr>`).join('');
    applyRBAC();
}

function populateDeptFilter(emps) {
    const depts = [...new Set(emps.map(e => e.dept))].sort();
    const sel = document.getElementById('deptFilter');
    sel.innerHTML = '<option value="">All Departments</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
}

document.getElementById('empSearch').addEventListener('input', filterEmployees);
document.getElementById('deptFilter').addEventListener('change', filterEmployees);
document.getElementById('statusFilter').addEventListener('change', filterEmployees);
function filterEmployees() {
    const q = document.getElementById('empSearch').value.toLowerCase();
    const dept = document.getElementById('deptFilter').value;
    const status = document.getElementById('statusFilter').value;
    const filtered = employees.filter(e =>
        (!q || `${e.firstName} ${e.lastName} ${e.email}`.toLowerCase().includes(q)) &&
        (!dept || e.dept === dept) &&
        (!status || e.status === status)
    );
    renderEmployeeTable(filtered);
}

document.getElementById('exportBtn').addEventListener('click', () => {
    const cols = ['firstName', 'lastName', 'email', 'role', 'dept', 'jobTitle', 'phone', 'status'];
    const csv = [cols.join(','), ...employees.map(e => cols.map(c => `"${e[c] || ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'employees.csv'; a.click();
    toast('Employee data exported', 'success');
});

// Employee Modal
async function openEmpModal(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    currentEmpId = id;
    const isHR = ['admin', 'hr_manager', 'hr_officer'].includes(currentUser.role);

    document.getElementById('empModalTitle').textContent = isHR ? 'Edit Employee Record' : 'View Employee Record';
    document.getElementById('empModalAvatar').src = `https://ui-avatars.com/api/?name=${emp.firstName}+${emp.lastName}&background=6366f1&color=fff`;
    document.getElementById('empModalFullName').textContent = `${emp.firstName} ${emp.lastName}`;
    document.getElementById('empModalJobTitle').textContent = `${emp.jobTitle} — ${emp.dept}`;

    const fields = ['firstName', 'lastName', 'email', 'phone', 'dept', 'jobTitle', 'dateOfBirth', 'dateJoined', 'emergencyContact', 'address', 'role', 'status', 'education', 'qualifications', 'certifications', 'certExpiryDate', 'workExperience', 'skills', 'languages'];
    const HR_LOCKED = ['firstName', 'lastName', 'email']; // Always locked except for Super Admin
    const EMPLOYEE_ALLOWED = ['phone', 'emergencyContact', 'qualifications', 'certifications', 'certExpiryDate', 'skills', 'languages', 'education', 'workExperience'];

    fields.forEach(f => {
        const el = document.getElementById(`ef-${f}`);
        if (!el) return;
        el.value = emp[f] || '';
        if (isHR) {
            el.disabled = HR_LOCKED.includes(f) && currentUser.role !== 'admin';
            el.classList.toggle('locked', HR_LOCKED.includes(f) && currentUser.role !== 'admin');
        } else {
            el.disabled = !EMPLOYEE_ALLOWED.includes(f);
            el.classList.toggle('locked', !EMPLOYEE_ALLOWED.includes(f));
        }
    });

    // Switch to first tab
    switchTab('tab-personal');
    openModal('empModal');
}

function switchTab(tabId) {
    document.querySelectorAll('.modal-tab-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tabId).style.display = 'block';
    document.querySelector(`.modal-tab[data-tab="${tabId}"]`).classList.add('active');
}
document.querySelectorAll('.modal-tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

document.getElementById('saveEmpBtn').addEventListener('click', async () => {
    if (!currentEmpId) return;
    const isHR = ['admin', 'hr_manager', 'hr_officer'].includes(currentUser.role);
    const fields = ['phone', 'dept', 'jobTitle', 'dateOfBirth', 'dateJoined', 'emergencyContact', 'address', 'role', 'status', 'education', 'qualifications', 'certifications', 'certExpiryDate', 'workExperience', 'skills', 'languages'];
    const body = {};
    fields.forEach(f => { const el = document.getElementById(`ef-${f}`); if (el && !el.disabled) body[f] = el.value; });
    const { ok, data } = await api('PUT', `/api/employees/${currentEmpId}`, body);
    if (ok) {
        toast(isHR ? 'Profile updated successfully' : `${Object.keys(body).length} change request(s) submitted for approval`, 'success');
        closeModal('empModal');
        loadEmployees();
    } else {
        toast(data.error || 'Failed to save', 'error');
    }
});

async function archiveEmp(id, name) {
    if (!confirm(`Archive ${name}? They will no longer be able to log in.`)) return;
    const { ok } = await api('DELETE', `/api/employees/${id}`);
    if (ok) { toast(`${name} archived`, 'success'); loadEmployees(); }
    else toast('Failed to archive', 'error');
}

document.getElementById('addEmpBtn').addEventListener('click', () => {
    // Pre-fill empty modal for creating new employee
    currentEmpId = '__new__';
    document.getElementById('empModalTitle').textContent = 'Add New Employee';
    document.getElementById('empModalAvatar').src = 'https://ui-avatars.com/api/?name=New+Employee&background=6366f1&color=fff';
    document.getElementById('empModalFullName').textContent = 'New Employee';
    document.getElementById('empModalJobTitle').textContent = 'New Hire';
    ['firstName', 'lastName', 'email', 'phone', 'dept', 'jobTitle', 'dateOfBirth', 'dateJoined', 'emergencyContact', 'address', 'role', 'status', 'education', 'qualifications', 'certifications', 'certExpiryDate', 'workExperience', 'skills', 'languages'].forEach(f => {
        const el = document.getElementById(`ef-${f}`);
        if (el) { el.value = ''; el.disabled = false; el.classList.remove('locked'); }
    });
    switchTab('tab-personal');
    openModal('empModal');
});

// Override saveEmpBtn for create mode
const origSaveEmpClick = document.getElementById('saveEmpBtn').onclick;
document.getElementById('saveEmpBtn').addEventListener('click', async () => {
    if (currentEmpId !== '__new__') return;
    const body = {};
    ['firstName', 'lastName', 'email', 'phone', 'dept', 'jobTitle', 'dateOfBirth', 'dateJoined', 'role', 'status'].forEach(f => { const el = document.getElementById(`ef-${f}`); if (el) body[f] = el.value; });
    body.password = 'Welcome@1234'; // Default password
    const { ok, data } = await api('POST', '/api/employees', body);
    if (ok) { toast('Employee created! Default password: Welcome@1234', 'success'); closeModal('empModal'); loadEmployees(); }
    else toast(data.error || 'Failed to create', 'error');
});

// ─── Approvals ────────────────────────────────────────────────────────────────
async function loadApprovals() {
    const status = document.getElementById('approvalStatusFilter').value;
    const url = status ? `/api/approvals?status=${status}` : '/api/approvals';
    const { ok, data } = await api('GET', url);
    if (!ok) return;
    const badge = document.getElementById('approvalBadge');
    const pending = data.filter(r => r.status === 'pending');
    if (pending.length) { badge.textContent = pending.length; badge.style.display = 'flex'; }
    else badge.style.display = 'none';

    const body = document.getElementById('approvalTableBody');
    if (!data.length) { body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">No requests found</td></tr>'; return; }
    body.innerHTML = data.map(r => `
        <tr>
            <td><div class="emp-cell">
                <img src="https://ui-avatars.com/api/?name=${r.user.firstName}+${r.user.lastName}&background=random&color=fff" class="avatar avatar-sm">
                <div><div class="emp-name">${r.user.firstName} ${r.user.lastName}</div><div class="emp-id">${r.user.dept}</div></div>
            </div></td>
            <td style="font-size:0.82rem;">${r.fieldLabel}</td>
            <td style="font-size:0.82rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.newValue}</td>
            <td style="font-size:0.78rem;color:var(--text-secondary);">${timeAgo(r.createdAt)}</td>
            <td><span class="status-badge ${r.status}">${r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span></td>
            <td>${r.status === 'pending' ? `
                <button class="btn btn-primary btn-sm" onclick="reviewApproval('${r.id}','approve')"><i class="ph ph-check"></i></button>
                <button class="btn btn-danger btn-sm" onclick="reviewApproval('${r.id}','deny')"><i class="ph ph-x"></i></button>` : `<span style="font-size:0.78rem;color:var(--text-muted)">Reviewed by ${r.reviewedBy || '—'}</span>`
            }</td>
        </tr>`).join('');
}

async function reviewApproval(id, action) {
    const note = action === 'deny' ? prompt('Reason for denial (optional):') || '' : '';
    const { ok, data } = await api('PUT', `/api/approvals/${id}`, { action, reviewNote: note });
    if (ok) { toast(`Request ${action}d`, 'success'); loadApprovals(); }
    else toast(data.error || 'Failed', 'error');
}

document.getElementById('approvalStatusFilter').addEventListener('change', loadApprovals);

// ─── Tasks ────────────────────────────────────────────────────────────────────
async function loadTasks() {
    const { ok, data } = await api('GET', '/api/tasks');
    if (!ok) return toast('Failed to load tasks', 'error');
    tasks = data;
    renderTasks(tasks);
}

function renderTasks(list) {
    const body = document.getElementById('taskTableBody');
    if (!list.length) { body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">No tasks found</td></tr>'; return; }
    body.innerHTML = list.map(t => `
        <tr>
            <td><div style="font-size:0.85rem;font-weight:500;">${t.title}</div><div style="font-size:0.75rem;color:var(--text-muted);">${t.description || ''}</div></td>
            <td><div style="font-size:0.82rem;">${t.assignedTo.firstName} ${t.assignedTo.lastName}</div><span class="dept-pill">${t.assignedTo.dept}</span></td>
            <td><span class="priority-badge ${t.priority}">${t.priority.charAt(0).toUpperCase() + t.priority.slice(1)}</span></td>
            <td style="font-size:0.8rem;color:var(--text-secondary);">${t.deadline ? formatDate(t.deadline) : '—'}</td>
            <td><select class="modern-select" style="font-size:0.78rem;padding:4px 8px;" onchange="updateTaskStatus('${t.id}',this.value)">
                <option value="pending" ${t.status==='pending'?'selected':''}>Pending</option>
                <option value="in_progress" ${t.status==='in_progress'?'selected':''}>In Progress</option>
                <option value="completed" ${t.status==='completed'?'selected':''}>Completed</option>
            </select></td>
            <td><button class="action-btn danger manager-only" onclick="deleteTask('${t.id}')" title="Delete"><i class="ph ph-trash"></i></button></td>
        </tr>`).join('');
    applyRBAC();
}

async function updateTaskStatus(id, status) {
    const { ok } = await api('PUT', `/api/tasks/${id}`, { status });
    if (ok) toast(`Task marked as ${status.replace('_', ' ')}`, 'success');
    else toast('Failed to update task', 'error');
}
async function deleteTask(id) {
    if (!confirm('Delete this task?')) return;
    const { ok } = await api('DELETE', `/api/tasks/${id}`);
    if (ok) { toast('Task deleted', 'success'); loadTasks(); }
}

document.getElementById('taskStatusFilter').addEventListener('change', () => {
    const s = document.getElementById('taskStatusFilter').value;
    const p = document.getElementById('taskPriorityFilter').value;
    renderTasks(tasks.filter(t => (!s || t.status === s) && (!p || t.priority === p)));
});
document.getElementById('taskPriorityFilter').addEventListener('change', () => {
    const s = document.getElementById('taskStatusFilter').value;
    const p = document.getElementById('taskPriorityFilter').value;
    renderTasks(tasks.filter(t => (!s || t.status === s) && (!p || t.priority === p)));
});

document.getElementById('addTaskBtn').addEventListener('click', async () => {
    const { ok, data } = await api('GET', '/api/employees');
    if (ok) {
        document.getElementById('tf-assignedTo').innerHTML = data.filter(e => e.status === 'active').map(e => `<option value="${e.id}">${e.firstName} ${e.lastName} (${e.dept})</option>`).join('');
    }
    openModal('taskModal');
});

document.getElementById('saveTaskBtn').addEventListener('click', async () => {
    const body = { title: document.getElementById('tf-title').value, description: document.getElementById('tf-description').value, assignedToId: document.getElementById('tf-assignedTo').value, priority: document.getElementById('tf-priority').value, deadline: document.getElementById('tf-deadline').value };
    if (!body.title || !body.assignedToId) return toast('Title and assignee required', 'error');
    const { ok, data } = await api('POST', '/api/tasks', body);
    if (ok) { toast('Task assigned', 'success'); closeModal('taskModal'); loadTasks(); }
    else toast(data.error || 'Failed', 'error');
});

// ─── Calendar ─────────────────────────────────────────────────────────────────
async function renderCalendar() {
    if (!calendarEvents.length) {
        const { ok, data } = await api('GET', '/api/events');
        if (ok) calendarEvents = data;
    }
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    document.getElementById('calMonthLabel').textContent = `${monthNames[calMonth]} ${calYear}`;

    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    let html = '';
    for (let i = 0; i < firstDay; i++) html += '<div class="cal-day other-month"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isToday = dateStr === todayStr ? 'today' : '';
        const dayEvents = calendarEvents.filter(e => e.date && e.date.startsWith(dateStr));
        const evHTML = dayEvents.slice(0,2).map(e => `<div class="cal-event-pill ${e.type}">${e.title.length > 14 ? e.title.slice(0,13) + '…' : e.title}</div>`).join('');
        html += `<div class="cal-day ${isToday}"><div class="cal-date">${d}</div>${evHTML}</div>`;
    }
    document.getElementById('calGrid').innerHTML = html;
}

document.getElementById('calPrev').addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
document.getElementById('calNext').addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
document.getElementById('addEventBtn').addEventListener('click', () => { openModal('eventModal'); });
document.getElementById('saveEventBtn').addEventListener('click', async () => {
    const body = { title: document.getElementById('evf-title').value, type: document.getElementById('evf-type').value, date: document.getElementById('evf-date').value, description: document.getElementById('evf-description').value };
    if (!body.title || !body.date) return toast('Title and date required', 'error');
    const { ok } = await api('POST', '/api/events', body);
    if (ok) { toast('Event added', 'success'); calendarEvents = []; closeModal('eventModal'); renderCalendar(); }
    else toast('Failed to add event', 'error');
});

// ─── Chat (Socket.io) ─────────────────────────────────────────────────────────
function initChat() {
    if (!socket) {
        socket = io({ auth: { token } });
        socket.on('new-message', appendChatMsg);
        socket.on('connect_error', () => console.error('Socket.io connection error'));
    }
    switchChannel(currentChannel);
    loadSideTasks();
    loadDMs();
}

function switchChannel(channel) {
    currentChannel = channel;
    document.querySelectorAll('.chat-channel').forEach(c => c.classList.toggle('active', c.dataset.channel === channel));
    document.getElementById('chatChannelName').textContent = `# ${channel}`;
    document.getElementById('chatInput').placeholder = `Message #${channel} (encrypted)...`;
    document.getElementById('chatMessages').innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:0.82rem;text-align:center;">Loading messages...</div>';
    if (socket) socket.emit('join-channel', channel);
    loadMessages(channel);
}

async function loadMessages(channel) {
    const { ok, data } = await api('GET', `/api/messages/${encodeURIComponent(channel)}`);
    const div = document.getElementById('chatMessages');
    if (!ok || !data.length) { div.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:0.82rem;text-align:center;">No messages yet. Say hello! 👋</div>'; return; }
    div.innerHTML = data.map(m => chatMsgHTML(m)).join('');
    div.scrollTop = div.scrollHeight;
}

function chatMsgHTML(m) {
    const name = m.sender ? `${m.sender.firstName} ${m.sender.lastName}` : 'Unknown';
    return `<div class="chat-msg">
        <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff" class="avatar avatar-sm">
        <div>
            <div class="chat-msg-header"><span class="chat-msg-name">${name}</span><span class="chat-msg-time">${timeAgo(m.createdAt)}</span></div>
            <div class="chat-msg-text">${m.content}</div>
        </div>
    </div>`;
}

function appendChatMsg(m) {
    if (m.channel !== currentChannel) return;
    const div = document.getElementById('chatMessages');
    div.insertAdjacentHTML('beforeend', chatMsgHTML(m));
    div.scrollTop = div.scrollHeight;
}

document.getElementById('chatSendBtn').addEventListener('click', sendChatMsg);
document.getElementById('chatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendChatMsg(); });
function sendChatMsg() {
    const input = document.getElementById('chatInput');
    const content = input.value.trim();
    if (!content || !socket) return;
    socket.emit('send-message', { channel: currentChannel, content });
    input.value = '';
}

document.querySelectorAll('.chat-channel[data-channel]').forEach(ch => ch.addEventListener('click', () => switchChannel(ch.dataset.channel)));

async function loadDMs() {
    const { ok, data } = await api('GET', '/api/employees');
    if (!ok) return;
    const dmList = document.getElementById('dmList');
    const others = data.filter(e => e.id !== currentUser.id && e.status === 'active').slice(0, 5);
    dmList.innerHTML = others.map(e => `<div class="chat-channel" data-channel="dm_${e.id}" onclick="switchChannel('dm_${currentUser.id}_${e.id}')">
        <span class="online-dot online"></span> ${e.firstName} ${e.lastName}</div>`).join('');
}

async function loadSideTasks() {
    const { ok, data } = await api('GET', '/api/tasks');
    if (!ok) return;
    const myTasks = data.filter(t => t.status !== 'completed').slice(0, 5);
    document.getElementById('sideTaskList').innerHTML = myTasks.map(t => `
        <div class="task-card">
            <span class="priority-badge ${t.priority}">${t.priority}</span>
            <div class="task-title">${t.title}</div>
            <div class="task-meta">${t.assignedTo.firstName} · ${t.deadline ? formatDate(t.deadline) : 'No deadline'}</div>
        </div>`).join('') || '<div style="color:var(--text-muted);font-size:0.82rem;">No open tasks</div>';
}

// ─── Reports ──────────────────────────────────────────────────────────────────
async function loadReports() {
    const { ok, data } = await api('GET', '/api/reports/summary');
    if (!ok) return;

    document.getElementById('reportStats').innerHTML = `
        <div class="stat-card"><div class="stat-icon purple"><i class="ph ph-users-three"></i></div><div><div class="stat-value">${data.totalEmployees}</div><div class="stat-label">Total Employees</div></div></div>
        <div class="stat-card"><div class="stat-icon green"><i class="ph ph-check-circle"></i></div><div><div class="stat-value">${data.activeEmployees}</div><div class="stat-label">Active</div></div></div>
        <div class="stat-card"><div class="stat-icon orange"><i class="ph ph-clock"></i></div><div><div class="stat-value">${data.pendingApprovals}</div><div class="stat-label">Pending Approvals</div></div></div>
        <div class="stat-card"><div class="stat-icon cyan"><i class="ph ph-clipboard-text"></i></div><div><div class="stat-value">${data.completedTasks}/${data.totalTasks}</div><div class="stat-label">Tasks Completed</div></div></div>`;

    const maxCount = Math.max(...data.deptDist.map(d => d._count.dept), 1);
    document.getElementById('deptChart').innerHTML = data.deptDist.map(d => `
        <div class="bar-wrap">
            <div class="bar" style="height:${Math.max(10, (d._count.dept / maxCount) * 100)}%;"></div>
            <div class="bar-label">${d.dept.split(' ')[0]}<br>${d._count.dept}</div>
        </div>`).join('');

    const authData = data.recentAuth || [];
    const success = authData.filter(l => l.type === 'AUTH_SUCCESS').length;
    const failed = authData.filter(l => l.type === 'AUTH_FAILED').length;
    document.getElementById('authChart').innerHTML = `
        <div class="stat-row"><span class="stat-row-dot" style="background:var(--success)"></span> Successful Logins: <strong>${success}</strong></div>
        <div class="stat-row"><span class="stat-row-dot" style="background:var(--danger)"></span> Failed Attempts: <strong>${failed}</strong></div>
        <div class="stat-row"><span class="stat-row-dot" style="background:var(--warning)"></span> On Leave: <strong>${data.onLeave}</strong></div>
        <div class="stat-row"><span class="stat-row-dot" style="background:var(--text-muted)"></span> Archived: <strong>${data.archived}</strong></div>`;
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────
async function loadAudit() {
    const type = document.getElementById('auditTypeFilter').value;
    const url = type ? `/api/audit?type=${type}` : '/api/audit';
    const { ok, data } = await api('GET', url);
    if (!ok) return toast('Access denied to audit logs', 'error');

    const body = document.getElementById('auditTableBody');
    if (!data.length) { body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">No audit entries found</td></tr>'; return; }
    body.innerHTML = data.map(log => `
        <tr>
            <td style="font-size:0.78rem;color:var(--text-secondary);white-space:nowrap;">${new Date(log.createdAt).toLocaleString()}</td>
            <td><span class="status-badge ${log.type.includes('SUCCESS') ? 'approved' : log.type.includes('FAIL') ? 'denied' : 'pending'}">${log.type}</span></td>
            <td style="font-size:0.78rem;">${log.user ? `${log.user.firstName} ${log.user.lastName}` : 'Anonymous'}</td>
            <td style="font-family:monospace;font-size:0.75rem;">${log.ipAddress || '—'}</td>
            <td style="font-size:0.78rem;color:var(--text-secondary);">${log.details}</td>
        </tr>`).join('');
}

document.getElementById('auditTypeFilter').addEventListener('change', loadAudit);

// ─── Self-Service ─────────────────────────────────────────────────────────────
async function loadSelfService() {
    const { ok, data } = await api('GET', `/api/employees/${currentUser.id}`);
    if (!ok) return;

    document.getElementById('myProfileInfo').innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
            <img src="https://ui-avatars.com/api/?name=${data.firstName}+${data.lastName}&background=6366f1&color=fff" class="avatar avatar-xl">
            <div>
                <div style="font-size:1.1rem;font-weight:600;">${data.firstName} ${data.lastName}</div>
                <div style="font-size:0.82rem;color:var(--text-secondary);">${data.jobTitle} — ${data.dept}</div>
                <span class="status-badge ${data.status}" style="margin-top:6px;display:inline-flex;">${data.status}</span>
            </div>
        </div>
        ${profileField('Email', data.email)}
        ${profileField('Phone', data.phone)}
        ${profileField('Emergency Contact', data.emergencyContact)}
        ${profileField('Date of Birth', data.dateOfBirth ? formatDate(data.dateOfBirth) : '—')}
        ${profileField('Date Joined', data.dateJoined ? formatDate(data.dateJoined) : '—')}
        ${profileField('Skills', data.skills)}
        ${profileField('Certifications', data.certifications)}
        ${profileField('Languages', data.languages)}
        ${profileField('Education', data.education)}`;

    const reqRes = await api('GET', '/api/approvals');
    if (reqRes.ok) {
        const myReqs = reqRes.data.filter(r => r.userId === currentUser.id);
        document.getElementById('myRequestsBody').innerHTML = myReqs.length ? myReqs.map(r => `
            <tr>
                <td style="font-size:0.82rem;">${r.fieldLabel}</td>
                <td style="font-size:0.78rem;color:var(--text-secondary);max-width:140px;overflow:hidden;text-overflow:ellipsis;">${r.newValue}</td>
                <td><span class="status-badge ${r.status}">${r.status}</span></td>
                <td style="font-size:0.75rem;color:var(--text-muted);">${timeAgo(r.createdAt)}</td>
            </tr>`).join('')
            : '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text-muted);font-size:0.82rem;">No change requests submitted</td></tr>';
    }
}

function profileField(label, value) {
    return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.83rem;">
        <span style="color:var(--text-muted);">${label}</span>
        <span style="text-align:right;max-width:55%;">${value || '—'}</span></div>`;
}

document.getElementById('editMyProfileBtn').addEventListener('click', async () => {
    const { ok, data } = await api('GET', `/api/employees/${currentUser.id}`);
    if (!ok) return;
    employees = [data]; // Put in employees array for modal
    openEmpModal(data.id);
});

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
    const { ok, data } = await api('GET', '/api/auth/me');
    if (!ok) return;
    updateMfaUI(data.mfaEnabled);
}

function updateMfaUI(enabled) {
    const statusEl = document.getElementById('mfaStatusText');
    const toggleBtn = document.getElementById('toggleMfaBtn');
    if (enabled) {
        statusEl.textContent = 'Enabled ✓';
        statusEl.style.color = 'var(--success)';
        toggleBtn.innerHTML = '<i class="ph ph-shield-slash"></i> Disable MFA';
        toggleBtn.className = 'btn btn-danger btn-sm';
    } else {
        statusEl.textContent = 'Disabled';
        statusEl.style.color = 'var(--warning)';
        toggleBtn.innerHTML = '<i class="ph ph-qr-code"></i> Enable MFA';
        toggleBtn.className = 'btn btn-primary btn-sm';
    }
}

document.getElementById('changePwdForm').addEventListener('submit', async e => {
    e.preventDefault();
    const curr = document.getElementById('currentPwd').value;
    const nw = document.getElementById('newPwd').value;
    const cf = document.getElementById('confirmPwd').value;
    if (nw !== cf) return toast('New passwords do not match', 'error');
    if (nw.length < 8) return toast('Password must be at least 8 characters', 'error');
    const { ok, data } = await api('POST', '/api/auth/change-password', { currentPassword: curr, newPassword: nw });
    if (ok) { toast('Password changed successfully', 'success'); document.getElementById('changePwdForm').reset(); }
    else toast(data.error || 'Failed to change password', 'error');
});

document.getElementById('toggleMfaBtn').addEventListener('click', async () => {
    const { ok, data } = await api('GET', '/api/auth/me');
    if (!ok) return;

    if (data.mfaEnabled) {
        // Disable MFA — requires password
        const pwd = prompt('Enter your current password to disable MFA:');
        if (!pwd) return;
        const r = await api('POST', '/api/auth/mfa/disable', { password: pwd });
        if (r.ok) {
            toast('MFA disabled. Your account no longer requires a verification code.', 'success');
            updateMfaUI(false);
        } else {
            toast(r.data.error || 'Failed to disable MFA', 'error');
        }
        return;
    }

    // Enable MFA — show QR code setup panel
    const settingsCard = document.getElementById('toggleMfaBtn').closest('.card-body');
    let setupPanel = document.getElementById('mfaSetupPanel');
    if (setupPanel) { setupPanel.remove(); return; }

    // Show loading
    setupPanel = document.createElement('div');
    setupPanel.id = 'mfaSetupPanel';
    setupPanel.style.cssText = 'margin-top:20px;padding:20px;background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.2);border-radius:12px;';
    setupPanel.innerHTML = '<div style="text-align:center;padding:20px;"><i class="ph ph-spinner ph-spin" style="font-size:2rem;color:var(--accent)"></i><p style="margin-top:8px;color:var(--text-muted);font-size:0.83rem;">Generating secure QR code...</p></div>';
    settingsCard.appendChild(setupPanel);

    const { ok: qrOk, data: qrData } = await api('GET', '/api/auth/mfa/setup');
    if (!qrOk) { toast('Failed to generate QR code', 'error'); setupPanel.remove(); return; }

    setupPanel.innerHTML = `
        <div style="font-size:0.9rem;font-weight:600;margin-bottom:12px;"><i class="ph ph-qr-code" style="color:var(--accent);"></i> Scan with your Authenticator App</div>
        <ol style="font-size:0.8rem;color:var(--text-secondary);margin:0 0 16px 16px;line-height:2;">
            <li>Download <strong>Google Authenticator</strong>, <strong>Authy</strong>, or <strong>Microsoft Authenticator</strong></li>
            <li>Tap <strong>"Add account"</strong> → <strong>"Scan QR code"</strong></li>
            <li>Scan the code below, then enter the 6-digit code to confirm</li>
        </ol>
        <div style="text-align:center;margin:16px 0;">
            <img src="${qrData.qrCode}" alt="MFA QR Code" style="width:180px;height:180px;border-radius:12px;border:3px solid var(--accent);">
        </div>
        <details style="margin-bottom:16px;">
            <summary style="font-size:0.78rem;color:var(--text-muted);cursor:pointer;">Can't scan? Enter code manually</summary>
            <code style="display:block;margin-top:8px;padding:8px;background:var(--bg-main);border-radius:6px;font-size:0.75rem;word-break:break-all;letter-spacing:0.1em;">${qrData.manualEntry}</code>
        </details>
        <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label">Enter 6-digit code to confirm setup</label>
            <input type="text" class="form-input" id="mfaConfirmCode" maxlength="6" placeholder="000000" inputmode="numeric" autocomplete="one-time-code" style="letter-spacing:0.3em;font-size:1.1rem;text-align:center;">
        </div>
        <div style="display:flex;gap:10px;">
            <button class="btn btn-primary" id="confirmMfaSetupBtn"><i class="ph ph-check-circle"></i> Activate MFA</button>
            <button class="btn btn-secondary" onclick="document.getElementById('mfaSetupPanel').remove()">Cancel</button>
        </div>
        <div id="mfaSetupError" style="display:none;margin-top:10px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px;font-size:0.8rem;color:#fca5a5;"></div>
    `;

    document.getElementById('confirmMfaSetupBtn').addEventListener('click', async () => {
        const code = document.getElementById('mfaConfirmCode').value.trim();
        if (code.length !== 6 || !/^\d+$/.test(code)) {
            document.getElementById('mfaSetupError').style.display = 'block';
            document.getElementById('mfaSetupError').textContent = 'Please enter the 6-digit numeric code from your app.';
            return;
        }
        const btn = document.getElementById('confirmMfaSetupBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Verifying...';
        const r = await api('POST', '/api/auth/mfa/verify-setup', { code });
        if (r.ok) {
            toast('🔐 MFA enabled! Your account is now protected.', 'success');
            setupPanel.remove();
            updateMfaUI(true);
            currentUser.mfaEnabled = true;
        } else {
            document.getElementById('mfaSetupError').style.display = 'block';
            document.getElementById('mfaSetupError').textContent = r.data.error || 'Invalid code. Please check your authenticator app and try again.';
            btn.disabled = false;
            btn.innerHTML = '<i class="ph ph-check-circle"></i> Activate MFA';
        }
    });

    // Auto-focus the input
    setTimeout(() => document.getElementById('mfaConfirmCode')?.focus(), 100);
});

// ─── Global Search ────────────────────────────────────────────────────────────
document.getElementById('globalSearch').addEventListener('input', async (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q || q.length < 2) return;
    if (!employees.length) { const r = await api('GET', '/api/employees'); if (r.ok) employees = r.data; }
    const found = employees.filter(emp => `${emp.firstName} ${emp.lastName} ${emp.email} ${emp.dept}`.toLowerCase().includes(q));
    if (found.length) { navigate('employees'); setTimeout(() => { document.getElementById('empSearch').value = q; filterEmployees(); }, 100); }
});

// ─── Utility ──────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
    if (!dateStr) return '—';
    const diff = (Date.now() - new Date(dateStr)) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}
function formatDate(s) {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return s; }
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
