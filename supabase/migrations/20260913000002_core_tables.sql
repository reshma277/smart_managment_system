-- CleanAlert Migration 2: Core Tables, Constraints, Indexes & Triggers
-- Filename: 20260913000002_core_tables.sql

-- 1. Helper function for automated updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

-- 2. Table: public.profiles
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL DEFAULT 'Citizen User',
    phone_number TEXT,
    role public.user_role NOT NULL DEFAULT 'citizen'::public.user_role,
    avatar_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    current_location public.geography(Point, 4326),
    last_location_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Table: public.reports
CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    citizen_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    garbage_type public.garbage_type NOT NULL DEFAULT 'general'::public.garbage_type,
    severity public.severity_level NOT NULL DEFAULT 'medium'::public.severity_level,
    status public.report_status NOT NULL DEFAULT 'Reported'::public.report_status,
    location public.geography(Point, 4326) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    address TEXT NOT NULL,
    photo_url TEXT,
    assigned_worker_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    in_progress_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    resolution_photo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Table: public.report_supporters
CREATE TABLE IF NOT EXISTS public.report_supporters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
    citizen_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_report_supporter UNIQUE (report_id, citizen_id)
);

-- 5. Table: public.report_timeline
CREATE TABLE IF NOT EXISTS public.report_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    previous_status public.report_status,
    new_status public.report_status NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 6. Table: public.collection_schedules
CREATE TABLE IF NOT EXISTS public.collection_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    zone_name TEXT NOT NULL,
    zone_polygon public.geography(Polygon, 4326),
    frequency public.schedule_frequency NOT NULL DEFAULT 'weekly'::public.schedule_frequency,
    scheduled_date DATE NOT NULL,
    scheduled_start_time TIME NOT NULL,
    scheduled_end_time TIME NOT NULL,
    assigned_worker_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status public.schedule_status NOT NULL DEFAULT 'scheduled'::public.schedule_status,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 7. Table: public.notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for performance and spatial calculations
CREATE INDEX IF NOT EXISTS idx_reports_location_gist ON public.reports USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_assigned_worker ON public.reports(assigned_worker_id);
CREATE INDEX IF NOT EXISTS idx_reports_citizen ON public.reports(citizen_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON public.reports(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supporters_report_id ON public.report_supporters(report_id);
CREATE INDEX IF NOT EXISTS idx_supporters_citizen_id ON public.report_supporters(citizen_id);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_worker_location_gist ON public.profiles USING GIST(current_location) WHERE role = 'worker';

CREATE INDEX IF NOT EXISTS idx_timeline_report_id ON public.report_timeline(report_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_schedules_date ON public.collection_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_schedules_polygon_gist ON public.collection_schedules USING GIST(zone_polygon);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, is_read);

-- Triggers for updated_at
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_reports_updated_at ON public.reports;
CREATE TRIGGER trg_reports_updated_at
    BEFORE UPDATE ON public.reports
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_collection_schedules_updated_at ON public.collection_schedules;
CREATE TRIGGER trg_collection_schedules_updated_at
    BEFORE UPDATE ON public.collection_schedules
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auth user synchronization trigger (strictly defaults to citizen role)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Citizen User'),
        'citizen'::public.user_role
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
