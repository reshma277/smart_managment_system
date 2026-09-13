-- CleanAlert Migration 5: Hardened Stored Procedures & Atomic RPCs
-- Filename: 20260913000005_rpc_functions.sql

-- 1. Fixed 30-Meter Proximity Duplicate Detection
CREATE OR REPLACE FUNCTION public.check_duplicate_report(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION
)
RETURNS TABLE (
    is_duplicate BOOLEAN,
    existing_report_id UUID,
    existing_status public.report_status,
    distance_meters DOUBLE PRECISION,
    supporters_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_point public.geography;
BEGIN
    v_point := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::public.geography;

    RETURN QUERY
    SELECT 
        true AS is_duplicate,
        r.id AS existing_report_id,
        r.status AS existing_status,
        ST_Distance(r.location, v_point) AS distance_meters,
        COALESCE(s.supporter_count, 0::bigint) AS supporters_count
    FROM public.reports r
    LEFT JOIN (
        SELECT report_id, COUNT(*) AS supporter_count
        FROM public.report_supporters
        GROUP BY report_id
    ) s ON s.report_id = r.id
    WHERE 
        r.status NOT IN ('Resolved'::public.report_status, 'Cancelled'::public.report_status) AND
        ST_DWithin(r.location, v_point, 30.0) -- Fixed production business rule: exactly 30 meters
    ORDER BY distance_meters ASC
    LIMIT 1;

    IF NOT FOUND THEN
        is_duplicate := false;
        existing_report_id := NULL;
        existing_status := NULL;
        distance_meters := NULL;
        supporters_count := 0;
        RETURN NEXT;
    END IF;
END;
$$;

-- 2. Explicit Citizen Support for Existing Reports
CREATE OR REPLACE FUNCTION public.support_existing_report(
    p_report_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_citizen_id UUID := auth.uid();
    v_report RECORD;
    v_total_supporters BIGINT;
BEGIN
    -- Authorization check: caller must be an authenticated citizen
    IF v_citizen_id IS NULL OR NOT public.is_citizen() THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Only authenticated citizens can support reports.'
        );
    END IF;

    -- Validate target report existence and active status
    SELECT id, title, status INTO v_report
    FROM public.reports
    WHERE id = p_report_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Target report does not exist.'
        );
    END IF;

    IF v_report.status IN ('Resolved'::public.report_status, 'Cancelled'::public.report_status) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Cannot support an inactive or resolved report.'
        );
    END IF;

    -- Idempotent insert into report_supporters
    INSERT INTO public.report_supporters (report_id, citizen_id)
    VALUES (p_report_id, v_citizen_id)
    ON CONFLICT (report_id, citizen_id) DO NOTHING;

    -- Retrieve updated supporter count
    SELECT COUNT(*) INTO v_total_supporters
    FROM public.report_supporters
    WHERE report_id = p_report_id;

    -- Generate in-app confirmation notification for citizen
    INSERT INTO public.notifications (user_id, report_id, title, message, type)
    VALUES (
        v_citizen_id,
        p_report_id,
        'Following Report Updates',
        'You are now following updates for the report at this location.',
        'support_confirmation'
    );

    RETURN jsonb_build_object(
        'success', true,
        'report_id', p_report_id,
        'supporters_count', v_total_supporters
    );
END;
$$;

-- 3. Optimal Worker Dispatch Scoring Algorithm (INTERNAL ONLY)
CREATE OR REPLACE FUNCTION public.find_optimal_worker_for_report(
    p_report_location public.geography
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_selected_worker_id UUID;
BEGIN
    SELECT w.id INTO v_selected_worker_id
    FROM public.profiles w
    LEFT JOIN (
        SELECT assigned_worker_id, COUNT(*) AS active_load
        FROM public.reports
        WHERE status IN ('Accepted'::public.report_status, 'In Progress'::public.report_status)
        GROUP BY assigned_worker_id
    ) load ON load.assigned_worker_id = w.id
    WHERE 
        w.role = 'worker'::public.user_role AND 
        w.is_active = true AND
        w.current_location IS NOT NULL
    ORDER BY (
        (ST_Distance(w.current_location, p_report_location) / 1000.0 * 0.7) + 
        (COALESCE(load.active_load, 0) * 0.3)
    ) ASC
    LIMIT 1;

    RETURN v_selected_worker_id;
END;
$$;

-- 4. Atomic Garbage Report Submission
CREATE OR REPLACE FUNCTION public.submit_garbage_report(
    p_title TEXT,
    p_description TEXT,
    p_garbage_type public.garbage_type,
    p_severity public.severity_level,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_address TEXT,
    p_photo_url TEXT DEFAULT NULL
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

    -- Storage path validation: photo must reside in caller's own auth directory
    IF p_photo_url IS NOT NULL AND length(trim(p_photo_url)) > 0 THEN
        IF NOT (p_photo_url LIKE (v_citizen_id::text || '/%')) OR p_photo_url LIKE '%..%' THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Invalid photo path: photo must belong to your authenticated user folder.'
            );
        END IF;
    END IF;

    v_report_location := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::public.geography;

    -- Check for duplicate within fixed 30.0 meters
    SELECT * INTO v_duplicate 
    FROM public.check_duplicate_report(p_latitude, p_longitude);

    IF v_duplicate.is_duplicate THEN
        -- Return duplicate info to frontend WITHOUT auto-subscribing the citizen
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

    -- Determine optimal worker assignment
    v_assigned_worker_id := public.find_optimal_worker_for_report(v_report_location);

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
    VALUES (v_report_id, v_citizen_id, NULL, 'Reported'::public.report_status, 'Report submitted by citizen');

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

-- 5. Dedicated Atomic Admin Assignment: Reported -> Assigned
CREATE OR REPLACE FUNCTION public.assign_report_to_worker(
    p_report_id UUID,
    p_worker_id UUID,
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
    v_worker RECORD;
BEGIN
    -- 1. Caller must be an authenticated administrator
    IF v_caller_id IS NULL OR NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Only administrators can assign reports to workers.'
        );
    END IF;

    -- 2. Lock the report row with FOR UPDATE
    SELECT * INTO v_report
    FROM public.reports
    WHERE id = p_report_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Report not found.');
    END IF;

    -- 3. Current status must be exactly 'Reported'
    IF v_report.status != 'Reported'::public.report_status THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Only reports in Reported status can be assigned. Current status: ' || v_report.status::text
        );
    END IF;

    -- 4. Verify worker exists, has role 'worker', and is active
    SELECT id, full_name, role, is_active INTO v_worker
    FROM public.profiles
    WHERE id = p_worker_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Selected worker profile not found.');
    END IF;

    IF v_worker.role != 'worker'::public.user_role THEN
        RETURN jsonb_build_object('success', false, 'message', 'Target user does not have the worker role.');
    END IF;

    IF NOT v_worker.is_active THEN
        RETURN jsonb_build_object('success', false, 'message', 'Selected worker is currently off-duty/inactive.');
    END IF;

    -- 5. Atomically update report: status, assigned_worker_id, assigned_at, updated_at
    UPDATE public.reports
    SET 
        status = 'Assigned'::public.report_status,
        assigned_worker_id = p_worker_id,
        assigned_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_report_id;

    -- 6. Insert timeline event
    INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
    VALUES (
        p_report_id,
        v_caller_id,
        'Reported'::public.report_status,
        'Assigned'::public.report_status,
        COALESCE(p_notes, 'Assigned to field worker ' || v_worker.full_name)
    );

    -- 7. Create assignment notification for the selected worker
    INSERT INTO public.notifications (user_id, report_id, title, message, type)
    VALUES (
        p_worker_id,
        p_report_id,
        'New Task Assigned',
        'A garbage report at ' || v_report.address || ' has been assigned to you by an administrator.',
        'assignment'
    );

    RETURN jsonb_build_object(
        'success', true,
        'report_id', p_report_id,
        'assigned_worker_id', p_worker_id,
        'status', 'Assigned'
    );
END;
$$;

-- 6. Atomic Report Status Transition: Assigned -> Accepted -> In Progress -> Resolved
CREATE OR REPLACE FUNCTION public.transition_report_status(
    p_report_id UUID,
    p_target_status public.report_status,
    p_notes TEXT DEFAULT NULL,
    p_resolution_photo_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_report RECORD;
    v_supporter RECORD;
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized: Caller not authenticated.');
    END IF;

    -- Concurrency Protection: Lock the row exclusively
    SELECT * INTO v_report
    FROM public.reports
    WHERE id = p_report_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Report not found.');
    END IF;

    -- Strict State Machine & Authorization Verification
    IF v_report.status = 'Assigned' AND p_target_status = 'Accepted' THEN
        -- Assigned worker or Admin
        IF v_report.assigned_worker_id != v_caller_id AND NOT public.is_admin() THEN
            RETURN jsonb_build_object('success', false, 'message', 'You are not assigned to this report.');
        END IF;

    ELSIF v_report.status = 'Accepted' AND p_target_status = 'In Progress' THEN
        -- Assigned worker or Admin
        IF v_report.assigned_worker_id != v_caller_id AND NOT public.is_admin() THEN
            RETURN jsonb_build_object('success', false, 'message', 'You are not assigned to this report.');
        END IF;

    ELSIF v_report.status = 'In Progress' AND p_target_status = 'Resolved' THEN
        -- Assigned worker or Admin
        IF v_report.assigned_worker_id != v_caller_id AND NOT public.is_admin() THEN
            RETURN jsonb_build_object('success', false, 'message', 'You are not assigned to this report.');
        END IF;

        -- Mandatory resolution photo validation
        IF p_resolution_photo_url IS NULL OR length(trim(p_resolution_photo_url)) = 0 THEN
            RETURN jsonb_build_object('success', false, 'message', 'A completion photo is required to resolve a report.');
        END IF;

        -- Validate photo path ownership (must match caller folder prefix)
        IF NOT (p_resolution_photo_url LIKE (v_caller_id::text || '/%')) OR p_resolution_photo_url LIKE '%..%' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Invalid resolution photo path: must belong to your authenticated user folder.');
        END IF;

    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Invalid state transition from ' || v_report.status::text || ' to ' || p_target_status::text || '. Note: To assign a reported task, use assign_report_to_worker.'
        );
    END IF;

    -- Execute status and milestone timestamp updates
    UPDATE public.reports
    SET 
        status = p_target_status,
        accepted_at = CASE WHEN p_target_status = 'Accepted' THEN timezone('utc'::text, now()) ELSE accepted_at END,
        in_progress_at = CASE WHEN p_target_status = 'In Progress' THEN timezone('utc'::text, now()) ELSE in_progress_at END,
        resolved_at = CASE WHEN p_target_status = 'Resolved' THEN timezone('utc'::text, now()) ELSE resolved_at END,
        resolution_notes = COALESCE(p_notes, resolution_notes),
        resolution_photo_url = COALESCE(p_resolution_photo_url, resolution_photo_url),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_report_id;

    -- Record transition milestone in timeline
    INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
    VALUES (p_report_id, v_caller_id, v_report.status, p_target_status, p_notes);

    -- Notify original report submitter
    IF v_report.citizen_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, report_id, title, message, type)
        VALUES (
            v_report.citizen_id,
            p_report_id,
            'Report Update: ' || p_target_status::text,
            'Your garbage report at ' || v_report.address || ' is now ' || p_target_status::text || '.',
            'status_update'
        );
    END IF;

    -- Notify all report supporters
    FOR v_supporter IN 
        SELECT citizen_id FROM public.report_supporters WHERE report_id = p_report_id
    LOOP
        IF v_supporter.citizen_id != v_report.citizen_id THEN
            INSERT INTO public.notifications (user_id, report_id, title, message, type)
            VALUES (
                v_supporter.citizen_id,
                p_report_id,
                'Followed Report Update: ' || p_target_status::text,
                'A report you are following at ' || v_report.address || ' is now ' || p_target_status::text || '.',
                'status_update'
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'report_id', p_report_id,
        'status', p_target_status
    );
END;
$$;

-- 7. Controlled Citizen Report Cancellation
CREATE OR REPLACE FUNCTION public.cancel_garbage_report(
    p_report_id UUID,
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
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized: Caller not authenticated.');
    END IF;

    -- Concurrency Protection: Lock row exclusively
    SELECT * INTO v_report
    FROM public.reports
    WHERE id = p_report_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Report not found.');
    END IF;

    -- Verify ownership (submitter or Admin)
    IF v_report.citizen_id != v_caller_id AND NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', 'You can only cancel your own reports.');
    END IF;

    -- Verify status is strictly 'Reported' (cannot cancel once dispatched/accepted)
    IF v_report.status != 'Reported'::public.report_status THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Reports can only be cancelled while in Reported status. Current status: ' || v_report.status::text
        );
    END IF;

    -- Update ONLY status to Cancelled
    UPDATE public.reports
    SET 
        status = 'Cancelled'::public.report_status,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_report_id;

    -- Record timeline event
    INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
    VALUES (
        p_report_id,
        v_caller_id,
        'Reported'::public.report_status,
        'Cancelled'::public.report_status,
        COALESCE(p_notes, 'Report cancelled by citizen')
    );

    -- Insert confirmation notification
    INSERT INTO public.notifications (user_id, report_id, title, message, type)
    VALUES (
        v_caller_id,
        p_report_id,
        'Report Cancelled',
        'Your report at ' || v_report.address || ' has been successfully cancelled.',
        'cancellation_confirmation'
    );

    RETURN jsonb_build_object(
        'success', true,
        'report_id', p_report_id,
        'status', 'Cancelled'
    );
END;
$$;

-- 8. Controlled Notification Management: Mark Single Read
CREATE OR REPLACE FUNCTION public.mark_notification_read(
    p_notification_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized.');
    END IF;

    -- Only updates is_read to true; prevents modifying any other notification fields
    UPDATE public.notifications
    SET is_read = true
    WHERE id = p_notification_id AND user_id = v_caller_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Notification not found or access denied.');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- 9. Controlled Notification Management: Mark All Read
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_updated_count INT;
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized.');
    END IF;

    UPDATE public.notifications
    SET is_read = true
    WHERE user_id = v_caller_id AND is_read = false;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RETURN jsonb_build_object('success', true, 'updated_count', v_updated_count);
END;
$$;

-- 10. Explicit Function-Level Privilege Management
REVOKE ALL ON FUNCTION public.check_duplicate_report(DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_duplicate_report(DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

REVOKE ALL ON FUNCTION public.support_existing_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_existing_report(UUID) TO authenticated;

-- Internal dispatch scoring: revoked from all public/client roles
REVOKE ALL ON FUNCTION public.find_optimal_worker_for_report(public.geography) FROM PUBLIC, authenticated;

REVOKE ALL ON FUNCTION public.submit_garbage_report(TEXT, TEXT, public.garbage_type, public.severity_level, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_garbage_report(TEXT, TEXT, public.garbage_type, public.severity_level, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_report_to_worker(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_report_to_worker(UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.transition_report_status(UUID, public.report_status, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_report_status(UUID, public.report_status, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_garbage_report(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_garbage_report(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_notification_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
