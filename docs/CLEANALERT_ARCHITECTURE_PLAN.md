# CleanAlert: Technical Architecture & System Design Plan

## Executive Summary

**CleanAlert** is a municipal uncollected garbage reporting and rapid-dispatch management system designed for three core personas: **Citizens**, **Field Workers**, and **Municipal Administrators**.

This document outlines the technical architecture, database schema, role-based security model, spatial processing algorithms, state machines, and implementation roadmap for rebuilding CleanAlert from scratch. The system leverages a **React 19 + TypeScript + Vite** frontend coupled with **Supabase (PostgreSQL 15+ with PostGIS, Supabase Auth, Row Level Security, Storage, Realtime, and Edge Functions)**, completely eliminating the need for a separate Node.js/Express backend service.

---

## 1. Recommended Technology Stack

| Layer | Technology | Rationale & Justification |
| :--- | :--- | :--- |
| **Frontend Framework** | **React 19 + TypeScript (Vite 8)** | Provides modern React capabilities, blazing fast HMR development via Vite, and end-to-end type safety generated directly from the PostgreSQL schema. |
| **Styling & Design System** | **Tailwind CSS + shadcn/ui (Radix Primitives)** | Delivers high-density, accessible, modern UI components (Modals, Sheets, Dropdowns, Cards, Badges, Tabs) with customized municipal aesthetics (clean emerald/slate palette, glassmorphism, responsive mobile-first layouts). |
| **Icons & Visuals** | **Lucide React (`lucide-react`)** | Consistent, lightweight SVG icon suite for municipal utilities (trash, recycling, alert-triangle, map-pin, check-circle, shield, truck, user). |
| **Routing** | **React Router v7 / v6** | Declarative nested routing with layout boundaries, protected route wrappers, and role-based access gates (`CitizenRoute`, `WorkerRoute`, `AdminRoute`). |
| **Server State & Caching** | **TanStack Query v5 (`@tanstack/react-query`)** | Robust data synchronization, cache invalidation, polling fallbacks, optimistic updates, and declarative mutations. |
| **Forms & Validation** | **React Hook Form + Zod** | High-performance, un-controlled form management with strict schema validation shared with database constraints. |
| **Mapping & Geolocation** | **Leaflet + React-Leaflet + CartoDB / OSM** | Lightweight, battle-tested mapping engine compatible with OpenStreetMap tiles (CartoDB Positron for clean contrast) without requiring costly commercial Google Maps API keys. |
| **Client Compression** | **browser-image-compression** | Client-side photo downsampling (max 1280px, ~300KB WebP) prior to upload, critical for field workers and citizens on spotty 3G/4G mobile networks. |
| **Database & GIS Engine** | **Supabase PostgreSQL 15+ with PostGIS** | Spatial geography engine enabling sub-millisecond 30-meter radius duplicate checks (`ST_DWithin`), spatial worker proximity calculations (`ST_Distance`), and polygon collection zones. |
| **Authentication & RLS** | **Supabase Auth + Row Level Security (RLS)** | JWT-based auth with custom role claims, enforcing tenant and role isolation directly at the database engine level. |
| **File Storage** | **Supabase Storage** | S3-compatible, CDN-backed object storage with bucket-level RLS policies for citizen proof and worker resolution photos. |
| **Realtime Engine** | **Supabase Realtime (CDC & Presence)** | WebSocket subscriptions for immediate task assignment notifications, live status timeline changes, and admin dispatch map updates. |
| **Serverless Logic** | **PostgreSQL Stored Procedures (PL/pgSQL) + Supabase Edge Functions (Deno/TS)** | Atomic database transactions for race condition prevention, worker auto-assignment scoring, and rate-limited reverse-geocoding proxies. |

### Why a Separate Express/Node Backend is Rejected
1. **Zero Added Value**: PostgreSQL + PostgREST natively handles 100% of standard REST operations with strict security through Row Level Security (RLS).
2. **Spatial Performance**: Proximity deduplication (30m) and nearest-worker calculation run directly inside PostgreSQL memory via PostGIS. Routing this through an Express server introduces redundant network hops and serialization latency.
3. **Atomic Concurrency**: Preventing race conditions when multiple workers attempt to accept the same task is solved cleanly via PostgreSQL row locks (`SELECT ... FOR UPDATE`), which an external stateless Express cluster cannot coordinate without a distributed lock (e.g. Redis).
4. **Maintenance Overhead**: Eliminating Express removes dual-auth verification, extra Docker/server deployments, environment synchronization, and API boilerplate.

---

## 2. Overall System Architecture

```
                                  +-------------------------------------------------------------+
                                  |                     CLIENT LAYER (PWA)                      |
                                  |  React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui    |
                                  |                                                             |
                                  |  +-------------------+ +-----------------+ +--------------+ |
                                  |  |   Citizen View    | |   Worker View   | |  Admin View  | |
                                  |  | - Quick Report    | | - Duty Toggle   | | - Dispatch   | |
                                  |  | - GPS & Photo     | | - Queue List    | | - Roster     | |
                                  |  | - Status Timeline | | - Accept/Resolve| | - Schedules  | |
                                  |  +---------+---------+ +--------+--------+ +-------+------+ |
                                  +------------|--------------------|------------------|--------+
                                               |                    |                  |
                                               v                    v                  v
                                  +-------------------------------------------------------------+
                                  |                  SUPABASE API GATEWAY (KONG)                |
                                  |           HTTPS / TLS 1.3 / JWT Token Validation            |
                                  +------+-------------------+--------------------+-------------+
                                         |                   |                    |
                 +-----------------------+                   |                    +------------------------+
                 |                                           |                                             |
                 v                                           v                                             v
+---------------------------------+        +-----------------------------------+         +----------------------------------+
|          SUPABASE AUTH          |        |        POSTGREST REST API         |         |         SUPABASE REALTIME        |
|  - JWT Issuance & Refresh       |        |  - CRUD with RLS Enforcement      |         |  - Postgres CDC Replication      |
|  - Role claims (citizen/worker) |        |  - Auto-generated OpenAPI         |         |  - WebSocket channels            |
+---------------------------------+        +-----------------+-----------------+         +----------------------------------+
                                                             |
                                                             v
+---------------------------------------------------------------------------------------------------------------------------+
|                                              POSTGRESQL 15+ WITH POSTGIS                                                  |
|                                                                                                                           |
|  +-------------------------------------+  +------------------------------------+  +------------------------------------+  |
|  |           Database Tables           |  |          PostGIS Functions         |  |         Atomic PL/pgSQL RPC        |  |
|  | - profiles (locations & roles)      |  | - ST_DWithin (30m Dedup)           |  | - submit_citizen_report()          |  |
|  | - reports (geography points)        |  | - ST_Distance (Nearest Worker)     |  | - accept_report_atomic()           |  |
|  | - report_timeline (audit log)       |  | - ST_Contains (Zones/Polygons)     |  | - transition_report_status()       |  |
|  | - collection_schedules              |  | - Spatial GIST Indexes             |  | - auto_assign_worker()             |  |
|  | - notifications (in-app alerts)     |  |                                    |  |                                    |  |
|  +-------------------------------------+  +------------------------------------+  +------------------------------------+  |
|                                                                                                                           |
|  +---------------------------------------------------------------------------------------------------------------------+  |
|  |                                                Row Level Security (RLS)                                             |  |
|  |  - Strict isolation: Citizens edit own drafts; Workers update assigned; Admins full control                        |  |
|  +---------------------------------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------------------------------+
                 ^                                           ^                                             ^
                 |                                           |                                             |
+----------------+----------------+        +-----------------+-----------------+         +-----------------+----------------+
|        SUPABASE STORAGE         |        |     SUPABASE EDGE FUNCTIONS       |         |        EXTERNAL SERVICES         |
|  - Bucket: report-photos        |        |  - Deno / TypeScript              |         |  - OpenStreetMap Nominatim       |
|  - Bucket: resolution-photos    |        |  - reverse-geocode (OSM proxy)    |         |    (Reverse Geocoding)           |
|  - RLS file ownership policies  |        |  - push-notifications (WebPush)   |         |  - CartoDB / OSM Tile Servers    |
+---------------------------------+        +-----------------------------------+         +----------------------------------+
```

---

## 3. Frontend Architecture

### 3.1 Modular Feature Structure
The application follows a domain-driven feature layout:

```
src/
├── app/                  # Application providers, router config, global styles
├── assets/               # Static assets & SVG icons
├── components/           # Shared UI component primitives (shadcn/ui, layout wrappers)
│   ├── ui/               # Button, Dialog, Badge, Card, Select, Input, Dropdown, Sonner
│   ├── feedback/         # ErrorBoundary, SkeletonLoader, EmptyState
│   └── layout/           # Navbar, Sidebar, MobileNav, Footer
├── features/             # Domain modules
│   ├── auth/             # Login, Register, PasswordReset, AuthGuard, RoleGuard
│   ├── citizen/          # ReportSubmissionModal, DuplicateWarningBanner, MyReportsList, ReportTimelineView
│   ├── worker/           # DutyToggleSwitch, AssignedTasksQueue, TaskDetailView, ResolutionModal
│   ├── admin/            # DispatchLiveMap, WorkerRosterTable, CollectionScheduleManager, AnalyticsCards
│   ├── map/              # LeafletMap, LocationPicker, MarkerClusters, RadiusCircleOverlay
│   └── notifications/    # NotificationBell, NotificationDropdown, RealtimeToastListener
├── hooks/                # Global React hooks (useGeolocation, useRealtime, useDebounce)
├── lib/                  # Library configurations (supabaseClient.ts, queryClient.ts, utils.ts)
├── services/             # API abstractions & Edge Function proxies
└── types/                # TypeScript interfaces, database generated types, enums
```

### 3.2 Layout & Routing Model
```
/ (RootLayout)
├── /login                    -> Public Auth
├── /register                 -> Public Registration (default: citizen)
│
├── /citizen (CitizenLayout)  -> Protected (Citizen / Admin)
│   ├── /citizen              -> Overview & Quick Report
│   ├── /citizen/report/new   -> Live GPS Garbage Reporter
│   ├── /citizen/reports      -> My Submissions & Historical Tracking
│   └── /citizen/reports/:id  -> Detailed Progress Timeline
│
├── /worker (WorkerLayout)    -> Protected (Worker / Admin)
│   ├── /worker               -> Task Queue (Assigned, Accepted, In Progress)
│   ├── /worker/map           -> Route Map & Assigned Pins
│   └── /worker/tasks/:id     -> Task Execution, Status Updater & Photo Resolution
│
└── /admin (AdminLayout)      -> Protected (Admin Only)
    ├── /admin                -> Dashboard & Realtime Operations Center
    ├── /admin/dispatch       -> Live PostGIS Map (Reports, Workers, Zones)
    ├── /admin/workers        -> Field Crew Management & Workload Balancer
    ├── /admin/schedules      -> Routine Municipal Pickup Schedules
    └── /admin/reports        -> Master Reports Ledger & Manual Overrides
```

### 3.3 State Management & Data Fetching Architecture
1. **Server State**: Managed exclusively through `@tanstack/react-query`. Query keys are structured hierarchically:
   - `['reports', 'citizen', userId]`
   - `['reports', 'worker', workerId, statusFilter]`
   - `['reports', 'admin', { status, severity, zone }]`
   - `['workers', 'active']`
   - `['notifications', userId]`
2. **Client State**:
   - `useAuthStore` (Zustand or Context): User profile, active role, session tokens.
   - `useWorkerStore`: Duty toggle state (`is_active: boolean`), current GPS broadcast timestamp.
   - `useMapStore`: Current viewport (center lat/lng, zoom level, active filters).
3. **Realtime Invalidation**:
   - A single custom hook `useSupabaseRealtimeSync` listens to Supabase Postgres CDC events on the `reports` and `notifications` tables.
   - Upon receiving an `INSERT` or `UPDATE`, it targets only the relevant query keys in TanStack Query via `queryClient.invalidateQueries({ queryKey })`, ensuring zero duplicate fetches and fresh UI state.

---

## 4. Database Architecture

### 4.1 Extensions & Schemas
```sql
-- Enable necessary PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
```

### 4.2 Enums
```sql
CREATE TYPE user_role AS ENUM ('citizen', 'worker', 'admin');
CREATE TYPE report_status AS ENUM ('Reported', 'Accepted', 'In Progress', 'Resolved', 'Cancelled');
CREATE TYPE garbage_type AS ENUM ('organic', 'plastic', 'paper', 'metal', 'electronic', 'hazardous', 'construction', 'bulk', 'general');
CREATE TYPE severity_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE schedule_frequency AS ENUM ('daily', 'weekly', 'biweekly', 'monthly');
CREATE TYPE schedule_status AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');
```

### 4.3 Table Definitions

#### 1. `profiles`
Extends `auth.users` with municipal domain data and real-time worker telemetry.
```sql
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone_number TEXT,
    role user_role NOT NULL DEFAULT 'citizen',
    avatar_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true, -- For workers: On-Duty / Off-Duty toggle
    current_location GEOGRAPHY(Point, 4326), -- Live GPS of worker
    last_location_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_location_gist ON public.profiles USING GIST(current_location) WHERE role = 'worker';
```

#### 2. `reports`
Core entity for waste reports with spatial coordinates.
```sql
CREATE TABLE public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    citizen_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    garbage_type garbage_type NOT NULL DEFAULT 'general',
    severity severity_level NOT NULL DEFAULT 'medium',
    status report_status NOT NULL DEFAULT 'Reported',
    
    -- Spatial location stored as 4326 geography point
    location GEOGRAPHY(Point, 4326) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    address TEXT NOT NULL,
    
    photo_url TEXT,
    assigned_worker_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    
    -- Timestamps for milestone lifecycle tracking
    assigned_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    in_progress_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    
    -- Resolution deliverables
    resolution_notes TEXT,
    resolution_photo_url TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Crucial Spatial and Filtering Indexes
CREATE INDEX idx_reports_location_gist ON public.reports USING GIST(location);
CREATE INDEX idx_reports_status ON public.reports(status);
CREATE INDEX idx_reports_assigned_worker ON public.reports(assigned_worker_id);
CREATE INDEX idx_reports_citizen ON public.reports(citizen_id);
CREATE INDEX idx_reports_created_at ON public.reports(created_at DESC);
```

#### 3. `report_timeline`
Audit trail of every state transition.
```sql
CREATE TABLE public.report_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    previous_status report_status,
    new_status report_status NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_timeline_report_id ON public.report_timeline(report_id);
```

#### 4. `collection_schedules`
Municipal recurring pickup zones and routes managed by Admins.
```sql
CREATE TABLE public.collection_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    zone_name TEXT NOT NULL,
    zone_polygon GEOGRAPHY(Polygon, 4326), -- Spatial boundary of route
    frequency schedule_frequency NOT NULL DEFAULT 'weekly',
    scheduled_date DATE NOT NULL,
    scheduled_start_time TIME NOT NULL,
    scheduled_end_time TIME NOT NULL,
    assigned_worker_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status schedule_status NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_schedules_date ON public.collection_schedules(scheduled_date);
CREATE INDEX idx_schedules_assigned_worker ON public.collection_schedules(assigned_worker_id);
```

#### 5. `notifications`
Realtime in-app notification ledger.
```sql
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL, -- 'assignment', 'status_update', 'duplicate_alert'
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_notifications_user_read ON public.notifications(user_id, is_read);
```

---

## 5. Authentication and Role Model

### 5.1 Auth Synchronization Trigger
When a user signs up via Supabase Auth, a PostgreSQL trigger automatically populates the `public.profiles` table with default values.

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Citizen User'),
        COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'citizen'::user_role)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### 5.2 Role Enforcement & Security Definer Functions
To avoid repetitive subqueries in RLS policies, helper functions run in `SECURITY DEFINER` mode:

```sql
-- Retrieve the authenticated user's role
CREATE OR REPLACE FUNCTION public.get_current_role()
RETURNS user_role AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if current user is an admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'admin'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if current user is a worker
CREATE OR REPLACE FUNCTION public.is_worker()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'worker'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

---

## 6. Row Level Security (RLS) Strategy

Row Level Security is enabled on **every table** in `public`.

```sql
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
```

### 6.1 `profiles` Policies
```sql
-- Read: Users can view their own profile; Admins can view all; Workers can view basic info
CREATE POLICY "Profiles readable by owner and admin"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id OR public.is_admin() OR role = 'worker');

-- Update: Users can update their own personal info (excluding role)
CREATE POLICY "Users can update own personal info"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id AND 
        role = (SELECT role FROM public.profiles WHERE id = auth.uid()) -- Prevent self-role elevation
    );

-- Admin: Admins can update any profile (assign roles, zones)
CREATE POLICY "Admins full update profiles"
    ON public.profiles FOR UPDATE
    USING (public.is_admin());
```

### 6.2 `reports` Policies
```sql
-- Read:
-- 1. Citizens can view all active reports (to see nearby map pins) and their own reports
-- 2. Workers can view reports assigned to them or unassigned in their zone
-- 3. Admins can view all
CREATE POLICY "Reports select policy"
    ON public.reports FOR SELECT
    USING (
        public.is_admin() OR
        auth.uid() = citizen_id OR
        auth.uid() = assigned_worker_id OR
        status IN ('Reported', 'Accepted', 'In Progress') -- Public active pins for duplicate prevention
    );

-- Insert: Citizens and Admins can create reports
CREATE POLICY "Citizens create reports"
    ON public.reports FOR INSERT
    WITH CHECK (auth.uid() = citizen_id OR public.is_admin());

-- Update:
-- 1. Admins have full update rights
-- 2. Assigned workers can update status, notes, resolution photo
-- 3. Citizens can cancel their report only if still 'Reported'
CREATE POLICY "Admins update reports"
    ON public.reports FOR UPDATE
    USING (public.is_admin());

CREATE POLICY "Assigned worker update report progress"
    ON public.reports FOR UPDATE
    USING (auth.uid() = assigned_worker_id AND public.is_worker())
    WITH CHECK (auth.uid() = assigned_worker_id);

CREATE POLICY "Citizen cancel own pending report"
    ON public.reports FOR UPDATE
    USING (auth.uid() = citizen_id AND status = 'Reported')
    WITH CHECK (auth.uid() = citizen_id AND status = 'Cancelled');
```

### 6.3 `collection_schedules` Policies
```sql
CREATE POLICY "Schedules viewable by all authenticated users"
    ON public.collection_schedules FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Admins manage schedules"
    ON public.collection_schedules FOR ALL
    USING (public.is_admin());
```

### 6.4 `notifications` Policies
```sql
CREATE POLICY "Users manage own notifications"
    ON public.notifications FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users mark own notifications read"
    ON public.notifications FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```

---

## 7. Storage Strategy

### 7.1 Buckets
Two dedicated Supabase storage buckets:
1. `report-photos` (Public bucket): Stores initial evidence uploaded by Citizens.
2. `resolution-photos` (Public bucket): Stores completion proof uploaded by Workers.

### 7.2 Storage RLS Policies
```sql
-- report-photos: Citizens can upload only to their own directory prefix
CREATE POLICY "Citizens upload report photo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'report-photos' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- resolution-photos: Workers can upload resolution photos
CREATE POLICY "Workers upload resolution photo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'resolution-photos' AND
    public.is_worker()
);

-- Anyone authenticated can view uploaded municipal photos
CREATE POLICY "Public read for municipal photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id IN ('report-photos', 'resolution-photos'));
```

### 7.3 Client-Side Image Pre-Processing
To guarantee swift uploads and prevent storage bloat:
* Use `browser-image-compression` on the client.
* Target constraints: Max file size **500 KB**, max dimensions **1280x1280**, output format **image/webp**.
* Strips EXIF metadata to protect citizen privacy while retaining GPS within the explicit database coordinates.

---

## 8. Realtime Strategy

### 8.1 Supabase Realtime Channels
1. **`channel:citizen-notifications:{userId}`**:
   - Subscribes to `INSERT` on `public.notifications` filtered by `user_id = eq.{userId}`.
   - Triggers in-app badge counter increments and toast notifications (e.g., *"Your report #104 has been accepted by Field Worker John"*).
2. **`channel:worker-tasks:{workerId}`**:
   - Subscribes to `INSERT` and `UPDATE` on `public.reports` where `assigned_worker_id = eq.{workerId}`.
   - Automatically injects newly assigned tasks into the worker's active queue without manual page refreshing.
3. **`channel:admin-dispatch-map`**:
   - Subscribes to all `INSERT` and `UPDATE` events on `public.reports` to keep the municipal live operations map updated in real time.
4. **`channel:worker-telemetry` (Realtime Presence)**:
   - Workers broadcast their current coordinates via Supabase Presence every 30 seconds when On-Duty.
   - This prevents heavy database write loads for transient GPS updates, saving DB writes for permanent checkpoints.

---

## 9. Edge Functions & Server-Side Logic Requirements

All mission-critical business logic requiring strict atomicity, spatial evaluation, and race condition prevention is implemented via **PostgreSQL Stored Procedures (PL/pgSQL)** with PostGIS. External integrations run via **Supabase Edge Functions**.

### 9.1 Proximity Duplicate Detection (~30 Meters)
When a citizen reports uncollected waste, the system verifies whether an unresolved report already exists within 30 meters.

```sql
CREATE OR REPLACE FUNCTION public.check_duplicate_report(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_radius_meters DOUBLE PRECISION DEFAULT 30.0
)
RETURNS TABLE (
    is_duplicate BOOLEAN,
    existing_report_id UUID,
    distance_meters DOUBLE PRECISION,
    existing_status report_status
) AS $$
DECLARE
    v_point GEOGRAPHY;
BEGIN
    v_point := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography;
    
    RETURN QUERY
    SELECT 
        true AS is_duplicate,
        r.id AS existing_report_id,
        ST_Distance(r.location, v_point) AS distance_meters,
        r.status AS existing_status
    FROM public.reports r
    WHERE 
        r.status NOT IN ('Resolved', 'Cancelled') AND
        ST_DWithin(r.location, v_point, p_radius_meters)
    ORDER BY distance_meters ASC
    LIMIT 1;
    
    -- If no record found, return empty/false
    IF NOT FOUND THEN
        is_duplicate := false;
        existing_report_id := NULL;
        distance_meters := NULL;
        existing_status := NULL;
        RETURN NEXT;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

### 9.2 Auto-Assignment Engine (Distance + Workload Balancing)
New reports are automatically assigned to an active, on-duty worker based on a composite score:
$$\text{Score} = (\text{Distance in km} \times 0.7) + (\text{Active Tasks Count} \times 0.3)$$
The candidate with the lowest score is selected.

```sql
CREATE OR REPLACE FUNCTION public.find_optimal_worker_for_report(
    p_report_location GEOGRAPHY
)
RETURNS UUID AS $$
DECLARE
    v_selected_worker_id UUID;
BEGIN
    SELECT 
        w.id INTO v_selected_worker_id
    FROM public.profiles w
    LEFT JOIN (
        -- Calculate current active workload
        SELECT assigned_worker_id, COUNT(*) AS active_load
        FROM public.reports
        WHERE status IN ('Accepted', 'In Progress')
        GROUP BY assigned_worker_id
    ) load ON load.assigned_worker_id = w.id
    WHERE 
        w.role = 'worker' AND 
        w.is_active = true AND
        w.current_location IS NOT NULL
    ORDER BY (
        -- Composite score: distance (km) + current active workload
        (ST_Distance(w.current_location, p_report_location) / 1000.0 * 0.7) + 
        (COALESCE(load.active_load, 0) * 0.3)
    ) ASC
    LIMIT 1;

    RETURN v_selected_worker_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

### 9.3 Atomic Report Submission Transaction
Combines duplicate verification, insertion, auto-assignment, timeline recording, and worker notification into a single atomic database operation.

```sql
CREATE OR REPLACE FUNCTION public.submit_garbage_report(
    p_title TEXT,
    p_description TEXT,
    p_garbage_type garbage_type,
    p_severity severity_level,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_address TEXT,
    p_photo_url TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_citizen_id UUID := auth.uid();
    v_report_location GEOGRAPHY;
    v_duplicate RECORD;
    v_assigned_worker_id UUID;
    v_report_id UUID;
BEGIN
    v_report_location := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography;
    
    -- 1. Check for duplicate within 30 meters
    SELECT * INTO v_duplicate FROM public.check_duplicate_report(p_latitude, p_longitude, 30.0);
    IF v_duplicate.is_duplicate THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'DUPLICATE_REPORT',
            'message', 'An active report already exists within 30 meters of this location.',
            'existing_report_id', v_duplicate.existing_report_id,
            'distance_meters', ROUND(v_duplicate.distance_meters::numeric, 1)
        );
    END IF;

    -- 2. Determine best active worker
    v_assigned_worker_id := public.find_optimal_worker_for_report(v_report_location);

    -- 3. Insert report
    INSERT INTO public.reports (
        citizen_id, title, description, garbage_type, severity, status,
        location, latitude, longitude, address, photo_url,
        assigned_worker_id, assigned_at
    ) VALUES (
        v_citizen_id, p_title, p_description, p_garbage_type, p_severity, 'Reported',
        v_report_location, p_latitude, p_longitude, p_address, p_photo_url,
        v_assigned_worker_id, CASE WHEN v_assigned_worker_id IS NOT NULL THEN now() ELSE NULL END
    ) RETURNING id INTO v_report_id;

    -- 4. Record initial timeline
    INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
    VALUES (v_report_id, v_citizen_id, NULL, 'Reported', 'Report submitted by citizen');

    -- 5. Notify assigned worker (if found)
    IF v_assigned_worker_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, report_id, title, message, type)
        VALUES (
            v_assigned_worker_id,
            v_report_id,
            'New Task Assigned',
            'A new garbage report at ' || p_address || ' has been assigned to you.',
            'assignment'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'report_id', v_report_id,
        'assigned_worker_id', v_assigned_worker_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 9.4 Concurrency & Race Condition Protection: Worker Status Transition
Prevents race conditions where two workers attempt to accept the same report or update it simultaneously using row-level locking (`FOR UPDATE`).

```sql
CREATE OR REPLACE FUNCTION public.transition_report_status(
    p_report_id UUID,
    p_target_status report_status,
    p_notes TEXT DEFAULT NULL,
    p_resolution_photo_url TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_worker_id UUID := auth.uid();
    v_report RECORD;
BEGIN
    -- 1. Lock the row exclusively to prevent concurrent updates
    SELECT * INTO v_report
    FROM public.reports
    WHERE id = p_report_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Report not found.');
    END IF;

    -- 2. Verify worker assignment or admin override
    IF v_report.assigned_worker_id != v_worker_id AND NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', 'You are not assigned to this report.');
    END IF;

    -- 3. Strict State Machine Validation
    -- Reported -> Accepted -> In Progress -> Resolved
    IF v_report.status = 'Reported' AND p_target_status != 'Accepted' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Report must be Accepted first.');
    ELSIF v_report.status = 'Accepted' AND p_target_status != 'In Progress' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Report must move to In Progress before Resolution.');
    ELSIF v_report.status = 'In Progress' AND p_target_status != 'Resolved' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Report can only transition from In Progress to Resolved.');
    ELSIF v_report.status = 'Resolved' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Report is already resolved.');
    END IF;

    -- 4. Enforce mandatory photo on resolution
    IF p_target_status = 'Resolved' AND (p_resolution_photo_url IS NULL OR length(trim(p_resolution_photo_url)) = 0) THEN
        RETURN jsonb_build_object('success', false, 'message', 'A completion photo is required to resolve a report.');
    END IF;

    -- 5. Execute state update
    UPDATE public.reports
    SET 
        status = p_target_status,
        accepted_at = CASE WHEN p_target_status = 'Accepted' THEN now() ELSE accepted_at END,
        in_progress_at = CASE WHEN p_target_status = 'In Progress' THEN now() ELSE in_progress_at END,
        resolved_at = CASE WHEN p_target_status = 'Resolved' THEN now() ELSE resolved_at END,
        resolution_notes = COALESCE(p_notes, resolution_notes),
        resolution_photo_url = COALESCE(p_resolution_photo_url, resolution_photo_url),
        updated_at = now()
    WHERE id = p_report_id;

    -- 6. Record timeline entry
    INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
    VALUES (p_report_id, v_worker_id, v_report.status, p_target_status, p_notes);

    -- 7. Notify Citizen
    IF v_report.citizen_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, report_id, title, message, type)
        VALUES (
            v_report.citizen_id,
            p_report_id,
            'Report Update: ' || p_target_status,
            'Your garbage report has moved to status: ' || p_target_status,
            'status_update'
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'status', p_target_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 9.5 Supabase Edge Function: `reverse-geocode`
To prevent leaking municipal API tokens, avoid client-side CORS issues, and strictly respect OpenStreetMap Nominatim's acceptable use policy (max 1 req/sec with custom `User-Agent`):

* **Path**: `supabase/functions/reverse-geocode/index.ts`
* **Functionality**:
  1. Accepts `{ latitude, longitude }`.
  2. Rounds coordinates to 4 decimal places (~11 meters) to use as an in-memory cache key.
  3. Checks cache; if miss, queries Nominatim with header `User-Agent: CleanAlert-Municipal-System/1.0`.
  4. Returns structured address components (`road`, `suburb`, `city`, `postcode`, `display_name`).

---

## 10. External API & Integration Requirements

1. **OpenStreetMap Nominatim / Photon API**:
   - Used for translating GPS coordinates to human-readable street addresses.
   - Access: Proxied through Supabase Edge Function to enforce caching and prevent rate-limit bans.
2. **OpenStreetMap / CartoDB Tile Service**:
   - URL: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png`
   - Free, fast, high-contrast, modern municipal tile style.
3. **Browser Native Geolocation API**:
   - Uses `navigator.geolocation.getCurrentPosition` and `navigator.geolocation.watchPosition`.
   - Settings: `enableHighAccuracy: true`, `timeout: 10000`, `maximumAge: 0`.
   - Fallback: Draggable pin on the Leaflet map if GPS permissions are denied.

---

## 11. End-to-End Data Flows

### 11.1 Citizen Garbage Reporting Flow
```
[Citizen Client]                       [Supabase / PostGIS]                     [Assigned Worker]
       |                                         |                                      |
       | 1. Acquire GPS (lat, lng)               |                                      |
       | 2. Fetch Address via Edge Function      |                                      |
       | 3. Upload photo -> report-photos        |                                      |
       | 4. Call submit_garbage_report()         |                                      |
       |---------------------------------------->|                                      |
       |                                         | 5. Run ST_DWithin(30m dedup check)   |
       |                                         |    [Duplicate? Return 409 conflict]  |
       |                                         | 6. Calculate optimal worker (PostGIS)|
       |                                         | 7. Insert report & timeline          |
       |                                         | 8. Insert notification record        |
       | 9. Confirmation + Tracking ID           |                                      |
       |<----------------------------------------| 10. Realtime Event (New Task)        |
       |                                         |------------------------------------->|
```

### 11.2 Worker Task Execution & Resolution Flow
```
[Assigned Worker]                      [Supabase / PostGIS]                     [Citizen Client]
       |                                         |                                      |
       | 1. Receives assignment notification     |                                      |
       | 2. Clicks "Accept Report"               |                                      |
       |    Calls transition_report_status()     |                                      |
       |---------------------------------------->| (SELECT ... FOR UPDATE row lock)     |
       |                                         | Updates status -> 'Accepted'         |
       | 3. Arrives on site; clicks "In Progress"| Logs timeline & creates notification |
       |---------------------------------------->|                                      |
       |                                         | Updates status -> 'In Progress'      |
       | 4. Cleans site; captures proof photo    |                                      |
       | 5. Uploads -> resolution-photos bucket  |                                      |
       | 6. Calls transition_report_status(      |                                      |
       |    target: 'Resolved', photo, notes)    |                                      |
       |---------------------------------------->|                                      |
       |                                         | Updates status -> 'Resolved'         |
       |                                         | Creates completion notification      |
       | 7. Task cleared from active queue       | 8. Realtime alert: "Report Resolved" |
       |<----------------------------------------|------------------------------------->|
```

### 11.3 Admin Operations & Collection Scheduling Flow
```
[Municipal Admin]                      [Supabase / PostGIS]                     [Field Crew]
       |                                         |                                      |
       | 1. Opens Operations Command Map         |                                      |
       | 2. Subscribes to live reports & crew    |                                      |
       |<=======================================>| (Bi-directional Realtime updates)    |
       | 3. Creates Scheduled Zone Collection    |                                      |
       |    (Draws polygon, sets date, crew)     |                                      |
       |---------------------------------------->|                                      |
       |                                         | Inserts into collection_schedules    |
       |                                         | Notifies assigned worker/crew        |
       |                                         |------------------------------------->|
       | 4. Manual override (reassign report)    |                                      |
       |---------------------------------------->| Updates assigned_worker_id           |
```

---

## 12. Project Directory Structure

```
smart_managment_system/
├── .env.example
├── .gitignore
├── README.md
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
│
├── docs/
│   └── CLEANALERT_ARCHITECTURE_PLAN.md    # This master document
│
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 20260912000001_initial_schema.sql
│   │   ├── 20260912000002_postgis_and_spatial.sql
│   │   ├── 20260912000003_rls_policies.sql
│   │   ├── 20260912000004_rpc_functions.sql
│   │   └── 20260912000005_storage_buckets.sql
│   └── functions/
│       ├── reverse-geocode/
│       │   └── index.ts
│       └── push-notifier/
│           └── index.ts
│
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css                          # Tailwind CSS custom themes & tokens
    │
    ├── app/
    │   ├── AppProviders.tsx               # QueryClient, Auth, Realtime providers
    │   └── router.tsx                     # React Router definition & role guards
    │
    ├── components/
    │   ├── ui/                            # shadcn/ui primitives
    │   │   ├── button.tsx
    │   │   ├── card.tsx
    │   │   ├── dialog.tsx
    │   │   ├── badge.tsx
    │   │   ├── select.tsx
    │   │   ├── input.tsx
    │   │   ├── tabs.tsx
    │   │   └── sonner.tsx
    │   ├── layout/
    │   │   ├── Header.tsx
    │   │   ├── Footer.tsx
    │   │   ├── CitizenLayout.tsx
    │   │   ├── WorkerLayout.tsx
    │   │   └── AdminLayout.tsx
    │   └── feedback/
    │       ├── LoadingScreen.tsx
    │       ├── ErrorFallback.tsx
    │       └── EmptyState.tsx
    │
    ├── features/
    │   ├── auth/
    │   │   ├── components/
    │   │   │   ├── LoginForm.tsx
    │   │   │   ├── RegisterForm.tsx
    │   │   │   └── RoleGuard.tsx
    │   │   ├── hooks/useAuth.ts
    │   │   └── types/auth.types.ts
    │   │
    │   ├── citizen/
    │   │   ├── components/
    │   │   │   ├── ReportGarbageForm.tsx
    │   │   │   ├── DuplicateWarningModal.tsx
    │   │   │   ├── MyReportsFeed.tsx
    │   │   │   └── ReportTimelineCard.tsx
    │   │   ├── hooks/useCitizenReports.ts
    │   │   └── services/citizenApi.ts
    │   │
    │   ├── worker/
    │   │   ├── components/
    │   │   │   ├── DutyToggle.tsx
    │   │   │   ├── AssignedTasksList.tsx
    │   │   │   ├── TaskActionCard.tsx
    │   │   │   └── ResolveTaskModal.tsx
    │   │   ├── hooks/useWorkerTasks.ts
    │   │   └── services/workerApi.ts
    │   │
    │   ├── admin/
    │   │   ├── components/
    │   │   │   ├── DispatchMap.tsx
    │   │   │   ├── WorkerManagementTable.tsx
    │   │   │   ├── CollectionScheduleModal.tsx
    │   │   │   └── OperationsMetrics.tsx
    │   │   ├── hooks/useAdminData.ts
    │   │   └── services/adminApi.ts
    │   │
    │   ├── map/
    │   │   ├── components/
    │   │   │   ├── MunicipalMap.tsx
    │   │   │   ├── ReportMarker.tsx
    │   │   │   ├── WorkerMarker.tsx
    │   │   │   └── LocationPickerMap.tsx
    │   │   └── hooks/useGeolocation.ts
    │   │
    │   └── notifications/
    │       ├── components/
    │       │   ├── NotificationCenter.tsx
    │       │   └── NotificationItem.tsx
    │       └── hooks/useNotifications.ts
    │
    ├── lib/
    │   ├── supabase.ts                    # Supabase typed client initialization
    │   ├── queryClient.ts                 # TanStack Query client & defaults
    │   └── utils.ts                       # Tailwind cn() merge & formatting helpers
    │
    └── types/
        ├── database.types.ts              # Auto-generated Supabase PostgreSQL types
        └── domain.types.ts                # Application domain entities
```

---

## 13. Development Phases (Chronological Order)

```
+------------------------------------------------------------------------------------+
| Phase 1: Foundation, Tooling & TypeScript Migration                                |
| - Migrate template to TypeScript (tsconfig, .tsx extension)                        |
| - Install dependencies: Tailwind CSS, shadcn/ui primitives, Lucide, React Router, |
|   TanStack Query, Supabase JS, Leaflet, Zod, React Hook Form                       |
| - Configure Supabase client and environment variable bindings                      |
+------------------------------------------------------------------------------------+
                                          |
                                          v
+------------------------------------------------------------------------------------+
| Phase 2: Database Migrations, PostGIS & Security Policies                          |
| - Write and apply migrations: Profiles, Reports, Timeline, Schedules, Alerts       |
| - Configure PostGIS indexes (GIST on locations)                                    |
| - Implement Row Level Security (RLS) policies for all three roles                  |
| - Create Storage Buckets (report-photos, resolution-photos) with RLS               |
+------------------------------------------------------------------------------------+
                                          |
                                          v
+------------------------------------------------------------------------------------+
| Phase 3: Spatial Engine & Server-Side RPC Functions                                |
| - Implement check_duplicate_report(30m) PostGIS stored procedure                   |
| - Implement find_optimal_worker_for_report() workload/distance scoring             |
| - Implement submit_garbage_report() atomic RPC                                     |
| - Implement transition_report_status() with SELECT FOR UPDATE row locking          |
| - Deploy reverse-geocode Edge Function for Nominatim proxy                         |
+------------------------------------------------------------------------------------+
                                          |
                                          v
+------------------------------------------------------------------------------------+
| Phase 4: Authentication, Layouts & Role Routing                                    |
| - Implement Auth UI (Login, Register, Role Selector)                              |
| - Setup AuthContext & RoleGuard wrappers                                           |
| - Build shared layouts: CitizenLayout, WorkerLayout, AdminLayout                   |
+------------------------------------------------------------------------------------+
                                          |
                                          v
+------------------------------------------------------------------------------------+
| Phase 5: Citizen Module Implementation                                             |
| - Implement browser GPS hook (navigator.geolocation) with map pin drag fallback   |
| - Build Report Form with photo downsampling (browser-image-compression)            |
| - Wire up 30-meter duplicate warning modal                                         |
| - Build Citizen "My Reports" feed and interactive status timeline                  |
+------------------------------------------------------------------------------------+
                                          |
                                          v
+------------------------------------------------------------------------------------+
| Phase 6: Worker Module Implementation                                              |
| - Build On-Duty / Off-Duty toggle with periodic GPS presence updates               |
| - Build Assigned Tasks Queue (filtering by distance and severity)                  |
| - Build Atomic Task Acceptance and Status Updater                                  |
| - Build Resolution Modal with required resolution photo upload                     |
+------------------------------------------------------------------------------------+
                                          |
                                          v
+------------------------------------------------------------------------------------+
| Phase 7: Admin Module & Collection Scheduling                                      |
| - Build Full-Screen Municipal Dispatch Map with clustered report pins              |
| - Build Field Worker Roster & Manual Reassignment modal                            |
| - Build Collection Schedule Manager (Calendar, route boundaries, crew assignment)  |
| - Build Municipal Analytics KPI Dashboard                                          |
+------------------------------------------------------------------------------------+
                                          |
                                          v
+------------------------------------------------------------------------------------+
| Phase 8: Realtime Notification Engine & Polish                                     |
| - Connect Supabase Realtime channels for instant notification toasts               |
| - Perform end-to-end race condition and stress tests                               |
| - Optimize bundle size, lazy-load map components, PWA manifest setup               |
+------------------------------------------------------------------------------------+
```

---

## 14. Git Commit Milestones

1. `feat(setup): migrate to typescript, configure tailwind css and project dependencies`
2. `feat(supabase): create postgis migrations, tables, enums, and rls policies`
3. `feat(supabase): implement spatial stored procedures, dedup check, and atomic rpc`
4. `feat(edge): add reverse-geocoding edge function with nominatim caching`
5. `feat(auth): build authentication flows, profile sync trigger, and role guards`
6. `feat(ui): implement base layouts, navigation, and theme system`
7. `feat(citizen): implement gps waste reporting with client photo compression`
8. `feat(citizen): implement 30m duplicate detection alert and tracking timeline`
9. `feat(worker): implement duty toggle, task queue, and atomic acceptance`
10. `feat(worker): implement resolution modal with required proof photo upload`
11. `feat(admin): build live dispatch map and worker management roster`
12. `feat(admin): implement routine collection scheduling and zone polygons`
13. `feat(realtime): wire supabase realtime notifications and task synchronization`
14. `test(e2e): verify concurrency locks, duplicate prevention, and spatial queries`
15. `polish: performance optimizations, mobile responsive audit, and documentation`

---

## 15. Potential Technical Risks & Mitigation Strategies

| Risk | Impact | Likelihood | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **OpenStreetMap Nominatim Rate Limiting (1 req/sec)** | High (Address lookup failure / IP ban) | High | **Mitigation**: Route all reverse geocoding through a Supabase Edge Function with spatial coordinate rounding (4 decimals ~11m) and in-memory caching. Add a 500ms client-side debounce when dragging the map pin. |
| **Race Conditions in Task Acceptance** | High (Two workers accept the same task) | Medium | **Mitigation**: Enforce status transitions exclusively through the PostgreSQL `transition_report_status()` RPC with `SELECT ... FOR UPDATE` row locks. Any subsequent attempt fails immediately with a descriptive error. |
| **High Latency / Bandwidth from Smartphone Photos** | Medium (Failed uploads, poor UX) | High | **Mitigation**: Use `browser-image-compression` on the client to downsample images to WebP (max 1280px, ~300KB) before transmitting to Supabase Storage. |
| **Mobile Browser GPS Inaccuracies or Denials** | Medium (Incorrect coordinates) | High | **Mitigation**: Request `enableHighAccuracy: true`. If accuracy radius > 50m or permission is denied, render an interactive Leaflet map with a draggable pin allowing the citizen to confirm the exact location manually. |
| **PostGIS Spatial Query Bottlenecks** | High (Slow query times as reports grow) | Low | **Mitigation**: Add GIST spatial indexes on `reports(location)` and `profiles(current_location)`. Partition older resolved reports if table exceeds millions of records. |
| **Stale Realtime Connection on Mobile Device Sleep** | Medium (Missed notifications) | Medium | **Mitigation**: Implement a visibility change listener (`document.addEventListener('visibilitychange')`) that checks connection health and triggers TanStack Query `invalidateQueries` whenever the user brings the app back to the foreground. |
| **Privilege Escalation via Direct API Calls** | Critical (Citizen elevates to Admin) | Low | **Mitigation**: Enforce RLS at the PostgreSQL level. Make `role` immutable via client `UPDATE` policies; only database triggers or service-role admins can alter user roles. |
