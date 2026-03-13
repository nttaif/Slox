<div align="center">

<br/>

```
███████╗██╗      ██████╗ ██╗  ██╗
██╔════╝██║     ██╔═══██╗╚██╗██╔╝
███████╗██║     ██║   ██║ ╚███╔╝ 
╚════██║██║     ██║   ██║ ██╔██╗ 
███████║███████╗╚██████╔╝██╔╝ ██╗
╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝
```

**Multi-tenant Booking & Scheduling SaaS**

*Built for Vietnamese service businesses — spas, clinics, studios & more*

<br/>

[![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white)](https://nestjs.com)
[![Next.js](https://img.shields.io/badge/Next.js_14-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://prisma.io)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![BullMQ](https://img.shields.io/badge/BullMQ-FF3D00?style=flat-square&logo=bull&logoColor=white)](https://docs.bullmq.io)

<br/>

[Demo](#-demo) · [Features](#-features) · [Architecture](#-architecture) · [Getting Started](#-getting-started) · [API Docs](#-api-docs) · [ADRs](#-architecture-decisions)

<br/>

</div>

---

## 💡 What is Slox?

Slox is a **B2B2C booking SaaS** — think Calendly, but purpose-built for Vietnamese service businesses.

| Actor | Who | What they do |
|---|---|---|
| **Business Owner** | Spa owners, clinic managers, studio operators | Register, configure schedules, manage bookings |
| **End Customer** | Their clients | Book slots via a public URL — no account needed |

A business owner signs up once and gets a shareable booking page:

```
slox.io/book/spa-huong-quynh
```

Customers visit the link, pick a service, choose a time, verify their email with a 6-digit OTP — done. No app download, no account creation.

---

## ✨ Features

### For Business Owners
- 🏢 **Multi-tenant** — one platform, completely isolated data per business
- 📅 **Flexible schedules** — weekly recurring rules with holiday exceptions
- 🔄 **Google Calendar sync** — 2-way sync, never double-book across tools
- 📊 **Booking dashboard** — manage, filter, update booking status
- 👥 **Staff management** — multiple staff, each with their own schedule

### For End Customers
- ⚡ **60-second booking** — no account, no friction
- 📧 **Email OTP verification** — anti-spam without the hassle
- 🔔 **Auto reminders** — email at 24h and 1h before appointment
- 🔗 **Cancel via link** — one-click cancel from email, no login needed

### Under the Hood
- 🔒 **Zero double-booking** — Redis SETNX + PostgreSQL `SELECT FOR UPDATE`
- ⏰ **Persistent reminders** — BullMQ delayed jobs survive server restarts
- 🌏 **Timezone-aware** — all timestamps stored UTC, displayed in tenant timezone

---

## 🏗 Architecture

```
┌──────────────────┐    ┌──────────────────────────────────┐
│  Admin Dashboard │    │       Public Booking Page        │
│   (Next.js 14)   │    │  slox.io/book/:slug (Next.js 14) │
└────────┬─────────┘    └──────────────────┬───────────────┘
         │                                 │
         └──────────────┬──────────────────┘
                        │ REST API
                        ▼
         ┌──────────────────────────────┐
         │      NestJS API Gateway      │
         │  JWT · TenantResolver · Rate │
         └────────┬─────────────────────┘
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
  ┌─────────┐ ┌────────┐ ┌──────────────┐
  │  Auth   │ │Booking │ │ Notification │
  │ Service │ │Service │ │   Service    │
  └────┬────┘ └───┬────┘ └──────┬───────┘
       │          │             │
       └──────────┼─────────────┘
                  ▼
    ┌─────────────────────────────┐
    │  PostgreSQL  │  Redis       │
    │  (Neon)      │  + BullMQ    │
    └─────────────────────────────┘
                  │
                  ▼
         Google Calendar API
```

> 📄 See [SYSTEM_DESIGN.md](./docs/SYSTEM_DESIGN.md) for the full system design, workflows, and database schema.

---

## 🔑 Key Technical Decisions

### Double-Booking Prevention

Two-layer conflict detection ensures zero race conditions:

```
Customer A ──▶ Redis SETNX lock:slot:{hash}  ──▶ OK  ──▶ PG FOR UPDATE ──▶ INSERT
Customer B ──▶ Redis SETNX lock:slot:{hash}  ──▶ FAIL ──▶ 409 Conflict
```

- **Layer 1 — Redis SETNX**: Blocks concurrent requests at ~1ms, releases after booking completes
- **Layer 2 — PostgreSQL `SELECT FOR UPDATE`**: ACID guarantee at DB level, prevents any edge case Redis misses

### Email OTP Flow

Frictionless verification designed for mobile users:

```
Submit booking → status: pending_verification
       ↓
Redis stores OTP (TTL 10 min, max 5 attempts)
       ↓
Customer enters 6-digit code (no app switching)
       ↓
status: confirmed → reminders scheduled → GCal synced
```

### Reminder Architecture

```typescript
// On booking confirmed — enqueue two delayed jobs
await reminder24hQueue.add('send', { bookingId }, { delay: startTime - now - 24h });
await reminder1hQueue.add('send',  { bookingId }, { delay: startTime - now - 1h  });

// On cancellation — remove both jobs immediately
await reminder24hQueue.remove(booking.reminder24hJobId);
await reminder1hQueue.remove(booking.reminder1hJobId);
```

Jobs persist in Redis — survive server restarts, retry on failure with exponential backoff.

---

## 🗃 Database Schema

Built on **PostgreSQL + Prisma** for type-safe queries and automatic migrations.

```
tenants
  ├── users           (role: OWNER | ADMIN | MEMBER)
  ├── services        (duration, bufferTime, price)
  ├── staff
  │     ├── staff_services  (many-to-many junction)
  │     └── schedules
  │           ├── weeklyHours (JSONB)
  │           └── schedule_exceptions
  ├── bookings        (state machine: PENDING → CONFIRMED → COMPLETED)
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

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/slox.git
cd slox
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
# Edit .env with your values (see Environment Variables section below)
```

### 4. Setup Database

```bash
# Apply migrations + generate Prisma client
npx prisma migrate dev

# (Optional) Seed demo data
npx prisma db seed

# (Optional) Open Prisma Studio to inspect data
npx prisma studio
```

### 5. Run Development Server

```bash
# API server (NestJS)
npm run start:dev

# Frontend (Next.js) — in another terminal
cd apps/web && npm run dev
```

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| Swagger Docs | http://localhost:3000/api |
| Bull Board (Queue Monitor) | http://localhost:3001 |
| Prisma Studio | http://localhost:5555 |
| Frontend | http://localhost:3100 |

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

# ── Encryption (for GCal tokens stored in DB) ────────
ENCRYPTION_KEY=your-32-char-encryption-key

# ── Frontend ─────────────────────────────────────────
FRONTEND_URL=http://localhost:3100
```

> **Tip:** For Google Calendar webhooks in local dev, use [ngrok](https://ngrok.com) to expose your local server.

---

## 📡 API Docs

Full Swagger documentation available at `/api` when running locally.

### Quick Reference

<details>
<summary><strong>Auth</strong></summary>

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Register business — creates Tenant + User in one transaction |
| `POST` | `/auth/login` | Login, receive access (15min) + refresh (7d) tokens |
| `POST` | `/auth/refresh` | Rotate refresh token |
| `POST` | `/auth/logout` | Revoke tokens |
| `GET` | `/auth/google` | OAuth2 — connect Google Calendar |

</details>

<details>
<summary><strong>Business Management</strong> (JWT required)</summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET/PATCH` | `/business/profile` | View/update tenant settings |
| `GET/POST` | `/business/staff` | List/create staff |
| `PATCH/DELETE` | `/business/staff/:id` | Update/remove staff |
| `GET/POST` | `/business/services` | List/create services |
| `GET/PUT` | `/business/schedules/:staffId` | View/set working hours |
| `POST` | `/business/schedules/:staffId/exceptions` | Add holiday or custom hours |
| `GET/PATCH` | `/business/bookings` | List bookings with filters, update status |

</details>

<details>
<summary><strong>Public Booking Flow</strong> (no auth)</summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/public/:slug` | Business info |
| `GET` | `/public/:slug/services` | Active services list |
| `GET` | `/public/:slug/slots` | Available slots (`?date`, `?serviceId`, `?staffId`) |
| `POST` | `/public/:slug/bookings` | Create booking → `pending_verification` |
| `POST` | `/public/bookings/:id/verify` | Submit 6-digit OTP |
| `POST` | `/public/bookings/:id/resend-otp` | Resend OTP |
| `DELETE` | `/public/bookings/:cancelToken` | Cancel booking via email link |

</details>

---

## 🧱 Project Structure

```
slox/
├── apps/
│   ├── api/                    NestJS backend
│   │   ├── src/
│   │   │   ├── auth/
│   │   │   ├── business/       Protected routes
│   │   │   ├── public/         Unauthenticated booking flow
│   │   │   ├── webhooks/       Google Calendar push
│   │   │   ├── scheduling/     Slot engine + conflict detection
│   │   │   ├── notifications/  Email + BullMQ workers
│   │   │   └── common/         Prisma, guards, interceptors
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── migrations/
│   │
│   └── web/                    Next.js 14 frontend
│       ├── app/
│       │   ├── dashboard/      Admin UI (protected)
│       │   └── book/[slug]/    Public booking page
│       └── components/
│
├── docs/
│   ├── SYSTEM_DESIGN.md        Architecture, workflows, ADRs
│   └── API.md                  Extended API documentation
│
├── docker-compose.yml
└── turbo.json                  Turborepo config
```

---

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests (requires Docker services running)
npm run test:e2e

# Coverage report
npm run test:cov
```

---

## 🚢 Deployment

| Service | Provider | Plan |
|---|---|---|
| API + Workers | Railway | Starter ($5/mo credit) |
| Frontend | Vercel | Free |
| PostgreSQL | Neon | Free (3GB) |
| Redis | Railway | Free (500MB) |
| Email | Resend | Free (3,000/mo) |
| CI/CD | GitHub Actions | Free (2,000 min/mo) |

**Deploy:**

```bash
# Migrations run automatically in CI before deploy
npx prisma migrate deploy
```

---

## 🧠 Architecture Decisions

| # | Decision | Chosen | Alternative | Reason |
|---|---|---|---|---|
| ADR-001 | Database | **PostgreSQL** | MongoDB | Relational model, `FOR UPDATE` native, better free tier (Neon 3GB vs Atlas 512MB) |
| ADR-002 | ORM | **Prisma** | TypeORM | Type-safe, auto-migrations, Prisma Studio for dev |
| ADR-003 | Conflict detection | **Redis + PG FOR UPDATE** | Redis only | Redis = fast (99% cases), PG = safety net (ACID guarantee) |
| ADR-004 | Schedule storage | **Rule (JSONB)** | Expand occurrences | 1 row vs ~17,500 rows/staff/year, easy edits |
| ADR-005 | Customer verification | **OTP 6 digits** | Magic link | No app switching on mobile — better UX for Vietnamese users |
| ADR-006 | Reminders | **BullMQ delayed jobs** | Cron every minute | Per-booking precision, persist across restarts, instant cancel |

> 📄 Full rationale with trade-off analysis in [SYSTEM_DESIGN.md § ADRs](./docs/SYSTEM_DESIGN.md#12-architecture-decision-records)

---

## 🗺 Roadmap

**v1.0** — Current scope

- [x] Multi-tenant auth + onboarding
- [x] Slot generation engine
- [x] OTP verification + conflict detection
- [x] Google Calendar 2-way sync
- [x] BullMQ email reminders
- [x] Admin dashboard + public booking page

**v2.0** — Planned

- [ ] Payment integration (Stripe / VNPay)
- [ ] SMS reminders (Twilio)
- [ ] Waitlist when slot is full
- [ ] Review & rating system
- [ ] Analytics dashboard
- [ ] Mobile app (Flutter)

---

## 👤 Author

**Ngô Thanh Tài**

Backend Engineer · NestJS · PostgreSQL · Redis · BullMQ

[![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/yourusername)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://linkedin.com/in/yourprofile)

---

<div align="center">

<sub>Built with ☕ in Ho Chi Minh City, Vietnam</sub>

</div>

### 2. Getting Started

**Step 1: Clone the repository**
```bash
git clone

---
**Step 2: Run dev enviroment **
```bash
docker compose -f docker-compose.dev.yml up -d

docker compose -f docker-compose.test.yml up -d
docker exec hih_api_test npm run test
docker compose -f docker-compose.test.yml down -v

docker compose -f docker-compose.prod.yml up -d --build