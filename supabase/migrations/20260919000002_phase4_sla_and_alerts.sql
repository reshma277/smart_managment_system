-- CleanAlert Migration 8: Phase 4 — SLA Tracking, Operational Alerts & Deduplication
-- Filename: 20260919000002_phase4_sla_and_alerts.sql

-- 1. Database-Level Deduplication for Operational Alerts
-- Prevents duplicate notifications for the same report and operational event type
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_sla_alerts
ON public.notifications (user_id, report_id, type)
WHERE type IN (
    'sla_assignment_breached',
    'sla_resolution_breached',
    'dispatch_failed',
    'unassigned_with_workers_available'
);

-- 2. Database Function: Evaluate SLA Breaches & Emit Deduplicated Operational Alerts
CREATE OR REPLACE FUNCTION public.evaluate_sla_alerts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_admin_ids UUID[];
    v_admin_id UUID;
    v_report RECORD;
    v_elapsed_mins DOUBLE PRECISION;
    v_target_assign_mins INT;
    v_target_resolve_mins INT;
    v_active_workers_exist BOOLEAN;
    v_alerts_created INT := 0;
BEGIN
    -- Authorization: must be authenticated admin or system/internal call
    IF v_caller_id IS NOT NULL AND NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Only administrators can trigger SLA alert evaluation.'
        );
    END IF;

    -- Retrieve all administrator user IDs
    SELECT array_agg(id) INTO v_admin_ids
    FROM public.profiles
    WHERE role = 'admin'::public.user_role;

    IF v_admin_ids IS NULL OR array_length(v_admin_ids, 1) = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'alerts_created', 0,
            'message', 'No administrator profiles found to notify.'
        );
    END IF;

    -- Check if eligible on-duty field workers currently exist
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE role = 'worker'::public.user_role AND is_active = true
    ) INTO v_active_workers_exist;

    -- Iterate across active municipal reports
    FOR v_report IN 
        SELECT id, title, severity, status, address, assigned_worker_id, created_at, assigned_at
        FROM public.reports
        WHERE status NOT IN ('Resolved'::public.report_status, 'Cancelled'::public.report_status)
    LOOP
        -- Centralized municipal SLA targets based on severity
        -- Critical: 15m assignment, 2h (120m) resolution
        -- High: 30m assignment, 4h (240m) resolution
        -- Medium: 2h (120m) assignment, 8h (480m) resolution
        -- Low: 4h (240m) assignment, 24h (1440m) resolution
        IF v_report.severity = 'critical'::public.severity_level THEN
            v_target_assign_mins := 15;
            v_target_resolve_mins := 120;
        ELSIF v_report.severity = 'high'::public.severity_level THEN
            v_target_assign_mins := 30;
            v_target_resolve_mins := 240;
        ELSIF v_report.severity = 'medium'::public.severity_level THEN
            v_target_assign_mins := 120;
            v_target_resolve_mins := 480;
        ELSE
            v_target_assign_mins := 240;
            v_target_resolve_mins := 1440;
        END IF;

        -- 1. Check Unassigned SLA Breach
        IF v_report.status = 'Reported'::public.report_status AND v_report.assigned_worker_id IS NULL THEN
            v_elapsed_mins := EXTRACT(EPOCH FROM (now() - v_report.created_at)) / 60.0;

            IF v_elapsed_mins >= v_target_assign_mins THEN
                FOREACH v_admin_id IN ARRAY v_admin_ids LOOP
                    INSERT INTO public.notifications (
                        user_id,
                        report_id,
                        title,
                        message,
                        type
                    ) VALUES (
                        v_admin_id,
                        v_report.id,
                        '⚠️ Assignment SLA Breached: ' || upper(v_report.severity::text) || ' Incident',
                        CASE 
                            WHEN v_active_workers_exist THEN 
                                'Report #' || substring(v_report.id::text, 1, 8) || ' (' || v_report.title || ') has been unassigned for ' || round(v_elapsed_mins::numeric) || ' mins (target: ' || v_target_assign_mins || 'm) despite active staff on-duty.'
                            ELSE 
                                'Report #' || substring(v_report.id::text, 1, 8) || ' (' || v_report.title || ') has breached assignment SLA (' || round(v_elapsed_mins::numeric) || 'm elapsed, target: ' || v_target_assign_mins || 'm).'
                        END,
                        'sla_assignment_breached'
                    )
                    ON CONFLICT (user_id, report_id, type) WHERE type IN (
                        'sla_assignment_breached',
                        'sla_resolution_breached',
                        'dispatch_failed',
                        'unassigned_with_workers_available'
                    )
                    DO NOTHING;

                    IF FOUND THEN
                        v_alerts_created := v_alerts_created + 1;
                    END IF;
                END LOOP;
            END IF;
        END IF;

        -- 2. Check Resolution SLA Breach (all active reports: Reported, Assigned, Accepted, In Progress)
        v_elapsed_mins := EXTRACT(EPOCH FROM (now() - v_report.created_at)) / 60.0;
        IF v_elapsed_mins >= v_target_resolve_mins THEN
            FOREACH v_admin_id IN ARRAY v_admin_ids LOOP
                INSERT INTO public.notifications (
                    user_id,
                    report_id,
                    title,
                    message,
                    type
                ) VALUES (
                    v_admin_id,
                    v_report.id,
                    '🚨 Resolution SLA Breached: ' || upper(v_report.severity::text) || ' Incident',
                    'Report #' || substring(v_report.id::text, 1, 8) || ' (' || v_report.title || ') at ' || v_report.address || ' has exceeded its resolution target of ' || round((v_target_resolve_mins / 60.0)::numeric, 1) || 'h (status: ' || v_report.status::text || ').',
                    'sla_resolution_breached'
                )
                ON CONFLICT (user_id, report_id, type) WHERE type IN (
                    'sla_assignment_breached',
                    'sla_resolution_breached',
                    'dispatch_failed',
                    'unassigned_with_workers_available'
                )
                DO NOTHING;

                IF FOUND THEN
                    v_alerts_created := v_alerts_created + 1;
                END IF;
            END LOOP;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'alerts_created', v_alerts_created
    );
END;
$$;

-- 3. Upgrade auto_assign_report with Dispatch Failure Alerting
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
    v_admin_id UUID;
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

    -- 5. If no worker is available, alert administrators and return structured failure
    IF v_selected_worker_id IS NULL THEN
        FOR v_admin_id IN 
            SELECT id FROM public.profiles WHERE role = 'admin'::public.user_role
        LOOP
            INSERT INTO public.notifications (user_id, report_id, title, message, type)
            VALUES (
                v_admin_id,
                p_report_id,
                '⚠️ Auto-Dispatch Failed: No Available Staff',
                'Automated dispatch for ' || upper(v_report.severity::text) || ' report #' || substring(p_report_id::text, 1, 8) || ' at ' || v_report.address || ' failed: no active, on-duty field workers available.',
                'dispatch_failed'
            )
            ON CONFLICT (user_id, report_id, type) WHERE type IN (
                'sla_assignment_breached',
                'sla_resolution_breached',
                'dispatch_failed',
                'unassigned_with_workers_available'
            )
            DO NOTHING;
        END LOOP;

        RETURN jsonb_build_object(
            'success', false,
            'code', 'NO_AVAILABLE_WORKER',
            'message', 'No active, on-duty field workers are available for assignment at this time.'
        );
    END IF;

    -- 6. Retrieve worker profile details
    SELECT id, full_name, role, is_active INTO v_worker
    FROM public.profiles
    WHERE id = v_selected_worker_id;

    -- 7. Atomically update report
    UPDATE public.reports
    SET 
        status = 'Assigned'::public.report_status,
        assigned_worker_id = v_selected_worker_id,
        assigned_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_report_id;

    -- 8. Insert timeline audit record
    INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
    VALUES (
        p_report_id,
        v_caller_id,
        'Reported'::public.report_status,
        'Assigned'::public.report_status,
        'Auto-assigned by admin to on-duty worker ' || v_worker.full_name
    );

    -- 9. Emit notification for assigned worker
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

-- 4. Function Privileges
REVOKE ALL ON FUNCTION public.evaluate_sla_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_sla_alerts() TO authenticated;
