# Slox — System Design & Architecture

> Multi-tenant Booking & Scheduling SaaS  
> Stack: NestJS · Next.js · PostgreSQL (Neon) · Prisma · Redis · BullMQ · Google Calendar API

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [System Components](#2-system-components)
3. [Database Design — PostgreSQL + Prisma](#3-database-design--postgresql--prisma)
4. [Core Workflows](#4-core-workflows)
5. [Scheduling Engine](#5-scheduling-engine)
6. [Conflict Detection](#6-conflict-detection)
7. [Authentication & Security](#7-authentication--security)
8. [Notification System](#8-notification-system)
9. [Google Calendar Integration](#9-google-calendar-integration)
10. [API Structure](#10-api-structure)
11. [Infrastructure & Deployment](#11-infrastructure--deployment)
12. [Architecture Decision Records](#12-architecture-decision-records)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                               │
│                                                                     │
│   ┌─────────────────────┐        ┌──────────────────────────┐       │
│   │  Admin Dashboard    │        │   Public Booking Page     │      │
│   │  (Next.js 14)       │        │   (Next.js 14 — no auth) │       │
│   │  /dashboard/*       │        │   slox.io/book/:slug      │      │
│   └──────────┬──────────┘        └────────────┬─────────────┘       │
└──────────────│────────────────────────────────│──────────────────── ┘
               │  HTTPS / REST                  │  HTTPS / REST
               ▼                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (NestJS)                           │
│                                                                     │
│   JWT Auth Middleware  │  Tenant Resolver  │  Rate Limiter          │
│   → Validates token    │  → Injects        │  → 100 req/min         │
│   → Attaches user      │    tenantId to    │    per tenant          │
│                        │    all requests   │  → 20 req/min per IP   │
│                        │                   │    (public routes)     │
└───────┬───────────────────────┬─────────────────────┬────────────── ┘
        │                       │                     │
        ▼                       ▼                     ▼
┌──────────────┐   ┌────────────────────┐   ┌────────────────────────┐
│ Auth Service │   │  Booking Service   │   │  Notification Service  │
│              │   │                   │    │                        │
│ - Register   │   │ - Slot engine     │    │ - Email (Resend)       │
│ - Login      │   │ - Conflict detect │    │ - BullMQ jobs          │
│ - Refresh    │   │ - Booking CRUD    │    │ - Reminder schedule    │
│ - OAuth2     │   │ - State machine   │    │ - Job cancellation     │
│ - Logout     │   │ - OTP verify      │    │                        │
└──────┬───────┘   └────────┬──────────┘    └────────────┬───────────┘
       │                    │                            │
       ▼                    ▼                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                │
│                                                                     │
│  ┌────────────────────┐   ┌───────────────── ┐   ┌────────────────┐ │
│  │  PostgreSQL        │   │     Redis        │   │    BullMQ      │ │
│  │  (Neon — free 3GB) │   │   (Railway)      │   │  (uses Redis)  │ │
│  │                    │   │                  │   │                │ │
│  │  Prisma ORM        │   │ - Slot locks     │   │ - reminder:24h │ │
│  │  Type-safe queries │   │ - OTP codes      │   │ - reminder:1h  │ │
│  │  Auto migrations   │   │ - Refresh tokens │   │ - email:send   │ │
│  │                    │   │ - JWT blacklist  │   │ - gcal:sync    │ │
│  │  Tables:           │   │                  │   │                │ │
│  │  - tenants         │   │                  │   │                │ │
│  │  - users           │   │                  │   │                │ │
│  │  - services        │   │                  │   │                │ │
│  │  - staff           │   │                  │   │                │ │
│  │  - staff_services  │   │                  │   │                │ │
│  │  - schedules       │   │                  │   │                │ │
│  │  - schedule_       │   │                  │   │                │ │
│  │    exceptions      │   │                  │   │                │ │
│  │  - bookings        │   │                  │   │                │ │
│  │  - blocked_slots   │   │                  │   │                │ │
│  └────────────────────┘   └───────────────── ┘   └────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       EXTERNAL SERVICES                             │
│   Google Calendar API      Resend (Email)      GitHub Actions       │
│   (OAuth2 + Webhooks)      (Transactional)     (CI/CD)              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. System Components

### 2.1 API Gateway — Middleware Stack

Mọi request đều đi qua các middleware sau theo đúng thứ tự:

```
Incoming Request
       │
       ├── 1. LoggerMiddleware
       │       Log: method, path, IP, response time
       │
       ├── 2. TenantResolverMiddleware
       │       Extract tenantId từ JWT → inject vào req.tenantId
       │       (chỉ chạy với protected routes)
       │
       ├── 3. ThrottlerGuard
       │       Public routes  : 20 req/min per IP
       │       Business routes: 100 req/min per tenant
       │
       ├── 4. JwtAuthGuard
       │       Validate JWT signature + expiry
       │       Check blacklist Redis
       │       Attach user object vào request
       │
       └── 5. RolesGuard
               Compare req.user.role với @Roles() decorator
               owner > admin > member
```

### 2.2 Booking Service — Internal Modules

```
BookingModule
├── SlotGenerationService
│       Tính toán available slots từ schedule rules
│       Input: tenantId, staffId, date, serviceId
│       Output: Array<{ startTime, endTime }>
│
├── ConflictDetectionService
│       Layer 1: Redis SETNX lock (fast, temporary)
│       Layer 2: PostgreSQL SELECT FOR UPDATE (safe, persistent)
│
├── BookingCrudService
│       CRUD với Prisma client
│       Luôn scope query theo tenantId
│
├── BookingStateMachine
│       Quản lý valid status transitions
│       Trigger side effects khi đổi status
│
└── OtpVerificationService
        Generate OTP 6 số
        Lưu vào Redis với TTL + attempt counter
        Validate và rate-limit
```

### 2.3 Schedule Service — Internal Modules

```
ScheduleModule
├── AvailabilityRuleService
│       CRUD cho schedule và schedule_exceptions
│       Validate không overlap với existing rules
│
├── RecurringResolver
│       Input: staffId, date
│       Output: WorkingHours | null
│       Logic: Exception → WeeklySchedule → null
│
└── GoogleCalendarService
        OAuth2 token management
        Sync booking → GCal event
        Handle GCal webhook → blocked_slots
```

---

## 3. Database Design — PostgreSQL + Prisma

### 3.1 Tại sao PostgreSQL tốt hơn MongoDB cho Slox

```
Slox có data model với quan hệ rõ ràng và cố định:

  tenant ──< users           (1 tenant có nhiều users)
  tenant ──< services        (1 tenant có nhiều services)
  tenant ──< staff           (1 tenant có nhiều staff)
  staff  ──< staff_services  (staff làm được nhiều service)
  staff  ──< schedules       (staff có lịch làm việc)
  tenant ──< bookings        (1 tenant có nhiều bookings)
  staff  ──< bookings        (1 staff có nhiều bookings)
  service──< bookings        (1 service có nhiều bookings)

→ Đây là bài toán RELATIONAL — PostgreSQL là lựa chọn tự nhiên.

Thêm vào đó:
  - SELECT FOR UPDATE → conflict detection mạnh hơn
  - Foreign Key constraints → data integrity tự động
  - JSONB → lưu được flexible data (weeklyHours, customer info)
  - Transaction ACID đầy đủ → onboarding (create tenant + user cùng lúc)
```

### 3.2 Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── TENANT ───────────────────────────────────────────────────────────

model Tenant {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  plan      Plan     @default(FREE)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Google Calendar integration
  gcalAccessToken   String?  // encrypted
  gcalRefreshToken  String?  // encrypted
  gcalCalendarId    String?
  gcalSyncEnabled   Boolean  @default(false)
  gcalSyncToken     String?  // used for incremental sync

  // Settings
  timezone            String  @default("Asia/Ho_Chi_Minh")
  bookingLeadTime     Int     @default(24)  // hours before booking
  maxAdvanceBooking   Int     @default(30)  // days ahead
  cancelPolicyHours   Int     @default(2)   // hours before can cancel

  // Relations
  users         User[]
  services      Service[]
  staff         Staff[]
  bookings      Booking[]
  blockedSlots  BlockedSlot[]

  @@map("tenants")
}

enum Plan {
  FREE
  PRO
}

// ─── USER ─────────────────────────────────────────────────────────────

model User {
  id           String   @id @default(uuid())
  tenantId     String
  email        String
  passwordHash String
  role         Role     @default(MEMBER)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, email])
  @@index([tenantId, role])
  @@map("users")
}

enum Role {
  OWNER
  ADMIN
  MEMBER
}

// ─── SERVICE ──────────────────────────────────────────────────────────

model Service {
  id          String  @id @default(uuid())
  tenantId    String
  name        String
  description String?
  duration    Int             // minutes, e.g. 60
  bufferTime  Int     @default(0)  // minutes after slot
  price       Decimal @db.Decimal(10, 0)
  currency    String  @default("VND")
  isActive    Boolean @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant        Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  staffServices StaffService[]
  bookings      Booking[]

  @@index([tenantId, isActive])
  @@map("services")
}

// ─── STAFF ────────────────────────────────────────────────────────────

model Staff {
  id       String  @id @default(uuid())
  tenantId String
  name     String
  email    String?
  avatar   String?
  isActive Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenant        Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  staffServices StaffService[]
  schedule      Schedule?
  bookings      Booking[]
  blockedSlots  BlockedSlot[]

  @@index([tenantId, isActive])
  @@map("staff")
}

// ─── STAFF_SERVICE (junction table) ───────────────────────────────────

model StaffService {
  staffId   String
  serviceId String

  staff   Staff   @relation(fields: [staffId], references: [id], onDelete: Cascade)
  service Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@id([staffId, serviceId])
  @@map("staff_services")
}

// ─── SCHEDULE ─────────────────────────────────────────────────────────

model Schedule {
  id      String  @id @default(uuid())
  staffId String  @unique      // 1 staff có 1 schedule rule
  tenantId String

  // Weekly hours lưu dạng JSONB
  // Format: { monday: [{start: "09:00", end: "17:00"}], tuesday: [...], ... }
  weeklyHours Json

  // Ngày bắt đầu / kết thúc áp dụng rule này
  effectiveFrom DateTime @default(now())
  effectiveTo   DateTime?             // null = no end date

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  staff      Staff               @relation(fields: [staffId], references: [id], onDelete: Cascade)
  exceptions ScheduleException[]

  @@index([tenantId])
  @@map("schedules")
}

// ─── SCHEDULE_EXCEPTION ───────────────────────────────────────────────

model ScheduleException {
  id         String        @id @default(uuid())
  scheduleId String
  date       DateTime      @db.Date   // chỉ lưu date, không có time
  type       ExceptionType
  customHours Json?        // chỉ dùng khi type = CUSTOM_HOURS
  note       String?

  schedule Schedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)

  @@unique([scheduleId, date])   // không được có 2 exception cùng ngày
  @@map("schedule_exceptions")
}

enum ExceptionType {
  DAY_OFF
  CUSTOM_HOURS
}

// ─── BOOKING ──────────────────────────────────────────────────────────

model Booking {
  id        String        @id @default(uuid())
  tenantId  String
  serviceId String
  staffId   String
  startTime DateTime
  endTime   DateTime

  // Customer info — không cần account
  customerName  String
  customerEmail String
  customerPhone String?
  notes         String?

  status                BookingStatus @default(PENDING_VERIFICATION)
  cancelReason          String?
  cancelToken           String        @unique @default(uuid())
  verificationExpiredAt DateTime?     // dùng cho cleanup cron

  // Google Calendar sync
  gcalEventId String?

  // BullMQ job IDs để có thể cancel khi booking bị hủy
  reminder24hJobId String?
  reminder1hJobId  String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenant  Tenant  @relation(fields: [tenantId], references: [id])
  service Service @relation(fields: [serviceId], references: [id])
  staff   Staff   @relation(fields: [staffId], references: [id])

  // Compound indexes cho các query phổ biến
  @@index([tenantId, startTime])                   // query theo ngày
  @@index([tenantId, staffId, startTime])          // conflict check
  @@index([tenantId, status])                      // filter theo status
  @@index([tenantId, customerEmail])               // lookup booking của khách
  @@index([verificationExpiredAt])                 // cron cleanup
  @@map("bookings")
}

enum BookingStatus {
  PENDING_VERIFICATION  // Chờ OTP xác nhận
  CONFIRMED             // Đã xác nhận
  CANCELLED             // Đã hủy
  COMPLETED             // Hoàn thành
  NO_SHOW               // Không đến
  EXPIRED               // Hết hạn OTP
}

// ─── BLOCKED_SLOT ─────────────────────────────────────────────────────

model BlockedSlot {
  id          String      @id @default(uuid())
  tenantId    String
  staffId     String
  startTime   DateTime
  endTime     DateTime
  source      BlockSource
  gcalEventId String?     // để delete khi GCal event bị xóa
  note        String?
  createdAt   DateTime    @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id])
  staff  Staff  @relation(fields: [staffId], references: [id])

  @@index([tenantId, staffId, startTime])
  @@index([gcalEventId])
  @@map("blocked_slots")
}

enum BlockSource {
  MANUAL
  GOOGLE_CALENDAR
}
```

### 3.3 Prisma Migration Workflow

```bash
# Tạo migration mới sau khi thay đổi schema
npx prisma migrate dev --name add_schedule_exceptions

# Kết quả: prisma/migrations/20260315_add_schedule_exceptions/migration.sql
# Prisma tự generate SQL, tự apply vào DB, tự update Prisma Client

# Xem database qua Prisma Studio (GUI)
npx prisma studio
# → Mở http://localhost:5555, xem và edit data trực tiếp

# Deploy migration lên production
npx prisma migrate deploy

# Generate Prisma Client sau khi thay đổi schema
npx prisma generate
```

### 3.4 Prisma Client Usage trong NestJS

```typescript
// prisma.service.ts — wrapper cho NestJS DI
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}

// booking.service.ts — ví dụ query type-safe
@Injectable()
export class BookingService {
  constructor(private prisma: PrismaService) {}

  async getBookings(tenantId: string, filters: BookingFilterDto) {
    return this.prisma.booking.findMany({
      where: {
        tenantId,                    // ← luôn scope theo tenant
        status: filters.status,
        startTime: {
          gte: filters.dateFrom,
          lte: filters.dateTo,
        },
      },
      include: {
        service: { select: { name: true, duration: true } },
        staff: { select: { name: true } },
      },
      orderBy: { startTime: 'asc' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    });
  }
}
```

### 3.5 PostgreSQL JSONB — weeklyHours

Field `weeklyHours` trong bảng `schedules` lưu dạng JSONB:

```json
{
  "monday":    [{ "start": "09:00", "end": "17:00" }],
  "tuesday":   [{ "start": "09:00", "end": "17:00" }],
  "wednesday": [{ "start": "09:00", "end": "17:00" }],
  "thursday":  [{ "start": "09:00", "end": "17:00" }],
  "friday":    [{ "start": "09:00", "end": "17:00" }],
  "saturday":  [{ "start": "09:00", "end": "12:00" }],
  "sunday":    []
}
```

Prisma map JSONB → TypeScript type tự động. Bạn có thể define Zod schema để validate input:

```typescript
const WeeklyHoursSchema = z.object({
  monday:    z.array(TimeRangeSchema),
  tuesday:   z.array(TimeRangeSchema),
  wednesday: z.array(TimeRangeSchema),
  thursday:  z.array(TimeRangeSchema),
  friday:    z.array(TimeRangeSchema),
  saturday:  z.array(TimeRangeSchema),
  sunday:    z.array(TimeRangeSchema),
});

const TimeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/), // "HH:MM"
  end:   z.string().regex(/^\d{2}:\d{2}$/),
});
```

---

## 4. Core Workflows

### 4.1 Workflow: Business Owner Onboarding

```
Business Owner                    NestJS API                    PostgreSQL
      │                               │                              │
      │── POST /auth/register ────────▶│                              │
      │   { businessName, email,      │                              │
      │     password, slug? }         │── Generate slug ─────────────▶│
      │                               │   SELECT COUNT(*) FROM       │
      │                               │   tenants WHERE slug = $1    │
      │                               │   (auto-increment nếu trùng) │
      │                               │                              │
      │                               │── BEGIN TRANSACTION ─────────▶│
      │                               │── INSERT INTO tenants ────────▶│
      │                               │── INSERT INTO users ──────────▶│
      │                               │   (role: OWNER, tenantId)    │
      │                               │── COMMIT ─────────────────────▶│
      │                               │                              │
      │                               │── Issue JWT access (15m)     │
      │                               │── Issue JWT refresh (7d)     │
      │                               │── SET Redis refresh:{userId} │
      │◀── 201 Created ───────────────│                              │
      │    { accessToken,             │                              │
      │      refreshToken,            │                              │
      │      tenant: { id, slug } }   │                              │
      │                               │                              │
      │── POST /business/services ────▶│ Thêm dịch vụ               │
      │── POST /business/staff ───────▶│ Thêm nhân viên              │
      │── PUT /business/schedules/:id ▶│ Cấu hình giờ làm việc       │
      │                               │                              │
      │   [slox.io/book/{slug} sẵn sàng nhận booking]               │
```

### 4.2 Workflow: Customer Booking (End-to-End)

```
Customer Browser         NestJS API          Redis         PostgreSQL
      │                      │                 │                │
      │── GET /public/:slug ─▶│                 │                │
      │◀─ Business info ──────│                 │                │
      │                      │                 │                │
      │── GET /public/:slug/ │                 │                │
      │   slots?date=...&    │                 │                │
      │   serviceId=...&     │                 │                │
      │   staffId=... ───────▶│                 │                │
      │                      │── Query schedule ───────────────▶│
      │                      │── Query bookings ────────────────▶│
      │                      │── Query blocked_slots ───────────▶│
      │                      │── Generate available slots        │
      │◀─ Available slots ───│                 │                │
      │                      │                 │                │
      │── POST /public/:slug/│                 │                │
      │   bookings ──────────▶│                 │                │
      │                      │                 │                │
      │                      │── [Layer 1]      │                │
      │                      │── SETNX ─────────▶│               │
      │                      │   lock:slot:{hash}│               │
      │                      │   TTL: 60s        │               │
      │                      │                  │                │
      │                      │   FAIL? → 409 Conflict            │
      │                      │                  │                │
      │                      │   OK ────────────▶│               │
      │                      │                  │                │
      │                      │── [Layer 2] ──────────────────────▶│
      │                      │   BEGIN           │                │
      │                      │   SELECT ... FROM bookings         │
      │                      │   WHERE staffId = $1               │
      │                      │   AND startTime OVERLAPS ($2, $3)  │
      │                      │   AND status IN (...)              │
      │                      │   FOR UPDATE      │                │
      │                      │                  │                │
      │                      │   Có row? → ROLLBACK → 409        │
      │                      │                  │                │
      │                      │   Không có row?   │                │
      │                      │── INSERT booking ─────────────────▶│
      │                      │   status: PENDING_VERIFICATION     │
      │                      │── COMMIT ──────────────────────────▶│
      │                      │                  │                │
      │                      │── Generate OTP ───▶│               │
      │                      │   SET otp:{bookingId}              │
      │                      │   { code, attempts: 0 }            │
      │                      │   TTL: 600s        │               │
      │                      │── DEL slot lock ──▶│               │
      │                      │── Enqueue email job│               │
      │◀─ 201 { bookingId } ─│                  │                │
      │                      │                  │                │
      │   [Customer nhận email, lấy OTP]        │                │
      │                      │                  │                │
      │── POST /public/      │                  │                │
      │   bookings/:id/verify│                  │                │
      │   { otp: "847291" } ─▶│                  │                │
      │                      │── GET otp:{id} ───▶│               │
      │                      │   code match?     │                │
      │                      │   attempts < 5?   │                │
      │                      │                  │                │
      │                      │   NO → increment attempts          │
      │                      │       → 400 Bad Request            │
      │                      │                  │                │
      │                      │   YES:            │                │
      │                      │── DEL otp:{id} ───▶│               │
      │                      │── UPDATE booking ─────────────────▶│
      │                      │   status: CONFIRMED│               │
      │                      │── Enqueue:         │               │
      │                      │   reminder:24h job │               │
      │                      │   reminder:1h job  │               │
      │                      │   gcal:sync job    │               │
      │◀─ 200 Confirmed ─────│                  │                │
```

### 4.3 Workflow: Booking Cancellation

```
Customer (via email link)    NestJS API        BullMQ       PostgreSQL
      │                          │                │               │
      │── DELETE /public/        │                │               │
      │   bookings/:cancelToken ─▶│                │               │
      │                          │── SELECT booking               │
      │                          │   WHERE cancelToken = $1 ──────▶│
      │                          │◀─ Booking row ─────────────────│
      │                          │                │               │
      │                          │── Validate:    │               │
      │                          │   status = CONFIRMED?          │
      │                          │   now < startTime - cancelPolicy?
      │                          │                │               │
      │                          │   FAIL → 400 "Không thể hủy"  │
      │                          │                │               │
      │                          │   OK:          │               │
      │                          │── UPDATE status: CANCELLED ────▶│
      │                          │── Remove reminder:24h job ─────▶│
      │                          │── Remove reminder:1h job ──────▶│
      │                          │── Enqueue gcal:delete job      │
      │                          │── Enqueue cancellation email   │
      │◀─ 200 Cancelled ─────────│                │               │
```

### 4.4 Workflow: JWT Refresh

```
Client                  NestJS API               Redis
   │                        │                      │
   │── POST /auth/login ────▶│                      │
   │◀─ { accessToken (15m), │                      │
   │     refreshToken (7d) }─│                      │
   │                         │── SET refresh:{uid} ─▶│
   │                         │   value: token, TTL 7d│
   │                         │                      │
   │   [15 phút sau...]       │                      │
   │── POST /auth/refresh ───▶│                      │
   │   { refreshToken }      │── GET refresh:{uid} ─▶│
   │                         │◀─ Stored token ───────│
   │                         │── Token match? valid? │
   │                         │── Issue new access    │
   │                         │── Rotate refresh      │
   │                         │── SET new refresh ────▶│
   │◀─ { new tokens } ───────│   DEL old refresh ────▶│
   │                         │                      │
   │── POST /auth/logout ────▶│                      │
   │                         │── DEL refresh:{uid} ─▶│
   │                         │── Blacklist access ───▶│
   │◀─ 200 OK ───────────────│   token in Redis      │
```

---

## 5. Scheduling Engine

### 5.1 Slot Generation Algorithm

```
Input:
  tenantId  : string
  staffId   : string
  date      : Date      (ví dụ: 2026-03-15)
  serviceId : string    (để lấy duration + bufferTime)

Output:
  slots: Array<{ startTime: Date, endTime: Date }>

─────────────────────────────────────────────────────────
Step 1 — Fetch dữ liệu song song (Promise.all)
  const [schedule, existingBookings, blockedSlots, service]
    = await Promise.all([
        prisma.schedule.findFirst({
          where: { staffId, effectiveFrom: { lte: date },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }]
          },
          include: { exceptions: { where: { date } } }
        }),
        prisma.booking.findMany({
          where: { tenantId, staffId, startTime: { gte: dayStart, lt: dayEnd },
                   status: { in: ['PENDING_VERIFICATION', 'CONFIRMED'] } }
        }),
        prisma.blockedSlot.findMany({
          where: { tenantId, staffId, startTime: { gte: dayStart, lt: dayEnd } }
        }),
        prisma.service.findUnique({ where: { id: serviceId } })
      ])

Step 2 — Resolve working hours
  const exception = schedule.exceptions[0]
  if (exception?.type === 'DAY_OFF')     → return []
  if (exception?.type === 'CUSTOM_HOURS') → hours = exception.customHours
  else                                    → hours = schedule.weeklyHours[dayOfWeek]
  if (!hours || hours.length === 0)       → return []

Step 3 — Generate raw slots
  const slotSize = service.duration + service.bufferTime
  const slots = []
  for each { start, end } in hours:
    let cursor = parse(start, date)  // combine date + "HH:MM"
    const workEnd = parse(end, date)
    while cursor + service.duration <= workEnd:
      slots.push({ startTime: cursor, endTime: cursor + service.duration })
      cursor += slotSize

Step 4 — Filter occupied slots
  const occupied = [...existingBookings, ...blockedSlots]
  const available = slots.filter(slot =>
    !occupied.some(occ =>
      slot.startTime < occ.endTime && slot.endTime > occ.startTime
    )
  )

Step 5 — Filter theo booking lead time
  const minTime = addHours(new Date(), tenant.settings.bookingLeadTime)
  return available.filter(slot => slot.startTime >= minTime)
─────────────────────────────────────────────────────────
```

### 5.2 Recurring Schedule Resolution

```
Input: staffId, queryDate (ví dụ: 2026-03-15 — Chủ nhật)

Resolution chain (priority từ cao xuống thấp):

  ┌──────────────────────────────────────────────────────┐
  │ 1. CHECK EXCEPTIONS (highest priority)               │
  │                                                      │
  │    SELECT * FROM schedule_exceptions                 │
  │    WHERE schedule_id = $scheduleId                   │
  │    AND date = $queryDate                             │
  │                                                      │
  │    Tìm thấy + type = DAY_OFF?                        │
  │      → return null (nghỉ)                           │
  │    Tìm thấy + type = CUSTOM_HOURS?                   │
  │      → return customHours                           │
  └──────────────────────────────────────────────────────┘
                      │ Không tìm thấy exception
                      ▼
  ┌──────────────────────────────────────────────────────┐
  │ 2. CHECK WEEKLY SCHEDULE (normal schedule)           │
  │                                                      │
  │    dayOfWeek = queryDate.getDay()                    │
  │    // 0=sunday, 1=monday, ..., 6=saturday            │
  │                                                      │
  │    const dayName = ['sunday','monday',...][dayOfWeek]│
  │    const hours = weeklyHours[dayName]                │
  │                                                      │
  │    hours = [] (empty)?                               │
  │      → return null (nghỉ ngày đó)                   │
  │    hours có entries?                                 │
  │      → return hours                                 │
  └──────────────────────────────────────────────────────┘
```

### 5.3 Timezone Handling

```
Nguyên tắc:
  - Tất cả timestamp trong PostgreSQL lưu dạng UTC (timestamptz)
  - Mỗi tenant có field timezone (ví dụ: "Asia/Ho_Chi_Minh" = UTC+7)
  - Conversion xảy ra ở tầng application, không phải DB

Khi nhận request từ client:
  Input: "2026-03-15" (date string, không có timezone)
  → Parse theo tenant.timezone
  → dayStart = 2026-03-15T00:00:00+07:00 = 2026-03-14T17:00:00Z (UTC)
  → dayEnd   = 2026-03-15T23:59:59+07:00 = 2026-03-15T16:59:59Z (UTC)

Khi generate slots:
  → Tính startTime/endTime trong tenant timezone
  → Chuyển sang UTC trước khi INSERT vào DB

Khi trả về response:
  → Convert UTC → tenant timezone
  → Format: "2026-03-15T10:00:00+07:00" (ISO 8601 với offset)

Thư viện: date-fns-tz
  import { toZonedTime, fromZonedTime, format } from 'date-fns-tz'
```

---

## 6. Conflict Detection

### 6.1 Hai lớp bảo vệ

```
Layer 1: Redis SETNX Lock
  Mục đích: Chặn nhanh ở application layer, tránh nhiều request
            cùng lúc vào DB
  Đặc điểm: Fast (~1ms), temporary (TTL 60s), best-effort

Layer 2: PostgreSQL SELECT FOR UPDATE
  Mục đích: Đảm bảo tuyệt đối không có race condition ở DB layer
  Đặc điểm: ACID guaranteed, block concurrent transactions

Cả hai layer hoạt động cùng nhau:
  Redis lock → giảm áp lực lên DB (99% cases)
  PG lock    → safety net cho 1% cases Redis không đủ
```

### 6.2 PostgreSQL SELECT FOR UPDATE

```sql
-- Chạy trong một transaction
BEGIN;

-- Lock tất cả bookings conflict với slot cần đặt
-- Nếu có transaction khác đang lock các rows này → WAIT
SELECT id FROM bookings
WHERE staff_id = $1
  AND tenant_id = $2
  AND status IN ('PENDING_VERIFICATION', 'CONFIRMED')
  AND start_time < $3   -- $3 = endTime của slot cần đặt
  AND end_time   > $4   -- $4 = startTime của slot cần đặt
FOR UPDATE;

-- Nếu query trả về rows → có conflict → ROLLBACK
-- Nếu query trả về empty → slot trống → INSERT

INSERT INTO bookings (tenant_id, staff_id, service_id, start_time, end_time, ...)
VALUES ($1, $2, $3, $4, $5, ...);

COMMIT;
```

### 6.3 TypeScript Implementation

```typescript
// conflict-detection.service.ts

async createBookingWithLock(
  tenantId: string,
  dto: CreateBookingDto,
): Promise<Booking> {

  // Layer 1: Redis lock
  const lockKey = this.buildLockKey(tenantId, dto.staffId, dto.startTime);
  const acquired = await this.redis.set(lockKey, '1', 'NX', 'EX', 60);
  if (!acquired) {
    throw new ConflictException('Slot vừa được đặt, vui lòng chọn slot khác');
  }

  try {
    // Layer 2: PostgreSQL transaction với SELECT FOR UPDATE
    return await this.prisma.$transaction(async (tx) => {

      // Lock conflicting rows
      const conflicts = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM bookings
        WHERE staff_id    = ${dto.staffId}
          AND tenant_id   = ${tenantId}
          AND status      IN ('PENDING_VERIFICATION', 'CONFIRMED')
          AND start_time  < ${dto.endTime}
          AND end_time    > ${dto.startTime}
        FOR UPDATE
      `;

      if (conflicts.length > 0) {
        throw new ConflictException('Slot không còn trống');
      }

      // Tạo booking
      return tx.booking.create({
        data: {
          tenantId,
          serviceId: dto.serviceId,
          staffId: dto.staffId,
          startTime: dto.startTime,
          endTime: dto.endTime,
          customerName: dto.customer.name,
          customerEmail: dto.customer.email,
          customerPhone: dto.customer.phone,
          notes: dto.notes,
          status: BookingStatus.PENDING_VERIFICATION,
          verificationExpiredAt: addMinutes(new Date(), 10),
        },
      });
    });
  } finally {
    // Luôn release lock dù có lỗi hay không
    await this.redis.del(lockKey);
  }
}

private buildLockKey(tenantId: string, staffId: string, startTime: Date): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${tenantId}:${staffId}:${startTime.toISOString()}`)
    .digest('hex')
    .slice(0, 16);
  return `lock:slot:${hash}`;
}
```

---

## 7. Authentication & Security

### 7.1 JWT Strategy

```
Access Token
  Payload : { sub: userId, tenantId, role, email }
  TTL     : 15 phút
  Storage : Client memory (không dùng localStorage — XSS risk)
  Usage   : Authorization: Bearer <token>

Refresh Token
  Payload : { sub: userId, jti: uuid }  (minimal payload)
  TTL     : 7 ngày
  Storage : Redis (key: refresh:{userId}) + HttpOnly Cookie
  Rotation: Mỗi lần refresh → issue token mới + invalidate cũ

Token Blacklist
  Khi logout: thêm access token vào Redis blacklist
  Key : blacklist:{jti}
  TTL : Bằng thời gian còn lại của access token
  Check: JwtAuthGuard kiểm tra blacklist trước khi accept
```

### 7.2 OTP Security

```
Generation  : crypto.randomInt(100000, 999999)
              Không dùng Math.random() — không đủ entropy

Redis Key   : otp:{bookingId}
Redis Value : { code: "847291", attempts: 0 }
Redis TTL   : 600 giây (10 phút)

Brute-force protection:
  Mỗi lần sai → increment attempts trong Redis
  attempts >= 5:
    → DEL otp key
    → UPDATE booking SET status = 'EXPIRED'
    → 400: "Quá nhiều lần thử, vui lòng đặt lịch lại"

Rate limiting thêm:
  → Max 3 lần gọi /verify trong 1 phút (per IP)
  → Max 1 lần gọi /resend-otp trong 2 phút (per bookingId)
```

### 7.3 RBAC

```typescript
// Khai báo trực tiếp trên route handler
@Roles(Role.ADMIN, Role.OWNER)
@UseGuards(JwtAuthGuard, RolesGuard)
@Delete('/business/staff/:id')
async deleteStaff(@Param('id') id: string, @TenantId() tenantId: string) {
  return this.staffService.delete(tenantId, id);
}

// Custom decorator lấy tenantId từ request
export const TenantId = () => createParamDecorator(
  (_, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().tenantId
)();

// Permission matrix
// owner  : tất cả operations
// admin  : quản lý services, staff, schedules, bookings (trừ xóa tenant)
// member : chỉ xem bookings được assign cho mình
```

---

## 8. Notification System

### 8.1 BullMQ Queue Architecture

```
Redis (Queue Storage)
  │
  ├── Queue: "email"          Workers: 3 concurrent
  ├── Queue: "reminder:24h"   Workers: 2 concurrent
  ├── Queue: "reminder:1h"    Workers: 2 concurrent
  └── Queue: "gcal:sync"      Workers: 2 concurrent

Retry strategy (tất cả queues):
  attempts  : 3
  backoff   : exponential, delay = 60_000ms
  → Retry sau: 1 phút → 2 phút → 4 phút

Dead Letter Queue:
  Sau 3 lần fail → job vào failed queue
  → Alert monitoring (log + notify admin)
```

### 8.2 Reminder Scheduling

```typescript
// Khi booking được confirm
async scheduleReminders(booking: Booking): Promise<void> {
  const { id, startTime, customerEmail, customerName } = booking;

  // Reminder 24 giờ trước
  const delay24h = startTime.getTime() - Date.now() - 24 * 60 * 60 * 1000;
  if (delay24h > 0) {
    const job24h = await this.reminder24hQueue.add(
      'send-reminder',
      { bookingId: id, type: '24h' },
      { delay: delay24h, jobId: `reminder:24h:${id}` }
    );
    await this.prisma.booking.update({
      where: { id },
      data: { reminder24hJobId: job24h.id },
    });
  }

  // Reminder 1 giờ trước
  const delay1h = startTime.getTime() - Date.now() - 60 * 60 * 1000;
  if (delay1h > 0) {
    const job1h = await this.reminder1hQueue.add(
      'send-reminder',
      { bookingId: id, type: '1h' },
      { delay: delay1h, jobId: `reminder:1h:${id}` }
    );
    await this.prisma.booking.update({
      where: { id },
      data: { reminder1hJobId: job1h.id },
    });
  }
}

// Khi booking bị hủy
async cancelReminders(booking: Booking): Promise<void> {
  if (booking.reminder24hJobId) {
    await this.reminder24hQueue.remove(booking.reminder24hJobId);
  }
  if (booking.reminder1hJobId) {
    await this.reminder1hQueue.remove(booking.reminder1hJobId);
  }
}
```

---

## 9. Google Calendar Integration

### 9.1 OAuth2 Setup Flow

```
Business Owner              NestJS API           Google OAuth2
      │                          │                     │
      │── GET /auth/google ───────▶│                     │
      │                           │── Build URL ─────────▶│
      │◀─ Redirect to Google ─────│                     │
      │   [User đồng ý]           │                     │
      │── Callback?code=xxx ───────────────────────────▶│
      │                           │◀─ Redirect ─────────│
      │                           │── Exchange code ─────▶│
      │                           │◀─ { access_token,   │
      │                           │     refresh_token }  │
      │                           │── Encrypt tokens     │
      │                           │── UPDATE tenants     │
      │                           │   SET gcalAccessToken,│
      │                           │       gcalRefreshToken│
      │                           │── Subscribe webhooks │
      │◀─ "Google Calendar đã     │                     │
      │    được kết nối" ─────────│                     │
```

### 9.2 Slox → Google Calendar

```typescript
// gcal-sync.processor.ts (BullMQ worker)

@Processor('gcal:sync')
export class GCalSyncProcessor {
  @Process('create-event')
  async createEvent(job: Job<{ bookingId: string }>) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: job.data.bookingId },
      include: { tenant: true, service: true, staff: true },
    });

    if (!booking.tenant.gcalSyncEnabled) return;

    // Refresh access token nếu cần
    const accessToken = await this.gcalService.getValidAccessToken(booking.tenant);

    const event = await this.googleCalendar.events.insert({
      calendarId: booking.tenant.gcalCalendarId,
      auth: accessToken,
      requestBody: {
        summary: `${booking.customerName} — ${booking.service.name}`,
        description: `SĐT: ${booking.customerPhone}\nGhi chú: ${booking.notes ?? 'Không có'}`,
        start: { dateTime: booking.startTime.toISOString(), timeZone: booking.tenant.timezone },
        end:   { dateTime: booking.endTime.toISOString(),   timeZone: booking.tenant.timezone },
      },
    });

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { gcalEventId: event.data.id },
    });
  }
}
```

### 9.3 Google Calendar → Slox (Webhook)

```
Google gửi Push Notification
  POST /webhooks/google-calendar
  Headers: X-Goog-Channel-ID, X-Goog-Resource-State
      │
      ▼
1. Validate channel ID → tìm tenant
2. Fetch changed events từ GCal API
   (dùng syncToken để incremental sync)
3. Với mỗi event thay đổi:
   - Created / Updated:
       UPSERT INTO blocked_slots
       (tenantId, staffId, startTime, endTime,
        source: GOOGLE_CALENDAR, gcalEventId)
       ON CONFLICT (gcalEventId) DO UPDATE
   - Deleted:
       DELETE FROM blocked_slots
       WHERE gcalEventId = $1
4. UPDATE tenants SET gcalSyncToken = newToken
```

---

## 10. API Structure

### 10.1 NestJS Module Structure

```
src/
├── app.module.ts
│
├── common/
│   ├── prisma/
│   │   └── prisma.service.ts          PrismaClient wrapper
│   ├── interceptors/
│   │   └── tenant.interceptor.ts      Inject tenantId
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── roles.guard.ts
│   ├── decorators/
│   │   ├── roles.decorator.ts
│   │   └── tenant-id.decorator.ts
│   └── filters/
│       └── prisma-exception.filter.ts  Map Prisma errors → HTTP errors
│
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   └── strategies/
│       ├── jwt.strategy.ts
│       └── google-oauth.strategy.ts
│
├── business/
│   ├── profile/
│   ├── staff/
│   ├── services/
│   ├── schedules/
│   └── bookings/
│
├── public/
│   ├── public.module.ts
│   ├── slots/                         Slot generation endpoint
│   └── bookings/                      Create + verify booking
│
├── webhooks/
│   └── google-calendar/
│
├── scheduling/
│   ├── slot-engine/
│   ├── conflict-detection/
│   └── recurring-resolver/
│
└── notifications/
    ├── email/
    ├── queues/
    └── workers/
        ├── email.processor.ts
        ├── reminder.processor.ts
        └── gcal-sync.processor.ts
```

### 10.2 Prisma Exception Filter

```typescript
// prisma-exception.filter.ts
// Map Prisma errors → HTTP errors tự động

@Catch(PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    switch (exception.code) {
      case 'P2002':  // Unique constraint violation
        return response.status(409).json({
          error: { code: 'DUPLICATE_ENTRY', message: 'Dữ liệu đã tồn tại' }
        });
      case 'P2025':  // Record not found
        return response.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Không tìm thấy' }
        });
      default:
        return response.status(500).json({
          error: { code: 'DB_ERROR', message: 'Lỗi hệ thống' }
        });
    }
  }
}
```

---

## 11. Infrastructure & Deployment

### 11.1 Local Development

```yaml
# docker-compose.yml

services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: slox_dev
      POSTGRES_USER: slox
      POSTGRES_PASSWORD: slox_secret
    volumes: [postgres_data:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  bull-board:
    image: deadly0/bull-board
    ports: ["3001:3001"]
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379

volumes:
  postgres_data:
```

### 11.2 Production Infrastructure

```
┌─────────────────────────────────────────────────┐
│                   Vercel                         │
│  Next.js (Admin Dashboard + Public Booking Page)│
│  Auto-deploy từ main branch                     │
└─────────────────────────────────────────────────┘
                       │
                       │ HTTPS REST API
                       ▼
┌─────────────────────────────────────────────────┐
│                  Railway                         │
│  Service 1: NestJS API Server  (PORT 3000)      │
│  Service 2: BullMQ Workers     (no port)        │
│  Service 3: Redis              (PORT 6379)      │
└─────────────────────────────────────────────────┘
                       │
                       │ DATABASE_URL
                       ▼
┌─────────────────────────────────────────────────┐
│                Neon PostgreSQL                   │
│  Region: ap-southeast-1 (Singapore)             │
│  Free tier: 3GB storage · Serverless            │
│  Auto-suspend khi không có request              │
└─────────────────────────────────────────────────┘
```

### 11.3 CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_DB: slox_test, POSTGRES_USER: slox, POSTGRES_PASSWORD: test }
        ports: ["5432:5432"]
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx prisma migrate deploy
        env: { DATABASE_URL: postgresql://slox:test@localhost:5432/slox_test }
      - run: npm run lint
      - run: npm run test
      - run: npm run test:e2e

  deploy:
    needs: test
    steps:
      - name: Deploy API to Railway
        uses: bervProject/railway-deploy@v1
        with: { railway_token: ${{ secrets.RAILWAY_TOKEN }} }
      # Vercel auto-deploy từ main branch (không cần config)
```

### 11.4 Environment Variables

```bash
# Application
NODE_ENV=production
PORT=3000

# PostgreSQL (Neon)
DATABASE_URL=postgresql://slox:password@ep-xxx.ap-southeast-1.aws.neon.tech/slox?sslmode=require

# Redis (Railway)
REDIS_URL=redis://:password@roundhouse.proxy.rlwy.net:6379

# JWT
JWT_SECRET=<random 64 chars hex>
JWT_REFRESH_SECRET=<random 64 chars hex>

# Google OAuth2
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_CALLBACK_URL=https://api.slox.io/auth/google/callback

# Google Calendar Webhook
GOOGLE_WEBHOOK_URL=https://api.slox.io/webhooks/google-calendar

# Email
RESEND_API_KEY=re_xxxxxxxxxxxx

# Encryption (cho GCal tokens trong DB)
ENCRYPTION_KEY=<random 32 chars hex>

# App URLs
FRONTEND_URL=https://slox.vercel.app
API_URL=https://api.slox.io
```

---

## 12. Architecture Decision Records

### ADR-001: PostgreSQL thay vì MongoDB

**Context:** Chọn database chính cho Slox.

**Decision:** PostgreSQL với Prisma ORM.

| Tiêu chí | PostgreSQL | MongoDB |
|---|---|---|
| Data model fit | Relational — phù hợp với Slox | Document — overkill cho data cố định |
| Conflict detection | SELECT FOR UPDATE native | Cần Redis bổ trợ hoàn toàn |
| Foreign keys | Có — data integrity tự động | Không — phải tự quản lý |
| JSONB | Có (weeklyHours, customer) | Native nhưng không cần thiết |
| Free hosting | Neon 3GB | Atlas M0 512MB |
| ORM | Prisma (type-safe, migration) | Mongoose (schema-less) |

**Consequences:** Cần viết migration khi thay đổi schema, nhưng đây là lợi thế — schema thay đổi được tracked và versioned.

---

### ADR-002: Prisma thay vì TypeORM

**Context:** Chọn ORM cho NestJS + PostgreSQL.

**Decision:** Prisma.

| Tiêu chí | Prisma | TypeORM |
|---|---|---|
| Type safety | 100% generated types | Decorator-based, dễ lỗi |
| Migration | Tự động từ schema | Cần tự viết hoặc sync |
| Query API | Intuitive, auto-complete | Verbose QueryBuilder |
| Prisma Studio | Có (GUI xem data) | Không |
| Learning curve | Thấp | Cao hơn |

**Consequences:** Prisma không hỗ trợ tốt complex raw SQL — dùng `prisma.$queryRaw` cho SELECT FOR UPDATE.

---

### ADR-003: Hai lớp Conflict Detection (Redis + PostgreSQL)

**Context:** Tránh double-booking khi nhiều customer đặt cùng slot.

**Decision:** Redis SETNX (Layer 1) + PostgreSQL SELECT FOR UPDATE (Layer 2).

**Rationale:**
- Redis lock chặn 99% traffic ở application layer, nhanh (~1ms), giảm tải DB
- PostgreSQL FOR UPDATE là safety net — đảm bảo tuyệt đối ở DB layer
- Hai layer kết hợp cho cả performance lẫn correctness

**Consequences:** Nếu Redis down, Layer 2 vẫn đảm bảo correctness (chỉ chậm hơn).

---

### ADR-004: Lưu Schedule Rule thay vì Expand Occurrences

**Context:** Lưu lịch làm việc lặp lại của nhân viên.

**Decision:** Lưu rule trong JSONB, generate slots on-the-fly.

| | Store Rule | Expand Occurrences |
|---|---|---|
| Storage | 1 row/staff | ~17,520 rows/staff/năm |
| Edit | Update 1 row | Xóa + recreate hàng nghìn rows |
| Query | Generate on-the-fly | Simple SELECT |
| Scale | Tốt | Kém |

**Consequences:** Query available slots phức tạp hơn nhưng window tối đa 30 ngày nên không ảnh hưởng performance.

---

### ADR-005: OTP 6 Số thay vì Magic Link

**Context:** Xác thực email của end customer.

**Decision:** OTP 6 số, TTL 10 phút, tối đa 5 attempts.

**Rationale:** Magic link yêu cầu switch app trên mobile (email app → browser → booking page), gây mất UX context. OTP không làm gián đoạn flow — người dùng giữ nguyên trang booking, chỉ cần liếc notification email.

**Trade-off:** OTP susceptible to brute-force — mitigated bằng 5-attempt limit + rate limiting.

---

### ADR-006: BullMQ Delayed Jobs thay vì Cron

**Context:** Gửi reminder email đúng giờ trước lịch hẹn.

**Decision:** BullMQ với delayed jobs (1 job per booking).

| | BullMQ Delayed Job | Cron (every minute) |
|---|---|---|
| Precision | Chính xác đến giây | Minimum 1 phút |
| Persistence | Redis — survive restart | Không |
| Cancel | Remove specific job | Flag + check trong cron |
| DB load | Không query DB định kỳ | Query tất cả bookings mỗi phút |
| Retry | Automatic exponential | Tự implement |

**Consequences:** Phụ thuộc Redis stability. Nếu Redis down: jobs bị lost → cần monitoring alert + backup strategy.

---

*Slox System Design v2.0 — PostgreSQL Edition — Ngô Thanh Tài — 2026*
