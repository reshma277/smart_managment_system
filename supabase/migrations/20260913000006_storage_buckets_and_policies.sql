-- CleanAlert Migration 6: Private Storage Buckets & Canonical Path Policies
-- Filename: 20260913000006_storage_buckets_and_policies.sql

-- 1. Initialize Private Storage Buckets (public = false)
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-photos', 'report-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

INSERT INTO storage.buckets (id, name, public)
VALUES ('resolution-photos', 'resolution-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2. Storage Upload Policies (Canonical folder ownership enforcement)
-- Citizens can upload initial evidence only to their own directory prefix: report-photos/{citizen_id}/*
DROP POLICY IF EXISTS "citizens_upload_report_photos" ON storage.objects;
CREATE POLICY "citizens_upload_report_photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'report-photos' AND
    (storage.foldername(name))[1] = auth.uid()::text AND
    (public.is_citizen() OR public.is_admin())
);

-- Workers and Admins can upload resolution proof only to their own directory prefix: resolution-photos/{worker_or_admin_id}/*
DROP POLICY IF EXISTS "workers_upload_resolution_photos" ON storage.objects;
CREATE POLICY "workers_upload_resolution_photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'resolution-photos' AND
    (storage.foldername(name))[1] = auth.uid()::text AND
    (public.is_worker() OR public.is_admin())
);

-- 3. Storage Read Policies (Leveraging Non-Recursive Security Definer Helper)
-- Enforces that only authorized parties (Admins, folder owners, assigned workers, submitters, and supporters) can read photos
DROP POLICY IF EXISTS "admins_read_all_photos" ON storage.objects;
DROP POLICY IF EXISTS "users_read_own_uploaded_photos" ON storage.objects;
DROP POLICY IF EXISTS "assigned_workers_read_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "supporters_read_followed_report_photos" ON storage.objects;
DROP POLICY IF EXISTS "storage_read_authorized_photos" ON storage.objects;

CREATE POLICY "storage_read_authorized_photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id IN ('report-photos', 'resolution-photos') AND
    public.can_access_storage_photo(bucket_id, name, auth.uid())
);

-- 4. Storage Deletion Policies (Admins only)
-- Prevents tampering or deletion of municipal evidence by normal users
DROP POLICY IF EXISTS "admins_manage_photos" ON storage.objects;
CREATE POLICY "admins_manage_photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id IN ('report-photos', 'resolution-photos') AND
    public.is_admin()
);
