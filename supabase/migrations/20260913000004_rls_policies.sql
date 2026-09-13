-- CleanAlert Migration 4: Non-Recursive Row Level Security (RLS) Policies
-- Filename: 20260913000004_rls_policies.sql

-- 1. Enable RLS on all application tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_supporters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 2. Policies for public.profiles
-- PII Protection: Users read only their own full profile; Admins read all.
DROP POLICY IF EXISTS "profiles_select_owner_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_owner_or_admin"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id OR public.is_admin());

-- Users can update their own personal info, but CANNOT alter their role.
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id AND 
        role = public.get_current_role()
    );

-- Admins can update any profile or role.
DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;
CREATE POLICY "profiles_admin_update"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (public.is_admin());

-- 3. Policies for public.reports
-- Anonymous access is completely denied.
-- Authenticated users see: own reports, assigned reports, supported reports, active public pins, or all (if admin).
DROP POLICY IF EXISTS "reports_select_policy" ON public.reports;
CREATE POLICY "reports_select_policy"
    ON public.reports FOR SELECT
    TO authenticated
    USING (
        auth.role() = 'authenticated' AND (
            public.is_admin() OR
            auth.uid() = citizen_id OR
            auth.uid() = assigned_worker_id OR
            public.is_report_supporter(id, auth.uid()) OR
            status IN ('Reported', 'Assigned', 'Accepted', 'In Progress')
        )
    );

-- Only citizens and admins can insert new reports.
DROP POLICY IF EXISTS "reports_insert_policy" ON public.reports;
CREATE POLICY "reports_insert_policy"
    ON public.reports FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.role() = 'authenticated' AND (
            (auth.uid() = citizen_id AND public.is_citizen()) OR
            public.is_admin()
        )
    );

-- Direct client updates are reserved for Admins only.
-- Citizens cancel via cancel_garbage_report() RPC. Workers transition status via transition_report_status() RPC.
DROP POLICY IF EXISTS "reports_admin_update_policy" ON public.reports;
CREATE POLICY "reports_admin_update_policy"
    ON public.reports FOR UPDATE
    TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "reports_admin_delete_policy" ON public.reports;
CREATE POLICY "reports_admin_delete_policy"
    ON public.reports FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- 4. Policies for public.report_supporters
-- Citizens view their own support; workers view assigned report supporters; admins view all.
DROP POLICY IF EXISTS "supporters_select_policy" ON public.report_supporters;
CREATE POLICY "supporters_select_policy"
    ON public.report_supporters FOR SELECT
    TO authenticated
    USING (
        auth.role() = 'authenticated' AND (
            auth.uid() = citizen_id OR
            public.is_admin() OR
            public.is_assigned_worker(report_id, auth.uid())
        )
    );

-- Citizens can insert their own support record.
DROP POLICY IF EXISTS "supporters_insert_policy" ON public.report_supporters;
CREATE POLICY "supporters_insert_policy"
    ON public.report_supporters FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.role() = 'authenticated' AND
        auth.uid() = citizen_id AND
        public.is_citizen()
    );

-- Citizens can remove their own support.
DROP POLICY IF EXISTS "supporters_delete_policy" ON public.report_supporters;
CREATE POLICY "supporters_delete_policy"
    ON public.report_supporters FOR DELETE
    TO authenticated
    USING (
        auth.role() = 'authenticated' AND
        auth.uid() = citizen_id
    );

-- 5. Policies for public.report_timeline
-- Visible to users who have permission to view the report.
DROP POLICY IF EXISTS "timeline_select_policy" ON public.report_timeline;
CREATE POLICY "timeline_select_policy"
    ON public.report_timeline FOR SELECT
    TO authenticated
    USING (
        auth.role() = 'authenticated' AND
        public.can_view_report(report_id, auth.uid())
    );

-- Timeline is strictly immutable to direct client INSERT/UPDATE/DELETE.
-- Only controlled database functions write to public.report_timeline.

-- 6. Policies for public.collection_schedules
DROP POLICY IF EXISTS "schedules_select_policy" ON public.collection_schedules;
CREATE POLICY "schedules_select_policy"
    ON public.collection_schedules FOR SELECT
    TO authenticated
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "schedules_admin_all_policy" ON public.collection_schedules;
CREATE POLICY "schedules_admin_all_policy"
    ON public.collection_schedules FOR ALL
    TO authenticated
    USING (public.is_admin());

-- 7. Policies for public.notifications
-- Notifications are private to the recipient user.
DROP POLICY IF EXISTS "notifications_select_policy" ON public.notifications;
CREATE POLICY "notifications_select_policy"
    ON public.notifications FOR SELECT
    TO authenticated
    USING (
        auth.role() = 'authenticated' AND
        auth.uid() = user_id
    );

-- Normal clients CANNOT modify notification fields directly.
-- Read state is updated strictly through mark_notification_read() RPC.
DROP POLICY IF EXISTS "notifications_delete_policy" ON public.notifications;
CREATE POLICY "notifications_delete_policy"
    ON public.notifications FOR DELETE
    TO authenticated
    USING (
        auth.role() = 'authenticated' AND
        auth.uid() = user_id
    );
