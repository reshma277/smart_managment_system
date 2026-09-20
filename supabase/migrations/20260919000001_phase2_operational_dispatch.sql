-- CleanAlert Migration 7: Phase 2 — Operational Dispatch Functions & Severity-Aware Routing
-- Filename: 20260919000001_phase2_operational_dispatch.sql

-- Drop obsolete function signatures to prevent default-argument ambiguity in PostgreSQL
DROP FUNCTION IF EXISTS public.find_optimal_worker_for_report(public.geography);
DROP FUNCTION IF EXISTS public.submit_garbage_report(text, text, public.garbage_type, public.severity_level, double precision, double precision, text, text);

-- 1. Upgraded Severity-Aware Worker Scoring Algorithm (INTERNAL ONLY)
-- Mathematically balanced formula:
-- CRITICAL: Immediate emergency response required; heavily penalizes busy workers (load_weight = 1.5, dist_weight = 0.4)
-- HIGH: Urgent response with strong availability weighting (load_weight = 0.6, dist_weight = 0.5)
-- MEDIUM: Standard balanced routing (load_weight = 0.3, dist_weight = 0.7)
-- LOW: Distance-centric routing (load_weight = 0.2, dist_weight = 0.8)
CREATE OR REPLACE FUNCTION public.find_optimal_worker_for_report(
    p_report_location public.geography,
    p_severity public.severity_level DEFAULT 'medium'::public.severity_level
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_selected_worker_id UUID;
    v_dist_weight DOUBLE PRECISION;
    v_load_weight DOUBLE PRECISION;
BEGIN
    IF p_severity = 'critical'::public.severity_level THEN
        v_dist_weight := 0.4;
        v_load_weight := 1.5;
    ELSIF p_severity = 'high'::public.severity_level THEN
        v_dist_weight := 0.5;
        v_load_weight := 0.6;
    ELSIF p_severity = 'low'::public.severity_level THEN
        v_dist_weight := 0.8;
        v_load_weight := 0.2;
    ELSE
        v_dist_weight := 0.7;
        v_load_weight := 0.3;
    END IF;

    -- Primary selection: on-duty active workers with recorded GPS coordinates
    SELECT w.id INTO v_selected_worker_id
    FROM public.profiles w
    LEFT JOIN (
        SELECT assigned_worker_id, COUNT(*) AS active_load
        FROM public.reports
        WHERE status IN ('Assigned'::public.report_status, 'Accepted'::public.report_status, 'In Progress'::public.report_status)
        GROUP BY assigned_worker_id
    ) load ON load.assigned_worker_id = w.id
    WHERE 
        w.role = 'worker'::public.user_role AND 
        w.is_active = true AND
        w.current_location IS NOT NULL
    ORDER BY (
        ((ST_Distance(w.current_location, p_report_location) / 1000.0) * v_dist_weight) + 
        (COALESCE(load.active_load, 0) * v_load_weight)
    ) ASC
    LIMIT 1;

    -- Fallback selection: if no worker has synced GPS yet, select the on-duty worker with the lowest workload
    IF v_selected_worker_id IS NULL THEN
        SELECT w.id INTO v_selected_worker_id
        FROM public.profiles w
        LEFT JOIN (
            SELECT assigned_worker_id, COUNT(*) AS active_load
            FROM public.reports
            WHERE status IN ('Assigned'::public.report_status, 'Accepted'::public.report_status, 'In Progress'::public.report_status)
            GROUP BY assigned_worker_id
        ) load ON load.assigned_worker_id = w.id
        WHERE 
            w.role = 'worker'::public.user_role AND 
            w.is_active = true
        ORDER BY COALESCE(load.active_load, 0) ASC
        LIMIT 1;
    END IF;

    RETURN v_selected_worker_id;
END;
$$;

-- 2. Admin On-Demand Auto-Assignment RPC
CREATE OR REPLACE FUNCTION public.auto_assign_report(
    p_report_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_report RECORD;
    v_worker RECORD;
    v_selected_worker_id UUID;
BEGIN
    -- 1. Verify caller is an authenticated administrator
    IF v_caller_id IS NULL OR NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Only administrators can trigger automated dispatch.'
        );
    END IF;

    -- 2. Lock the target report row
    SELECT * INTO v_report
    FROM public.reports
    WHERE id = p_report_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Report not found.');
    END IF;

    -- 3. Verify status eligibility: only unassigned Reported reports can be auto-assigned
    IF v_report.status != 'Reported'::public.report_status THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Only reports in Reported status are eligible for automated assignment. Current status: ' || v_report.status::text
        );
    END IF;

    -- 4. Find optimal on-duty worker using severity-weighted algorithm
    v_selected_worker_id := public.find_optimal_worker_for_report(v_report.location, v_report.severity);

    IF v_selected_worker_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'NO_AVAILABLE_WORKER',
            'message', 'No active, on-duty field workers are available for assignment at this time.'
        );
    END IF;

    -- 5. Retrieve worker profile details
    SELECT id, full_name, role, is_active INTO v_worker
    FROM public.profiles
    WHERE id = v_selected_worker_id;

    -- 6. Atomically update report
    UPDATE public.reports
    SET 
        status = 'Assigned'::public.report_status,
        assigned_worker_id = v_selected_worker_id,
        assigned_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_report_id;

    -- 7. Insert timeline audit record
    INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
    VALUES (
        p_report_id,
        v_caller_id,
        'Reported'::public.report_status,
        'Assigned'::public.report_status,
        'Auto-assigned by admin to on-duty worker ' || v_worker.full_name
    );

    -- 8. Emit notification for assigned worker
    INSERT INTO public.notifications (user_id, report_id, title, message, type)
    VALUES (
        v_selected_worker_id,
        p_report_id,
        'New Task Assigned',
        'A garbage report at ' || v_report.address || ' has been automatically dispatched to you.',
        'assignment'
    );

    RETURN jsonb_build_object(
        'success', true,
        'report_id', p_report_id,
        'assigned_worker_id', v_selected_worker_id,
        'worker_name', v_worker.full_name,
        'status', 'Assigned'
    );
END;
$$;

-- 3. Admin Worker Reassignment RPC
CREATE OR REPLACE FUNCTION public.reassign_report_to_worker(
    p_report_id UUID,
    p_new_worker_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_report RECORD;
    v_prev_worker RECORD;
    v_new_worker RECORD;
    v_prev_worker_id UUID;
    v_prev_status public.report_status;
BEGIN
    -- 1. Caller must be an authenticated administrator
    IF v_caller_id IS NULL OR NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Only administrators can reassign reports.'
        );
    END IF;

    -- 2. Lock report row
    SELECT * INTO v_report
    FROM public.reports
    WHERE id = p_report_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Report not found.');
    END IF;

    -- 3. Report must not be in a terminal lifecycle state
    IF v_report.status IN ('Resolved'::public.report_status, 'Cancelled'::public.report_status) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Cannot reassign a report that has already been ' || v_report.status::text || '.'
        );
    END IF;

    -- 4. Target worker cannot be the same worker currently assigned
    IF v_report.assigned_worker_id IS NOT NULL AND v_report.assigned_worker_id = p_new_worker_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Selected worker is already assigned to this report.'
        );
    END IF;

    -- 5. Validate new worker exists, has worker role, and is on-duty/active
    SELECT id, full_name, role, is_active INTO v_new_worker
    FROM public.profiles
    WHERE id = p_new_worker_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Target worker profile not found.');
    END IF;

    IF v_new_worker.role != 'worker'::public.user_role THEN
        RETURN jsonb_build_object('success', false, 'message', 'Target user does not have the field worker role.');
    END IF;

    IF NOT v_new_worker.is_active THEN
        RETURN jsonb_build_object('success', false, 'message', 'Target worker is currently off-duty or inactive.');
    END IF;

    -- 6. Retrieve previous worker profile if one was assigned
    v_prev_worker_id := v_report.assigned_worker_id;
    v_prev_status := v_report.status;

    IF v_prev_worker_id IS NOT NULL THEN
        SELECT id, full_name INTO v_prev_worker
        FROM public.profiles
        WHERE id = v_prev_worker_id;
    END IF;

    -- 7. Atomically update report: status resets to Assigned so new worker must review and accept
    UPDATE public.reports
    SET 
        status = 'Assigned'::public.report_status,
        assigned_worker_id = p_new_worker_id,
        assigned_at = timezone('utc'::text, now()),
        accepted_at = NULL,
        in_progress_at = NULL,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_report_id;

    -- 8. Insert timeline event
    INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
    VALUES (
        p_report_id,
        v_caller_id,
        v_prev_status,
        'Assigned'::public.report_status,
        CASE 
            WHEN v_prev_worker.full_name IS NOT NULL AND p_notes IS NOT NULL
            THEN 'Reassigned from ' || v_prev_worker.full_name || ' to ' || v_new_worker.full_name || ': ' || p_notes
            WHEN v_prev_worker.full_name IS NOT NULL
            THEN 'Reassigned from ' || v_prev_worker.full_name || ' to ' || v_new_worker.full_name
            WHEN p_notes IS NOT NULL
            THEN 'Assigned to ' || v_new_worker.full_name || ': ' || p_notes
            ELSE 'Assigned to ' || v_new_worker.full_name
        END
    );

    -- 9. Notification for newly assigned worker
    INSERT INTO public.notifications (user_id, report_id, title, message, type)
    VALUES (
        p_new_worker_id,
        p_report_id,
        'New Task Assigned',
        'A garbage report at ' || v_report.address || ' has been assigned to you by an administrator.',
        'assignment'
    );

    -- 10. Notification for previously assigned worker (if applicable)
    IF v_prev_worker_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, report_id, title, message, type)
        VALUES (
            v_prev_worker_id,
            p_report_id,
            'Task Reassigned',
            'A garbage report at ' || v_report.address || ' previously assigned to you has been reassigned to another field worker.',
            'task_reassigned'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'report_id', p_report_id,
        'previous_worker_id', v_prev_worker_id,
        'assigned_worker_id', p_new_worker_id,
        'status', 'Assigned'
    );
END;
$$;

-- 4. Worker Self-Duty Toggle RPC
CREATE OR REPLACE FUNCTION public.set_worker_duty_status(
    p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_role public.user_role;
BEGIN
    -- 1. Caller must be authenticated
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Caller not authenticated.'
        );
    END IF;

    -- 2. Verify caller has worker role
    SELECT role INTO v_role
    FROM public.profiles
    WHERE id = v_caller_id;

    IF NOT FOUND OR v_role != 'worker'::public.user_role THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Only registered field workers can toggle duty status.'
        );
    END IF;

    -- 3. Update only caller's own profile duty status
    UPDATE public.profiles
    SET 
        is_active = p_is_active,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_caller_id;

    RETURN jsonb_build_object(
        'success', true,
        'is_active', p_is_active
    );
END;
$$;

-- 5. Updated Atomic Garbage Report Submission with Explicit Duplicate Bypass Support
CREATE OR REPLACE FUNCTION public.submit_garbage_report(
    p_title TEXT,
    p_description TEXT,
    p_garbage_type public.garbage_type,
    p_severity public.severity_level,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_address TEXT,
    p_photo_url TEXT DEFAULT NULL,
    p_confirm_duplicate BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_citizen_id UUID := auth.uid();
    v_report_location public.geography;
    v_duplicate RECORD;
    v_assigned_worker_id UUID;
    v_initial_status public.report_status;
    v_report_id UUID;
BEGIN
    -- Authorization check: caller must be an authenticated citizen or admin
    IF v_citizen_id IS NULL OR NOT (public.is_citizen() OR public.is_admin()) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Only citizens and administrators can submit reports.'
        );
    END IF;

    -- Storage path validation
    IF p_photo_url IS NOT NULL AND length(trim(p_photo_url)) > 0 THEN
        IF NOT (p_photo_url LIKE (v_citizen_id::text || '/%')) OR p_photo_url LIKE '%..%' THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Invalid photo path: photo must belong to your authenticated user folder.'
            );
        END IF;
    END IF;

    v_report_location := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::public.geography;

    -- Proximity duplicate check within 30 meters
    SELECT * INTO v_duplicate 
    FROM public.check_duplicate_report(p_latitude, p_longitude);

    IF v_duplicate.is_duplicate AND NOT p_confirm_duplicate THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'DUPLICATE_REPORT',
            'message', 'An active report already exists within 30 meters of this location.',
            'existing_report_id', v_duplicate.existing_report_id,
            'existing_status', v_duplicate.existing_status,
            'distance_meters', ROUND(v_duplicate.distance_meters::numeric, 1),
            'supporters_count', v_duplicate.supporters_count
        );
    END IF;

    -- Severity-aware auto-assignment
    v_assigned_worker_id := public.find_optimal_worker_for_report(v_report_location, p_severity);

    IF v_assigned_worker_id IS NOT NULL THEN
        v_initial_status := 'Assigned'::public.report_status;
    ELSE
        v_initial_status := 'Reported'::public.report_status;
    END IF;

    -- Insert new municipal report
    INSERT INTO public.reports (
        citizen_id, title, description, garbage_type, severity, status,
        location, latitude, longitude, address, photo_url,
        assigned_worker_id, assigned_at
    ) VALUES (
        v_citizen_id, p_title, p_description, p_garbage_type, p_severity, v_initial_status,
        v_report_location, p_latitude, p_longitude, p_address, p_photo_url,
        v_assigned_worker_id, CASE WHEN v_assigned_worker_id IS NOT NULL THEN timezone('utc'::text, now()) ELSE NULL END
    ) RETURNING id INTO v_report_id;

    -- Record creation milestone in timeline
    INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
    VALUES (
        v_report_id,
        v_citizen_id,
        NULL,
        'Reported'::public.report_status,
        CASE 
            WHEN p_confirm_duplicate THEN 'Report submitted by citizen (confirmed distinct from nearby report)'
            ELSE 'Report submitted by citizen'
        END
    );

    -- If auto-assigned, record assignment milestone and notify worker
    IF v_assigned_worker_id IS NOT NULL THEN
        INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
        VALUES (v_report_id, NULL, 'Reported'::public.report_status, 'Assigned'::public.report_status, 'Auto-assigned to nearest field worker');

        INSERT INTO public.notifications (user_id, report_id, title, message, type)
        VALUES (
            v_assigned_worker_id,
            v_report_id,
            'New Task Assigned',
            'A garbage report at ' || p_address || ' has been assigned to you.',
            'assignment'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'is_duplicate', false,
        'report_id', v_report_id,
        'status', v_initial_status,
        'assigned_worker_id', v_assigned_worker_id
    );
END;
$$;

-- 6. Function-Level Privileges
REVOKE ALL ON FUNCTION public.find_optimal_worker_for_report(public.geography, public.severity_level) FROM PUBLIC, authenticated;

REVOKE ALL ON FUNCTION public.auto_assign_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_assign_report(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.reassign_report_to_worker(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_report_to_worker(UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.set_worker_duty_status(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_worker_duty_status(BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_garbage_report(TEXT, TEXT, public.garbage_type, public.severity_level, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_garbage_report(TEXT, TEXT, public.garbage_type, public.severity_level, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, BOOLEAN) TO authenticated;
