-- CleanAlert Migration 3: Public Views & Non-Recursive Security Helpers
-- Filename: 20260913000003_public_views_and_security_helpers.sql

-- 1. Secure Public View for non-sensitive profile information (masks email and phone_number)
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT 
    id,
    full_name,
    avatar_url,
    role,
    is_active
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated;

-- 2. Hardened Security Definer Helper: Retrieve current user role
CREATE OR REPLACE FUNCTION public.get_current_role()
RETURNS public.user_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role public.user_role;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT role INTO v_role
    FROM public.profiles
    WHERE id = auth.uid();

    RETURN v_role;
END;
$$;

-- 3. Hardened Security Definer Helper: Check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'admin'::public.user_role
    );
END;
$$;

-- 4. Hardened Security Definer Helper: Check if current user is worker
CREATE OR REPLACE FUNCTION public.is_worker()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'worker'::public.user_role
    );
END;
$$;

-- 5. Hardened Security Definer Helper: Check if current user is citizen
CREATE OR REPLACE FUNCTION public.is_citizen()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'citizen'::public.user_role
    );
END;
$$;

-- 6. Hardened Security Definer Helper: Check if a user supports a report (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_report_supporter(p_report_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_user_id IS NULL OR p_report_id IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.report_supporters
        WHERE report_id = p_report_id AND citizen_id = p_user_id
    );
END;
$$;

-- 7. Hardened Security Definer Helper: Check if a user is the assigned worker for a report (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_assigned_worker(p_report_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_user_id IS NULL OR p_report_id IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.reports
        WHERE id = p_report_id AND assigned_worker_id = p_user_id
    );
END;
$$;

-- 8. Hardened Security Definer Helper: Unified report viewing authorization (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.can_view_report(p_report_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_report RECORD;
BEGIN
    IF p_user_id IS NULL OR p_report_id IS NULL THEN
        RETURN false;
    END IF;

    -- Admins have global view access
    IF public.is_admin() THEN
        RETURN true;
    END IF;

    SELECT citizen_id, assigned_worker_id, status INTO v_report
    FROM public.reports
    WHERE id = p_report_id;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Submitter, assigned worker, supporter, or active public pin
    IF v_report.citizen_id = p_user_id THEN
        RETURN true;
    ELSIF v_report.assigned_worker_id = p_user_id THEN
        RETURN true;
    ELSIF public.is_report_supporter(p_report_id, p_user_id) THEN
        RETURN true;
    ELSIF v_report.status IN ('Reported', 'Assigned', 'Accepted', 'In Progress') THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

-- 9. Hardened Security Definer Helper: Storage photo read authorization (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.can_access_storage_photo(
    p_bucket_id TEXT,
    p_object_name TEXT,
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_report RECORD;
BEGIN
    IF p_user_id IS NULL OR p_object_name IS NULL OR p_bucket_id IS NULL THEN
        RETURN false;
    END IF;

    -- 1. Admins have global read access across both municipal buckets
    IF public.is_admin() THEN
        RETURN true;
    END IF;

    -- 2. Users can read any photo in their own directory prefix ({user_id}/*)
    IF p_object_name LIKE (p_user_id::text || '/%') THEN
        RETURN true;
    END IF;

    -- 3. Lookup report referencing this storage object
    SELECT id, citizen_id, assigned_worker_id, status INTO v_report
    FROM public.reports
    WHERE (photo_url = p_object_name AND p_bucket_id = 'report-photos')
       OR (resolution_photo_url = p_object_name AND p_bucket_id = 'resolution-photos')
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- 4. Check authorized roles for this report using security helpers
    -- Submitting citizen
    IF v_report.citizen_id = p_user_id THEN
        RETURN true;
    END IF;

    -- Assigned worker
    IF public.is_assigned_worker(v_report.id, p_user_id) THEN
        RETURN true;
    END IF;

    -- Supporter following this incident
    IF public.is_report_supporter(v_report.id, p_user_id) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

-- 10. Explicit Function-Level Privilege Management
REVOKE ALL ON FUNCTION public.get_current_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_role() TO authenticated;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.is_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_worker() TO authenticated;

REVOKE ALL ON FUNCTION public.is_citizen() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_citizen() TO authenticated;

REVOKE ALL ON FUNCTION public.is_report_supporter(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_report_supporter(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.is_assigned_worker(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_assigned_worker(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_view_report(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_report(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_access_storage_photo(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_storage_photo(TEXT, TEXT, UUID) TO authenticated;
