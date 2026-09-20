-- CleanAlert Migration 9: Phase 5 — Municipal Fleet & Vehicle Management
-- Filename: 20260920000001_phase5_fleet_management.sql

-- 1. Table: public.vehicles
CREATE TABLE IF NOT EXISTS public.vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_number TEXT UNIQUE NOT NULL,
    vehicle_name TEXT NOT NULL,
    vehicle_type TEXT NOT NULL CHECK (
        vehicle_type IN (
            'mini truck',
            'garbage truck',
            'compactor',
            'tipper',
            'tractor',
            'other'
        )
    ),
    capacity_kg NUMERIC NOT NULL DEFAULT 0 CHECK (capacity_kg >= 0),
    status TEXT NOT NULL DEFAULT 'Available' CHECK (
        status IN (
            'Available',
            'Assigned',
            'In Transit',
            'Maintenance',
            'Offline'
        )
    ),
    is_active BOOLEAN NOT NULL DEFAULT true,
    current_location public.geography(Point, 4326),
    last_location_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Table: public.vehicle_assignments
CREATE TABLE IF NOT EXISTS public.vehicle_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
    worker_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
    schedule_id UUID REFERENCES public.collection_schedules(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    released_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'completed', 'released', 'cancelled')
    ),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT chk_vehicle_assignment_target CHECK (
        report_id IS NOT NULL OR schedule_id IS NOT NULL OR worker_id IS NOT NULL
    )
);

-- 3. Indexes for performance, spatial queries, and strict uniqueness
-- Strict partial index: a vehicle can only have ONE active assignment at any time
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_vehicle_assignment 
    ON public.vehicle_assignments(vehicle_id) 
    WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_status ON public.vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_is_active ON public.vehicles(is_active);
CREATE INDEX IF NOT EXISTS idx_vehicles_location_gist ON public.vehicles USING GIST(current_location);
CREATE INDEX IF NOT EXISTS idx_vehicles_registration ON public.vehicles(registration_number);

CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_vehicle_id ON public.vehicle_assignments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_report_id ON public.vehicle_assignments(report_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_schedule_id ON public.vehicle_assignments(schedule_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_worker_id ON public.vehicle_assignments(worker_id);

-- 4. Trigger for updated_at on public.vehicles
DROP TRIGGER IF EXISTS trg_vehicles_updated_at ON public.vehicles;
CREATE TRIGGER trg_vehicles_updated_at
    BEFORE UPDATE ON public.vehicles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 5. Realtime replication setup
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_assignments;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 6. Row Level Security (RLS) Configuration
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_assignments ENABLE ROW LEVEL SECURITY;

-- 6a. RLS Policies for public.vehicles
DROP POLICY IF EXISTS "vehicles_select_policy" ON public.vehicles;
CREATE POLICY "vehicles_select_policy"
    ON public.vehicles FOR SELECT
    TO authenticated
    USING (
        public.is_admin() OR (
            public.is_worker() AND (
                EXISTS (
                    SELECT 1 FROM public.vehicle_assignments va
                    WHERE va.vehicle_id = vehicles.id
                      AND va.released_at IS NULL
                      AND (
                          va.worker_id = auth.uid() OR
                          va.report_id IN (
                              SELECT r.id FROM public.reports r
                              WHERE r.assigned_worker_id = auth.uid()
                          ) OR
                          va.schedule_id IN (
                              SELECT cs.id FROM public.collection_schedules cs
                              WHERE cs.assigned_worker_id = auth.uid()
                          )
                      )
                )
            )
        )
    );

DROP POLICY IF EXISTS "vehicles_insert_policy" ON public.vehicles;
CREATE POLICY "vehicles_insert_policy"
    ON public.vehicles FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "vehicles_update_policy" ON public.vehicles;
CREATE POLICY "vehicles_update_policy"
    ON public.vehicles FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "vehicles_delete_policy" ON public.vehicles;
CREATE POLICY "vehicles_delete_policy"
    ON public.vehicles FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- 6b. RLS Policies for public.vehicle_assignments
DROP POLICY IF EXISTS "vehicle_assignments_select_policy" ON public.vehicle_assignments;
CREATE POLICY "vehicle_assignments_select_policy"
    ON public.vehicle_assignments FOR SELECT
    TO authenticated
    USING (
        public.is_admin() OR (
            public.is_worker() AND (
                worker_id = auth.uid() OR
                report_id IN (
                    SELECT r.id FROM public.reports r
                    WHERE r.assigned_worker_id = auth.uid()
                ) OR
                schedule_id IN (
                    SELECT cs.id FROM public.collection_schedules cs
                    WHERE cs.assigned_worker_id = auth.uid()
                )
            )
        )
    );

DROP POLICY IF EXISTS "vehicle_assignments_insert_policy" ON public.vehicle_assignments;
CREATE POLICY "vehicle_assignments_insert_policy"
    ON public.vehicle_assignments FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "vehicle_assignments_update_policy" ON public.vehicle_assignments;
CREATE POLICY "vehicle_assignments_update_policy"
    ON public.vehicle_assignments FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "vehicle_assignments_delete_policy" ON public.vehicle_assignments;
CREATE POLICY "vehicle_assignments_delete_policy"
    ON public.vehicle_assignments FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- 7. Grant Table Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_assignments TO authenticated;

-- 8. Stored Procedure: assign_vehicle_to_report
CREATE OR REPLACE FUNCTION public.assign_vehicle_to_report(
    p_vehicle_id UUID,
    p_report_id UUID,
    p_worker_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_vehicle RECORD;
    v_report RECORD;
    v_worker RECORD;
    v_target_worker_id UUID;
    v_existing_va RECORD;
    v_assignment_id UUID;
BEGIN
    -- 1. Authorization: caller must be municipal administrator
    IF v_caller_id IS NULL OR NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Only administrators can assign vehicles.'
        );
    END IF;

    -- 2. Lock vehicle row
    SELECT * INTO v_vehicle
    FROM public.vehicles
    WHERE id = p_vehicle_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Vehicle not found.');
    END IF;

    -- 3. Vehicle must be active
    IF NOT v_vehicle.is_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Cannot assign an inactive vehicle. Activate the vehicle first.'
        );
    END IF;

    -- 4. Vehicle must be in Available state
    IF v_vehicle.status != 'Available' THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Vehicle is currently ' || v_vehicle.status || ' and cannot be assigned.'
        );
    END IF;

    -- 5. Lock report row
    SELECT * INTO v_report
    FROM public.reports
    WHERE id = p_report_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Incident report not found.');
    END IF;

    -- 6. Report must not be Resolved or Cancelled
    IF v_report.status IN ('Resolved'::public.report_status, 'Cancelled'::public.report_status) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Cannot assign vehicle to a report that has already been ' || v_report.status::text || '.'
        );
    END IF;

    -- 7. Validate worker if provided, otherwise inherit report worker
    IF p_worker_id IS NOT NULL THEN
        SELECT id, full_name, role, is_active INTO v_worker
        FROM public.profiles
        WHERE id = p_worker_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', 'Target worker profile not found.');
        END IF;

        IF v_worker.role != 'worker'::public.user_role THEN
            RETURN jsonb_build_object('success', false, 'message', 'Specified user is not a municipal field worker.');
        END IF;

        v_target_worker_id := p_worker_id;
    ELSE
        v_target_worker_id := v_report.assigned_worker_id;
        IF v_target_worker_id IS NOT NULL THEN
            SELECT id, full_name, role, is_active INTO v_worker
            FROM public.profiles
            WHERE id = v_target_worker_id;
        END IF;
    END IF;

    -- 8. If report already has an active vehicle assignment, safely release it first (Vehicle Change workflow)
    FOR v_existing_va IN
        SELECT va.id, va.vehicle_id, v.registration_number
        FROM public.vehicle_assignments va
        JOIN public.vehicles v ON v.id = va.vehicle_id
        WHERE va.report_id = p_report_id AND va.released_at IS NULL
    LOOP
        UPDATE public.vehicle_assignments
        SET 
            released_at = timezone('utc'::text, now()),
            status = 'released',
            notes = COALESCE(notes || ' | Replaced by ' || v_vehicle.registration_number, 'Replaced by ' || v_vehicle.registration_number)
        WHERE id = v_existing_va.id;

        UPDATE public.vehicles
        SET 
            status = 'Available',
            updated_at = timezone('utc'::text, now())
        WHERE id = v_existing_va.vehicle_id;

        -- Record release of previous vehicle in timeline
        INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
        VALUES (
            p_report_id,
            v_caller_id,
            v_report.status,
            v_report.status,
            'Previous vehicle ' || v_existing_va.registration_number || ' released (reassigned)'
        );
    END LOOP;

    -- 9. Check target vehicle does not have conflicting active assignments
    IF EXISTS (
        SELECT 1 FROM public.vehicle_assignments
        WHERE vehicle_id = p_vehicle_id AND released_at IS NULL
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Conflicting assignment: vehicle already has an active operational assignment.'
        );
    END IF;

    -- 10. Create new vehicle assignment record
    INSERT INTO public.vehicle_assignments (
        vehicle_id,
        worker_id,
        report_id,
        status,
        notes,
        assigned_at
    ) VALUES (
        p_vehicle_id,
        v_target_worker_id,
        p_report_id,
        'active',
        p_notes,
        timezone('utc'::text, now())
    ) RETURNING id INTO v_assignment_id;

    -- 11. Update vehicle status to Assigned
    UPDATE public.vehicles
    SET 
        status = 'Assigned',
        updated_at = timezone('utc'::text, now())
    WHERE id = p_vehicle_id;

    -- 12. Create report timeline event
    INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
    VALUES (
        p_report_id,
        v_caller_id,
        v_report.status,
        v_report.status,
        'Vehicle ' || v_vehicle.registration_number || ' (' || v_vehicle.vehicle_type || ') assigned to task' ||
        CASE WHEN p_notes IS NOT NULL AND length(trim(p_notes)) > 0 THEN ': ' || p_notes ELSE '' END
    );

    -- 13. Create notification for worker if assigned
    IF v_target_worker_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, report_id, title, message, type)
        VALUES (
            v_target_worker_id,
            p_report_id,
            'Vehicle Assigned to Task',
            'Vehicle ' || v_vehicle.registration_number || ' (' || v_vehicle.vehicle_type || ', ' || v_vehicle.capacity_kg || ' kg) has been assigned to your task at ' || v_report.address || '.',
            'vehicle_assigned'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'assignment_id', v_assignment_id,
        'vehicle_id', p_vehicle_id,
        'registration_number', v_vehicle.registration_number,
        'message', 'Vehicle assigned successfully.'
    );
END;
$$;

-- 9. Stored Procedure: assign_vehicle_to_schedule
CREATE OR REPLACE FUNCTION public.assign_vehicle_to_schedule(
    p_vehicle_id UUID,
    p_schedule_id UUID,
    p_worker_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_vehicle RECORD;
    v_schedule RECORD;
    v_worker RECORD;
    v_target_worker_id UUID;
    v_existing_va RECORD;
    v_assignment_id UUID;
BEGIN
    -- 1. Authorization: caller must be municipal administrator
    IF v_caller_id IS NULL OR NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Only administrators can assign vehicles.'
        );
    END IF;

    -- 2. Lock vehicle row
    SELECT * INTO v_vehicle
    FROM public.vehicles
    WHERE id = p_vehicle_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Vehicle not found.');
    END IF;

    -- 3. Vehicle must be active
    IF NOT v_vehicle.is_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Cannot assign an inactive vehicle. Activate the vehicle first.'
        );
    END IF;

    -- 4. Vehicle must be in Available state
    IF v_vehicle.status != 'Available' THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Vehicle is currently ' || v_vehicle.status || ' and cannot be assigned.'
        );
    END IF;

    -- 5. Lock schedule row
    SELECT * INTO v_schedule
    FROM public.collection_schedules
    WHERE id = p_schedule_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Collection schedule not found.');
    END IF;

    -- 6. Schedule must not be cancelled or completed
    IF v_schedule.status IN ('completed'::public.schedule_status, 'cancelled'::public.schedule_status) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Cannot assign vehicle to a schedule that is already ' || v_schedule.status::text || '.'
        );
    END IF;

    -- 7. Validate worker if provided, otherwise inherit schedule worker
    IF p_worker_id IS NOT NULL THEN
        SELECT id, full_name, role, is_active INTO v_worker
        FROM public.profiles
        WHERE id = p_worker_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', 'Target worker profile not found.');
        END IF;

        IF v_worker.role != 'worker'::public.user_role THEN
            RETURN jsonb_build_object('success', false, 'message', 'Specified user is not a municipal field worker.');
        END IF;

        v_target_worker_id := p_worker_id;
    ELSE
        v_target_worker_id := v_schedule.assigned_worker_id;
    END IF;

    -- 8. If schedule already has an active vehicle assignment, safely release it first
    FOR v_existing_va IN
        SELECT va.id, va.vehicle_id, v.registration_number
        FROM public.vehicle_assignments va
        JOIN public.vehicles v ON v.id = va.vehicle_id
        WHERE va.schedule_id = p_schedule_id AND va.released_at IS NULL
    LOOP
        UPDATE public.vehicle_assignments
        SET 
            released_at = timezone('utc'::text, now()),
            status = 'released',
            notes = COALESCE(notes || ' | Replaced by ' || v_vehicle.registration_number, 'Replaced by ' || v_vehicle.registration_number)
        WHERE id = v_existing_va.id;

        UPDATE public.vehicles
        SET 
            status = 'Available',
            updated_at = timezone('utc'::text, now())
        WHERE id = v_existing_va.vehicle_id;
    END LOOP;

    -- 9. Check target vehicle does not have conflicting active assignments
    IF EXISTS (
        SELECT 1 FROM public.vehicle_assignments
        WHERE vehicle_id = p_vehicle_id AND released_at IS NULL
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Conflicting assignment: vehicle already has an active operational assignment.'
        );
    END IF;

    -- 10. Create new vehicle assignment record
    INSERT INTO public.vehicle_assignments (
        vehicle_id,
        worker_id,
        schedule_id,
        status,
        notes,
        assigned_at
    ) VALUES (
        p_vehicle_id,
        v_target_worker_id,
        p_schedule_id,
        'active',
        p_notes,
        timezone('utc'::text, now())
    ) RETURNING id INTO v_assignment_id;

    -- 11. Update vehicle status to Assigned
    UPDATE public.vehicles
    SET 
        status = 'Assigned',
        updated_at = timezone('utc'::text, now())
    WHERE id = p_vehicle_id;

    -- 12. Create notification for worker if assigned
    IF v_target_worker_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
            v_target_worker_id,
            'Vehicle Assigned to Collection Schedule',
            'Vehicle ' || v_vehicle.registration_number || ' (' || v_vehicle.vehicle_type || ') has been assigned to your collection schedule: ' || v_schedule.title || ' (' || v_schedule.zone_name || ').',
            'schedule_vehicle_assigned'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'assignment_id', v_assignment_id,
        'vehicle_id', p_vehicle_id,
        'registration_number', v_vehicle.registration_number,
        'message', 'Vehicle assigned to schedule successfully.'
    );
END;
$$;

-- 10. Stored Procedure: release_vehicle_assignment
CREATE OR REPLACE FUNCTION public.release_vehicle_assignment(
    p_assignment_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_assignment RECORD;
    v_vehicle RECORD;
    v_report RECORD;
BEGIN
    -- 1. Authorization: caller must be municipal administrator
    IF v_caller_id IS NULL OR NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Only administrators can release vehicle assignments.'
        );
    END IF;

    -- 2. Lock assignment row
    SELECT * INTO v_assignment
    FROM public.vehicle_assignments
    WHERE id = p_assignment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Assignment not found.');
    END IF;

    IF v_assignment.released_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Vehicle assignment has already been released.');
    END IF;

    -- 3. Lock vehicle row
    SELECT * INTO v_vehicle
    FROM public.vehicles
    WHERE id = v_assignment.vehicle_id
    FOR UPDATE;

    -- 4. Mark assignment released
    UPDATE public.vehicle_assignments
    SET 
        released_at = timezone('utc'::text, now()),
        status = 'released',
        notes = CASE 
            WHEN p_notes IS NOT NULL AND length(trim(p_notes)) > 0 
            THEN COALESCE(notes || ' | Release note: ' || p_notes, 'Release note: ' || p_notes)
            ELSE COALESCE(notes, 'Released')
        END
    WHERE id = p_assignment_id;

    -- 5. Return vehicle to Available if active and currently Assigned
    IF v_vehicle.id IS NOT NULL AND v_vehicle.is_active AND v_vehicle.status = 'Assigned' THEN
        UPDATE public.vehicles
        SET 
            status = 'Available',
            updated_at = timezone('utc'::text, now())
        WHERE id = v_vehicle.id;
    END IF;

    -- 6. If report is associated, create timeline event and notify worker
    IF v_assignment.report_id IS NOT NULL THEN
        SELECT * INTO v_report
        FROM public.reports
        WHERE id = v_assignment.report_id;

        IF FOUND THEN
            INSERT INTO public.report_timeline (report_id, actor_id, previous_status, new_status, notes)
            VALUES (
                v_assignment.report_id,
                v_caller_id,
                v_report.status,
                v_report.status,
                'Vehicle ' || v_vehicle.registration_number || ' released from operational task' ||
                CASE WHEN p_notes IS NOT NULL AND length(trim(p_notes)) > 0 THEN ': ' || p_notes ELSE '' END
            );

            IF v_report.assigned_worker_id IS NOT NULL THEN
                INSERT INTO public.notifications (user_id, report_id, title, message, type)
                VALUES (
                    v_report.assigned_worker_id,
                    v_assignment.report_id,
                    'Vehicle Released',
                    'Vehicle ' || v_vehicle.registration_number || ' has been released from your task.',
                    'vehicle_released'
                );
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'assignment_id', p_assignment_id,
        'vehicle_id', v_vehicle.id,
        'message', 'Vehicle assignment released successfully.'
    );
END;
$$;

-- 11. Stored Procedure: update_vehicle_safe
-- Protects against orphaning active assignments when setting to Maintenance/Offline/Inactive
CREATE OR REPLACE FUNCTION public.update_vehicle_safe(
    p_vehicle_id UUID,
    p_vehicle_name TEXT,
    p_vehicle_type TEXT,
    p_capacity_kg NUMERIC,
    p_status TEXT,
    p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_vehicle RECORD;
    v_has_active_assignment BOOLEAN;
BEGIN
    -- 1. Authorization: caller must be municipal administrator
    IF v_caller_id IS NULL OR NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Only administrators can modify vehicles.'
        );
    END IF;

    -- 2. Lock vehicle
    SELECT * INTO v_vehicle
    FROM public.vehicles
    WHERE id = p_vehicle_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Vehicle not found.');
    END IF;

    -- 3. Check for active assignments
    SELECT EXISTS (
        SELECT 1 FROM public.vehicle_assignments
        WHERE vehicle_id = p_vehicle_id AND released_at IS NULL
    ) INTO v_has_active_assignment;

    -- 4. Prevent setting to Maintenance/Offline/Inactive if an active assignment exists
    IF v_has_active_assignment AND (p_is_active = false OR p_status IN ('Maintenance', 'Offline')) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Cannot set vehicle to ' || p_status || ' or inactive while an active operational assignment exists. Please release the active assignment first.'
        );
    END IF;

    -- 5. Update vehicle fields
    UPDATE public.vehicles
    SET 
        vehicle_name = p_vehicle_name,
        vehicle_type = p_vehicle_type,
        capacity_kg = p_capacity_kg,
        status = p_status,
        is_active = p_is_active,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_vehicle_id;

    RETURN jsonb_build_object(
        'success', true,
        'vehicle_id', p_vehicle_id,
        'message', 'Vehicle updated successfully.'
    );
END;
$$;

-- 12. Stored Procedure: update_vehicle_location
CREATE OR REPLACE FUNCTION public.update_vehicle_location(
    p_vehicle_id UUID,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_is_authorized BOOLEAN;
BEGIN
    -- Admin or worker currently assigned to the vehicle
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized.');
    END IF;

    IF public.is_admin() THEN
        v_is_authorized := true;
    ELSIF public.is_worker() THEN
        SELECT EXISTS (
            SELECT 1 FROM public.vehicle_assignments va
            WHERE va.vehicle_id = p_vehicle_id
              AND va.released_at IS NULL
              AND (
                  va.worker_id = v_caller_id OR
                  va.report_id IN (SELECT r.id FROM public.reports r WHERE r.assigned_worker_id = v_caller_id) OR
                  va.schedule_id IN (SELECT cs.id FROM public.collection_schedules cs WHERE cs.assigned_worker_id = v_caller_id)
              )
        ) INTO v_is_authorized;
    ELSE
        v_is_authorized := false;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: You are not authorized to update this vehicle location.'
        );
    END IF;

    -- Validate coordinates
    IF p_latitude IS NULL OR p_longitude IS NULL OR 
       p_latitude < -90 OR p_latitude > 90 OR 
       p_longitude < -180 OR p_longitude > 180 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid geographic coordinates.');
    END IF;

    UPDATE public.vehicles
    SET 
        current_location = ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::public.geography,
        last_location_updated_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_vehicle_id;

    RETURN jsonb_build_object(
        'success', true,
        'vehicle_id', p_vehicle_id,
        'latitude', p_latitude,
        'longitude', p_longitude,
        'message', 'Location updated successfully.'
    );
END;
$$;

-- 13. Grant Execute Permissions
GRANT EXECUTE ON FUNCTION public.assign_vehicle_to_report TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_vehicle_to_schedule TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_vehicle_assignment TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_vehicle_safe TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_vehicle_location TO authenticated;
