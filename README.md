# PeopleSync - Secure HR Enterprise Resource Planning System

![PeopleSync Overview](https://img.shields.io/badge/Status-Completed-success) ![Node.js](https://img.shields.io/badge/Node.js-18.x-green) ![Express.js](https://img.shields.io/badge/Express.js-Backend-blue) ![Socket.io](https://img.shields.io/badge/Socket.io-Realtime-black)

PeopleSync is a robust, full-stack Secure Human Resources ERP platform built to streamline employee management, inter-departmental communication, and operational auditing. Designed with enterprise-grade security principles at its core, the system features Role-Based Access Control (RBAC), multi-factor authentication (MFA), real-time encrypted messaging, and immutable audit logging.

## 🌟 Key Features

* **Advanced Role-Based Access Control (RBAC)**: 7 distinct hierarchical roles (Super Admin, HR Manager, HR Officer, Dept Manager, Team Leader, Employee, Auditor) ensuring strict data isolation.
* **Real-Time Communication**: End-to-end simulated encrypted department channels and direct messaging powered by `Socket.io`.
* **Multi-Factor Authentication (MFA)**: Integrated TOTP-based Two-Factor Authentication using `speakeasy` and `qrcode` for Google Authenticator/Authy.
* **Employee Lifecycle Management**: Full CRUD capabilities for employee records, skills, and documentation with HR approval workflows for profile modifications.
* **Immutable Audit Logging**: Comprehensive tracking of authentication events, profile modifications, and data exports.
* **Interactive Dashboard & Reporting**: Visual metrics for department distributions, task completion rates, and security events.
* **Security Hardened**: Implemented `Helmet.js` for HTTP headers, `express-rate-limit` for brute-force protection, account lockouts, and strict JWT validation.

## 🛠️ Technology Stack

* **Frontend**: Vanilla HTML/CSS/JavaScript with a custom premium dark-mode design system. No heavy frameworks, purely optimized DOM manipulation.
* **Backend**: Node.js & Express.js.
* **Database**: SQLite managed via Prisma ORM for type-safe and injection-proof queries.
* **Real-Time**: Socket.io for WebSocket communication.
* **Security**: `bcryptjs` (password hashing), `jsonwebtoken` (session handling), `speakeasy` (TOTP MFA), `express-rate-limit`.

## 🚀 Getting Started

### Prerequisites
Make sure you have Node.js (v16 or newer) installed.

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/peoplesync-hr-erp.git
   cd peoplesync-hr-erp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Initialize the Database**
   This will create the SQLite database and apply the Prisma schema.
   ```bash
   npx prisma db push
   ```

4. **Seed the Database (Important)**
   This populates the database with the 7 roles, sample employees, and mock audit data so you can test the system immediately.
   ```bash
   node seed.js
   ```

5. **Start the Server**
   ```bash
   npm start
   ```
   The application will be running at `http://localhost:8080`

## 🔐 Demo Credentials

The `seed.js` script provisions the following accounts. All default passwords follow the pattern `[Role]@1234`.

| Role | Email | Password |
|---|---|---|
| **Super Administrator** | `admin@peoplesync.com` | `Admin@1234` |
| **HR Manager** | `hrmanager@peoplesync.com` | `Hr@1234` |
| **HR Officer** | `hrofficer@peoplesync.com` | `Hr@1234` |
| **Department Manager** | `deptmanager@peoplesync.com` | `Manager@1234` |
| **Team Leader** | `teamlead@peoplesync.com` | `Lead@1234` |
| **Employee** | `employee@peoplesync.com` | `Emp@1234` |
| **Auditor** | `auditor@peoplesync.com` | `Audit@1234` |

## 📸 Screenshots

*(You can add screenshots of your UI here. E.g., Dashboard, MFA Setup, Chat Interface, Employee Directory)*

## 🛡️ Security Implementations

* **XSS Protection**: Inputs sanitized before rendering. CSP headers enforced via Helmet.
* **SQL Injection Prevention**: All queries parameterized through Prisma ORM.
* **Brute Force Protection**: Accounts are locked for 15 minutes after 5 consecutive failed login attempts.
* **MFA**: Configurable TOTP application integration per user.

## 📄 License
This project is for educational and portfolio purposes. Feel free to use and modify it as you see fit.
