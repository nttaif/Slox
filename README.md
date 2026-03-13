<div align="center">

```
███████╗██╗      ██████╗ ██╗  ██╗
██╔════╝██║     ██╔═══██╗╚██╗██╔╝
███████╗██║     ██║   ██║ ╚███╔╝ 
╚════██║██║     ██║   ██║ ██╔██╗ 
███████║███████╗╚██████╔╝██╔╝ ██╗
╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝
```

**slox-api — NestJS Backend**

*REST API · Multi-tenant Booking & Scheduling SaaS*

[![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white)](https://nestjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://prisma.io)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![BullMQ](https://img.shields.io/badge/BullMQ-FF3D00?style=flat-square&logo=bull&logoColor=white)](https://docs.bullmq.io)

[Features](#-features) · [Architecture](#-architecture) · [Getting Started](#-getting-started) · [API Docs](#-api-docs) · [Deployment](#-deployment)

</div>

---

## 💡 Overview

`slox-api` là backend service cho **Slox** — B2B2C booking SaaS cho các doanh nghiệp dịch vụ tại Việt Nam (spa, phòng khám, studio...).

Frontend repo: [slox-web](https://github.com/yourusername/slox-web)

---

## ✨ Features

- 🏢 **Multi-tenant** — data hoàn toàn isolated theo từng business
- 🔒 **Zero double-booking** — Redis SETNX + PostgreSQL `SELECT FOR UPDATE`
- 📧 **Email OTP verification** — xác thực khách hàng không cần tài khoản
- 🔄 **Google Calendar 2-way sync** — tự động sync booking ↔ GCal
- 🔔 **Persistent reminders** — BullMQ delayed jobs, survive server restart
- 🌏 **Timezone-aware** — timestamps lưu UTC, hiển thị theo timezone của tenant

---

## 🏗 Architecture

```
┌──────────────────────────────────────┐
│           slox-web (Next.js)         │
└──────────────────┬───────────────────┘
                   │ REST API (HTTPS)
                   ▼
    ┌──────────────────────────────┐
    │      NestJS API Gateway      │
    │  JWT · TenantResolver · Rate │
    └────────┬─────────────────────┘
             │
   ┌──────────┼──────────┐
   ▼          ▼          ▼
┌──────┐  ┌────────┐  ┌──────────────┐
│ Auth │  │Booking │  │ Notification │
│      │  │Service │  │   Service    │
└──┬───┘  └───┬────┘  └──────┬───────┘
   │          │              │
   └──────────┼──────────────┘
              ▼
 ┌────────────────────────────┐
 │  PostgreSQL  │  Redis      │
 │  (Neon)      │  + BullMQ   │
 └────────────────────────────┘
              │
              ▼
     Google Calendar API
```

### Middleware Stack

Mọi request đi qua các layer sau theo thứ tự:

```
Request → LoggerMiddleware → TenantResolver → ThrottlerGuard → JwtAuthGuard → RolesGuard
```

- **TenantResolver** — extract `tenantId` từ JWT, inject vào tất cả requests
- **ThrottlerGuard** — 100 req/min per tenant (protected), 20 req/min per IP (public)
- **RolesGuard** — `owner > admin > member`

---

## 🗃 Database Schema

```
tenants
  ├── users           (role: OWNER | ADMIN | MEMBER)
  ├── services        (duration, bufferTime, price)
  ├── staff
  │     ├── staff_services  (many-to-many)
  │     └── schedules
  │           ├── weeklyHours (JSONB)
  │           └── schedule_exceptions
  ├── bookings        (state machine)
  └── blocked_slots   (source: MANUAL | GOOGLE_CALENDAR)
```

**Booking state machine:**

```
pending_verification ──▶ confirmed ──▶ completed
         │                   │
         ▼                   ▼
      expired            cancelled / no_show
```

---

## 🔑 Key Technical Decisions

### Double-Booking Prevention

```
Customer A ──▶ Redis SETNX lock:slot:{hash} ──▶ OK   ──▶ PG FOR UPDATE ──▶ INSERT
Customer B ──▶ Redis SETNX lock:slot:{hash} ──▶ FAIL ──▶ 409 Conflict
```

- **Layer 1 — Redis SETNX**: Chặn concurrent requests ở ~1ms
- **Layer 2 — PostgreSQL `SELECT FOR UPDATE`**: ACID guarantee, safety net khi Redis miss

### Email OTP Flow

```
Submit booking → status: pending_verification
       ↓
Redis stores OTP (TTL 10 min, max 5 attempts)
       ↓
Customer nhập 6-digit code (không cần switch app)
       ↓
status: confirmed → reminders scheduled → GCal synced
```

### BullMQ Reminder Architecture

```typescript
// Khi booking confirmed — enqueue 2 delayed jobs
await reminder24hQueue.add('send', { bookingId }, { delay: startTime - now - 24h });
await reminder1hQueue.add('send',  { bookingId }, { delay: startTime - now - 1h  });

// Khi cancel — xóa cả 2 jobs ngay lập tức
await reminder24hQueue.remove(booking.reminder24hJobId);
await reminder1hQueue.remove(booking.reminder1hJobId);
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/slox-api.git
cd slox-api
npm install
```

### 2. Start Local Services

```bash
# PostgreSQL + Redis + Bull Board UI
docker-compose up -d
```

### 3. Configure Environment

```bash
cp .env.example .env
# Điền các giá trị vào .env (xem phần Environment Variables bên dưới)
```

### 4. Setup Database

```bash
# Apply migrations + generate Prisma client
npx prisma migrate dev

# (Optional) Seed demo data
npx prisma db seed

# (Optional) Mở Prisma Studio để inspect data
npx prisma studio
```

### 5. Run Development Server

```bash
npm run start:dev
```

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| Swagger Docs | http://localhost:3000/api |
| Bull Board (Queue Monitor) | http://localhost:3001 |
| Prisma Studio | http://localhost:5555 |

---

## ⚙️ Environment Variables

```bash
# ── Application ──────────────────────────────────────
NODE_ENV=development
PORT=3000

# ── Database ─────────────────────────────────────────
DATABASE_URL=postgresql://slox:slox_secret@localhost:5432/slox_dev

# ── Redis ────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── JWT ──────────────────────────────────────────────
JWT_SECRET=your-64-char-secret-here
JWT_REFRESH_SECRET=your-other-64-char-secret

# ── Google OAuth2 + Calendar ─────────────────────────
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
GOOGLE_WEBHOOK_URL=https://your-ngrok-url/webhooks/google-calendar

# ── Email ────────────────────────────────────────────
RESEND_API_KEY=re_xxxxxxxxxxxx

# ── Encryption (GCal tokens stored in DB) ────────────
ENCRYPTION_KEY=your-32-char-encryption-key

# ── Frontend ─────────────────────────────────────────
FRONTEND_URL=http://localhost:3100
```

> **Tip:** Dùng [ngrok](https://ngrok.com) để expose local server cho Google Calendar webhooks trong dev.

---

## 📡 API Docs

Swagger UI đầy đủ tại `/api` khi chạy local.

### Quick Reference

<details>
<summary><strong>Auth</strong></summary>

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Đăng ký business — tạo Tenant + User trong 1 transaction |
| `POST` | `/auth/login` | Login, nhận access (15min) + refresh (7d) token |
| `POST` | `/auth/refresh` | Rotate refresh token |
| `POST` | `/auth/logout` | Revoke tokens |
| `GET` | `/auth/google` | OAuth2 — kết nối Google Calendar |

</details>

<details>
<summary><strong>Business Management</strong> (JWT required)</summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET/PATCH` | `/business/profile` | Xem/cập nhật tenant settings |
| `GET/POST` | `/business/staff` | Danh sách/tạo nhân viên |
| `PATCH/DELETE` | `/business/staff/:id` | Cập nhật/xóa nhân viên |
| `GET/POST` | `/business/services` | Danh sách/tạo dịch vụ |
| `GET/PUT` | `/business/schedules/:staffId` | Xem/set lịch làm việc |
| `POST` | `/business/schedules/:staffId/exceptions` | Thêm ngày nghỉ hoặc giờ đặc biệt |
| `GET/PATCH` | `/business/bookings` | Danh sách bookings với filters, cập nhật status |

</details>

<details>
<summary><strong>Public Booking Flow</strong> (no auth)</summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/public/:slug` | Thông tin business |
| `GET` | `/public/:slug/services` | Danh sách dịch vụ active |
| `GET` | `/public/:slug/slots` | Slots trống (`?date`, `?serviceId`, `?staffId`) |
| `POST` | `/public/:slug/bookings` | Tạo booking → `pending_verification` |
| `POST` | `/public/bookings/:id/verify` | Submit OTP 6 chữ số |
| `POST` | `/public/bookings/:id/resend-otp` | Gửi lại OTP |
| `DELETE` | `/public/bookings/:cancelToken` | Hủy booking qua link email |

</details>

---

## 🧱 Project Structure

```
slox-api/
├── src/
│   ├── auth/                   JWT, OAuth2, token rotation
│   ├── business/               Protected routes (dashboard)
│   ├── public/                 Unauthenticated booking flow
│   ├── webhooks/               Google Calendar push notifications
│   ├── scheduling/             Slot engine + conflict detection
│   ├── notifications/          Email templates + BullMQ workers
│   └── common/                 Prisma, guards, interceptors, decorators
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docker-compose.yml
└── .env.example
```

---

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests (yêu cầu Docker services đang chạy)
npm run test:e2e

# Coverage report
npm run test:cov
```

---

## 🚢 Deployment

| Service | Provider | Plan |
|---|---|---|
| API + Workers | Railway | Starter ($5/mo credit) |
| PostgreSQL | Neon | Free (3GB) |
| Redis | Railway | Free (500MB) |
| Email | Resend | Free (3,000/mo) |
| CI/CD | GitHub Actions | Free (2,000 min/mo) |

```bash
# Migrations tự động chạy trong CI trước khi deploy
npx prisma migrate deploy
```

---

## 🧠 Architecture Decision Records

| # | Decision | Chosen | Reason |
|---|---|---|---|
| ADR-001 | Database | **PostgreSQL** | Relational model, `FOR UPDATE` native, Neon free tier 3GB |
| ADR-002 | ORM | **Prisma** | Type-safe, auto-migrations, Prisma Studio |
| ADR-003 | Conflict detection | **Redis + PG FOR UPDATE** | Redis = fast (99%), PG = ACID safety net |
| ADR-004 | Schedule storage | **Rule (JSONB)** | 1 row vs ~17,500 rows/staff/năm |
| ADR-005 | Customer verification | **OTP 6 digits** | Không cần switch app trên mobile |
| ADR-006 | Reminders | **BullMQ delayed jobs** | Per-booking precision, persist khi restart |

---

## 👤 Author

**Ngô Thanh Tài** — Backend Engineer · NestJS · PostgreSQL · Redis · BullMQ

[![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/yourusername)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://linkedin.com/in/yourprofile)

<sub>Built with ☕ in Ho Chi Minh City, Vietnam</sub>