# CleanAlert

Municipal Uncollected Garbage Reporting and Field Dispatch Management System.

---

## Project Overview

**CleanAlert** is a full-stack, web-based municipal waste management and rapid-dispatch platform. It connects city residents, municipal field crews, and administrative dispatchers into a coordinated operational workflow. The platform enables citizens to report uncollected garbage incidents using geolocation and photos, prevents redundant submissions through spatial duplicate detection, allows field workers to manage tasks on-duty, and equips city administrators with real-time dispatch maps, automated worker routing, and Service Level Agreement (SLA) monitoring.

---

## Problem Statement

Uncollected municipal waste leads to public health hazards, environmental degradation, and neighborhood dissatisfaction. Traditional municipal reporting systems suffer from:
1. **Lack of spatial verification**: Vague address descriptions make it difficult for field crews to locate waste deposits.
2. **Duplicate submissions**: Multiple citizens reporting the same pile of garbage create cluttered queues and fragmented response efforts.
3. **Inefficient manual dispatch**: Administrators struggle to balance workloads across field workers based on proximity and incident urgency.
4. **Zero visibility for citizens**: Citizens receive little to no feedback after lodging complaints, leading to distrust and repeated calls.
5. **Accountability gaps**: Lack of timestamped audit trails and proof-of-resolution verification allows tasks to slip through the cracks.

---

## Objectives

- Provide citizens with a fast, mobile-friendly interface to report garbage with GPS coordinates, categorized waste types, priority levels, and compressed photo evidence.
- Prevent duplicate reports within a 30-meter radius using PostGIS spatial checks, while enabling citizens to upvote/support existing incident pins.
- Deliver an operational field interface for sanitation workers with on-duty tracking, GPS presence synchronization, and a step-by-step task execution workflow.
- Give municipal administrators complete operational oversight through interactive dispatch maps, automated worker-to-incident routing, worker roster management, routine collection schedules, and SLA breach alerts.
- Enforce data integrity, privacy, and linear status transitions directly at the database layer via PostgreSQL Row Level Security (RLS) and atomic Stored Procedures (RPCs).

---

## User Roles

The platform enforces three distinct user roles governed by database-backed role claims and application route guards:

- **Citizen**: Municipal residents who report waste incidents, track progress, upvote neighborhood issues, and receive status notifications.
- **Worker**: Municipal field sanitation personnel who toggle duty status, sync live locations, accept assigned tasks, execute cleanups, and submit resolution proof.
- **Admin**: Municipal dispatchers and operations supervisors who monitor system-wide metrics, manage reports, dispatch crews, configure pickup schedules, track SLAs, and oversee field staff.

---

## Main Features

### Citizen
- **Registration & Authentication**: Sign up with full name, email, phone number, and password; automated profile generation defaulting strictly to the `citizen` role.
- **Garbage Reporting**: Submit reports with title, detailed description, categorized waste type (`general`, `organic`, `plastic`, `hazardous`, `electronic`, `construction`, `bulk`), and severity rating (`low`, `medium`, `high`, `critical`).
- **GPS / Incident Location Picker**: High-accuracy browser geolocation capture with an interactive Leaflet map featuring a draggable marker and reverse geocoding via OpenStreetMap Nominatim.
- **Client-Side Photo Compression**: Automatic image downsampling via `browser-image-compression` to reduce bandwidth and storage overhead prior to upload.
- **30-Meter Duplicate Detection**: Server-side PostGIS proximity check (`ST_DWithin`) alerts the citizen if an active incident already exists within 30 meters.
- **Support Existing Report**: Instead of creating a duplicate ticket, citizens can support/upvote an existing neighborhood report with a single click.
- **My Reports Feed**: Filterable list of submitted reports (All, Active, Resolved, Cancelled) with status badges and search capability.
- **Report Timeline & Details**: Comprehensive incident detail view with private photo display via signed URLs, interactive location map, supporter count, cancellation for pending reports, and an immutable status timeline.
- **Citizen Notifications**: In-app alerts for ticket assignments, status updates, and resolution notices with unread badges.

### Worker
- **Worker Dashboard**: Operational overview showing assigned, accepted, and in-progress tasks, along with completion counts for the day.
- **Duty Status Toggle**: Switch between on-duty and off-duty; only on-duty workers are eligible for automated incident dispatch.
- **Live Location Synchronization**: Periodic GPS widget updating the worker's geographical coordinates in the database for proximity-based dispatch.
- **Assigned Reports Queue**: Dedicated view of all assigned tasks with status, severity badges, distance, and direct navigation links.
- **Task Lifecycle Workflow**: Linear status transitions:
  - `Assigned` &rarr; `Accepted`: Acknowledges ticket receipt.
  - `Accepted` &rarr; `In Progress`: Marks arrival on-site and start of cleanup operations.
  - `In Progress` &rarr; `Resolved`: Completes ticket with required resolution notes and mandatory proof photo.
- **Resolution Evidence & Notes**: Upload resolution photos with client compression to private storage before completing a ticket.
- **Collection Schedules**: View assigned routine municipal collection routes and scheduled pickup windows.
- **Worker Notifications**: Real-time notifications when new incidents are assigned or reassigned.

### Admin
- **Operations Dashboard**: Real-time municipal KPIs including total incidents, pending unassigned reports, active work in progress, resolved counts, and critical SLA breaches.
- **Master Report Management**: Comprehensive incident ledger with filtering by status, severity, waste type, and date, plus search across addresses and titles.
- **Worker Management**: Roster of municipal field personnel showing contact info, active duty status, current assigned workloads, and last known GPS locations.
- **Manual Assignment & Reassignment**: Assign unassigned reports to specific workers or reassign active reports with audit notes.
- **Automatic Assignment (Smart Dispatch)**: Automated worker selection RPC (`find_optimal_worker_for_report`) based on severity-weighted scoring combining worker proximity (`ST_Distance`) and current active ticket workload.
- **Collection Schedules**: Manage routine municipal garbage pickup schedules with zone names, geographical zone boundaries, recurrence frequencies (daily, weekly, biweekly, monthly), scheduled dates, and assigned drivers.
- **Full-Screen Dispatch Map**: Interactive municipal Leaflet map displaying active incident pins (color-coded by severity and status) and active field worker locations.
- **SLA Monitoring & Alerts**: Automated evaluation of municipal response targets based on incident severity, generating deduplicated breach alerts when assignment or resolution thresholds are exceeded.
- **Admin Notifications**: Dedicated notification center for operational alerts, SLA breaches, and unassigned incident warnings.

---

## Report Lifecycle

Incident tickets follow a strict linear state machine enforced at the database level by the `transition_report_status()` stored procedure with row-level locks (`SELECT ... FOR UPDATE`):

```
       [ Citizen Submits ]
                │
                ▼
           ┌──────────┐
           │ Reported │ ◄──┐ (Initial state; can be cancelled by submitter)
           └────┬─────┘    │
                │          │ (Admin or Auto-Assign)
                ▼          │
           ┌──────────┐    │
           │ Assigned │ ───┴── (Can be reassigned by Admin)
           └────┬─────┘
                │ (Worker clicks "Accept")
                ▼
           ┌──────────┐
           │ Accepted │
           └────┬─────┘
                │ (Worker arrives & clicks "Start Progress")
                ▼
         ┌─────────────┐
         │ In Progress │
         └──────┬──────┘
                │ (Worker uploads resolution photo & notes)
                ▼
           ┌──────────┐
           │ Resolved │ (Terminal state; immutable)
           └──────────┘

* Alternative Terminal State:
  Reported ──► Cancelled (Only permissible from 'Reported' status by citizen or admin)
```

Direct status modification via client-side REST updates is denied by Row Level Security; transitions must occur through authorized RPC functions that log each step to `report_timeline`.

---

## Technology Stack

The repository utilizes the following technologies:

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Frontend Core** | React | `^19.2.8` | Declarative UI components, state management, and hooks |
| **Build Tooling** | Vite | `^8.3.0` | High-performance build tool and development server |
| **Routing** | React Router | `^7.18.3` | Client-side routing with role-based route protection |
| **Backend & Database** | Supabase (PostgreSQL 15+) | `@supabase/supabase-js ^2.116.0` | Authentication, PostgreSQL database, RLS, Storage, Realtime |
| **Spatial Engine** | PostGIS | 3.x (PostgreSQL Extension) | Geography calculations (`ST_DWithin`, `ST_Distance`, GIST indexes) |
| **Mapping Engine** | Leaflet & React-Leaflet | `leaflet ^1.9.4`, `react-leaflet ^5.0.0` | Interactive mapping, draggable markers, and incident overlays |
| **Geocoding** | OpenStreetMap Nominatim | REST API | Reverse geocoding of coordinates to human-readable street addresses |
| **Image Compression**| browser-image-compression | `^2.0.2` | Client-side photo downsampling prior to upload |
| **Styling** | Vanilla CSS | CSS3 / Custom Properties | Custom design system (`index.css`, `styles/*.css`) with responsive styling |
| **Code Quality** | ESLint | `^10.10.0` | Linting with React Hooks and React Refresh configurations |
| **Version Control** | Git / GitHub | - | Source code versioning and branch management |

---

## Architecture

CleanAlert uses a modern **Client-to-BaaS architecture**, connecting a React Single Page Application (SPA) directly to Supabase services:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        REACT 19 FRONTEND (Vite)                        │
│                                                                        │
│   ┌───────────────────┐ ┌───────────────────┐ ┌────────────────────┐   │
│   │   Citizen Views   │ │   Worker Views    │ │    Admin Views     │   │
│   │ - Report Garbage  │ │ - Duty Toggle     │ │ - Operations Center│   │
│   │ - My Reports Feed │ │ - Task Workflow   │ │ - Dispatch Map     │   │
│   │ - Status Timeline │ │ - Resolution Proof│ │ - Schedules/Roster │   │
│   └─────────┬─────────┘ └─────────┬─────────┘ └─────────┬──────────┘   │
│             │                     │                     │              │
│   ┌─────────┴─────────────────────┴─────────────────────┴──────────┐   │
│   │             Context Layer: AuthContext, Role Guards            │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │ HTTPS / WSS
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          SUPABASE PLATFORM                             │
│                                                                        │
│  ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐  │
│  │   Supabase Auth    │ │  Supabase Storage  │ │ Supabase Realtime  │  │
│  │ - JWT Sessions     │ │ - report-photos    │ │ - Postgres CDC     │  │
│  │ - Role Verification│ │ - resolution-photos│ │ - WebSocket alerts │  │
│  └─────────┬──────────┘ └─────────┬──────────┘ └─────────┬──────────┘  │
│            │                      │                      │             │
│  ┌─────────┴──────────────────────┴──────────────────────┴──────────┐  │
│  │                     POSTGRESQL 15+ & PostGIS                     │  │
│  │                                                                  │  │
│  │  - Tables: profiles, reports, supporters, timeline, schedules    │  │
│  │  - Row Level Security (RLS) with Security Definer helpers         │  │
│  │  - Stored Procedures: check_duplicate_report, submit_report,     │  │
│  │    transition_status, auto_assign_report, evaluate_sla_alerts    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Database

The database schema is managed via SQL migrations located in `supabase/migrations/`:

| Migration File | Description |
| :--- | :--- |
| `20260913000001_extensions_and_enums.sql` | Enables `postgis` and `pgcrypto`; defines `user_role`, `report_status`, `garbage_type`, `severity_level`, `schedule_frequency`, and `schedule_status` ENUMs. |
| `20260913000002_core_tables.sql` | Creates `profiles`, `reports`, `report_supporters`, `report_timeline`, `collection_schedules`, and `notifications` tables with spatial GIST indexes and triggers. |
| `20260913000003_public_views_and_security_helpers.sql` | Defines `public_profiles` view and non-recursive security definer functions (`is_admin`, `is_worker`, `is_citizen`, `can_view_report`, `can_access_storage_photo`). |
| `20260913000004_rls_policies.sql` | Enforces Row Level Security across all core tables. |
| `20260913000005_rpc_functions.sql` | Implements core business logic: `check_duplicate_report`, `support_existing_report`, `submit_citizen_report`, `transition_report_status`, `cancel_garbage_report`. |
| `20260913000006_storage_buckets_and_policies.sql` | Configures private storage buckets (`report-photos`, `resolution-photos`) and access policies. |
| `20260919000001_phase2_operational_dispatch.sql` | Implements severity-weighted worker scoring (`find_optimal_worker_for_report`), `auto_assign_report`, and worker reassignment. |
| `20260919000002_phase4_sla_and_alerts.sql` | Creates SLA tracking targets and deduplicated operational alert generator (`evaluate_sla_alerts`). |
| `20260920000001_phase5_fleet_management.sql` | Creates `vehicles` and `vehicle_assignments` schema with RLS and realtime support. |

### Core Tables Summary
- **`profiles`**: Application users referenced to `auth.users(id)` with `role`, `is_active`, `current_location` (geography Point), and timestamp.
- **`reports`**: Central incidents table with geographical `location` (Point, 4326), `latitude`, `longitude`, `address`, `title`, `description`, `garbage_type`, `severity`, `status`, `photo_url`, `assigned_worker_id`, stage timestamps, `resolution_notes`, and `resolution_photo_url`.
- **`report_supporters`**: Tracks citizen upvotes on duplicate or existing reports; unique constraint on `(report_id, citizen_id)`.
- **`report_timeline`**: Immutable audit log recording every lifecycle transition with `actor_id`, `previous_status`, `new_status`, notes, and timestamp.
- **`collection_schedules`**: Municipal pickup schedules with zone name, polygon boundary (`zone_polygon`), recurrence frequency, date, time windows, and assigned worker.
- **`notifications`**: In-app user notifications linked to specific reports and events.
- **`vehicles` & `vehicle_assignments`**: Fleet registry and active assignment tracking.

---

## Authentication

Authentication is handled via **Supabase Auth** with client session management in `src/context/AuthContext.jsx`:
- Sign up generates an entry in `auth.users`, triggering the `handle_new_user()` database trigger which initializes a profile with `citizen` role.
- Role elevation (e.g., worker or admin) is restricted to database administrators or administrative SQL execution.
- Passwords and sessions use JWT bearer tokens stored in client storage and refreshed automatically by `@supabase/supabase-js`.
- Password reset and update flows are supported via `/forgot-password` and `/update-password`.
- Deactivated accounts (`is_active = false`) are intercepted at the root redirect and routed to an `<AccountDeactivated />` warning view.

---

## Security

CleanAlert enforces a multi-layer defense-in-depth model:

1. **Database Row Level Security (RLS)**:
   - All tables have RLS enabled with explicit `RESTRICTIVE` policies.
   - Citizens can only query their own reports, reports they support, or active un-resolved public pins.
   - Workers can only view reports assigned to them or relevant active tasks.
   - Admins possess comprehensive SELECT, UPDATE, and DELETE permissions.
2. **Security Definer Functions**:
   - Helper functions (`is_admin()`, `can_view_report()`, etc.) operate with `SET search_path = public, pg_temp` to prevent search-path hijacking.
   - Dedicated helpers query membership without triggering recursive RLS loops.
3. **Route Guards**:
   - `ProtectedRoute.jsx`: Redirects unauthenticated users to `/login`.
   - `RoleGuard.jsx`: Checks current user role against allowed roles (`['citizen']`, `['worker']`, `['admin']`) and blocks unauthorized access.
4. **Private Storage & Canonical Paths**:
   - Storage buckets are private (`public = false`). Direct public URLs do not exist.
   - Upload policies enforce ownership by prepending the user's UUID to the storage key (`report-photos/{user_id}/*`).
5. **Signed URLs**:
   - Photos are rendered using short-lived signed URLs generated via `supabase.storage.from(...).createSignedUrl()`.
6. **Concurrency Protection**:
   - Atomic status updates utilize `SELECT ... FOR UPDATE` row locks inside PostgreSQL to prevent race conditions when multiple workers or dispatchers interact with the same incident.

---

## Storage

Supabase Storage is configured with two private object buckets:

| Bucket Name | Access | Purpose |
| :--- | :--- | :--- |
| `report-photos` | Private (`public: false`) | Stores citizen incident evidence. Upload restricted to `report-photos/{citizen_id}/*`. |
| `resolution-photos` | Private (`public: false`) | Stores field worker proof of cleanup. Upload restricted to `resolution-photos/{worker_id}/*`. |

---

## Realtime

The application establishes live Supabase Realtime WebSocket subscriptions for:
- **Incident Updates**: Real-time status changes and assignments on the admin dispatch map and citizen report details view.
- **Worker Presence**: Real-time worker availability and coordinates updates on the administrative roster and dispatch map.
- **Notifications**: Instant delivery of ticket assignments and SLA breach notifications to the in-app notification center.

---

## Setup Instructions

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- A [Supabase](https://supabase.com/) project with PostGIS extension enabled
- Git

### 1. Clone the Repository
```bash
git clone <repository-url>
cd smart_managment_system
```

### 2. Install Dependencies
```bash
npm install
```
*(On Windows systems where PowerShell script execution is restricted, run `npm.cmd install`)*

### 3. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Edit `.env.local` with your Supabase credentials:
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
```

### 4. Apply Database Migrations
Apply the migrations in `supabase/migrations/` sequentially using the Supabase CLI or SQL Editor in the Supabase Dashboard:
1. `20260913000001_extensions_and_enums.sql`
2. `20260913000002_core_tables.sql`
3. `20260913000003_public_views_and_security_helpers.sql`
4. `20260913000004_rls_policies.sql`
5. `20260913000005_rpc_functions.sql`
6. `20260913000006_storage_buckets_and_policies.sql`
7. `20260919000001_phase2_operational_dispatch.sql`
8. `20260919000002_phase4_sla_and_alerts.sql`
9. `20260920000001_phase5_fleet_management.sql`

### 5. Run Local Development Server
```bash
npm run dev
```
*(On Windows PowerShell, run `npm.cmd run dev`)*

The application will be accessible at `http://localhost:5173`.

---

## Environment Variables

| Variable Name | Required | Description |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Yes | The Supabase project HTTPS endpoint URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | The Supabase anonymous/publishable client API key. |

*Note: Never place service-role keys or private credentials in client-side environment files.*

---

## Project Structure

```
smart_managment_system/
├── public/                     # Static assets (favicon, SVG icons)
├── src/
│   ├── assets/                 # Graphics and branding assets
│   ├── components/
│   │   ├── admin/              # Admin-specific components (DispatchMap, Badges)
│   │   ├── auth/               # Auth navigation and account state components
│   │   ├── citizen/            # Citizen components (LocationPicker, Timeline, Badges)
│   │   └── worker/             # Worker components (WorkerLocationWidget)
│   ├── context/
│   │   └── AuthContext.jsx     # Authentication provider and session state
│   ├── lib/
│   │   └── supabase.ts         # Supabase client initialization
│   ├── pages/
│   │   ├── admin/              # Admin pages (Dashboard, Reports, Workers, Schedules, etc.)
│   │   ├── auth/               # Auth pages (Login, Register, Password flows)
│   │   ├── citizen/            # Citizen pages (Dashboard, ReportGarbage, MyReports, etc.)
│   │   └── worker/             # Worker pages (Dashboard, Reports, Tasks, etc.)
│   ├── routes/
│   │   ├── ProtectedRoute.jsx  # Authentication gate
│   │   └── RoleGuard.jsx       # Role-based authorization gate
│   ├── styles/                 # Custom CSS stylesheets per module
│   ├── utils/                  # Utilities (imageCompression, SLA, fleet formatting)
│   ├── App.jsx                 # Route declarations and root redirect logic
│   ├── index.css               # Global theme tokens and base styles
│   └── main.jsx                # Application root entry point
├── supabase/
│   └── migrations/             # Sequential SQL migration files
├── .env.example                # Environment variable template
├── .gitignore                  # Git ignore rules
├── eslint.config.js            # ESLint flat configuration
├── index.html                  # HTML document template
├── package.json                # Project dependencies and scripts
└── vite.config.js              # Vite configuration
```

---

## Validation

Verify project health and lint compliance:

```bash
# Run lint check (0 errors, 0 warnings expected)
npm run lint

# Run production build
npm run build
```
*(On Windows systems where script execution is disabled, use `npm.cmd run lint` and `npm.cmd run build`)*

---

## Current Limitations

- **Reverse Geocoding Rate Limits**: Reverse geocoding calls the public OpenStreetMap Nominatim API directly from the client, which enforces an upstream limit of 1 request per second.
- **In-App Notifications Only**: Push notifications are delivered through WebSocket realtime channels within active browser sessions; third-party WebPush or SMS gateways are not currently attached.
- **Offline Mode**: While photo compression is handled client-side, offline queuing of reports without an active internet connection is not yet supported.

---

## Future Work

- **AI-Powered Waste Classification & Resolution Verification**: Integration of computer vision models (e.g. YOLOv8 / Gemini Vision) to automatically classify waste types and verify before/after resolution photographs.
- **Full Fleet Telemetry Integration**: Integration with vehicle IoT hardware for real-time GPS telemetry, fuel tracking, and automated route optimization.
- **Server-Side Reverse Geocoding Proxy**: Deploy a Supabase Edge Function with coordinate rounding and caching to prevent client-side Nominatim rate limiting.
- **WebPush & SMS Notifications**: Native browser push notifications and automated SMS dispatch alerts for field personnel.
- **Offline-First PWA Support**: Service Worker caching with IndexedDB draft storage for citizens in poor network areas.
