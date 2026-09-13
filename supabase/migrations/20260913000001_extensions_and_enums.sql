-- CleanAlert Migration 1: Extensions & ENUMs
-- Filename: 20260913000001_extensions_and_enums.sql

-- Enable spatial and cryptographic extensions
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- User Authorization Roles
DO $$ BEGIN
    CREATE TYPE public.user_role AS ENUM (
        'citizen',
        'worker',
        'admin'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Core Report Lifecycle States (Strict Linear Workflow)
DO $$ BEGIN
    CREATE TYPE public.report_status AS ENUM (
        'Reported',
        'Assigned',
        'Accepted',
        'In Progress',
        'Resolved',
        'Cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Waste Categorization
DO $$ BEGIN
    CREATE TYPE public.garbage_type AS ENUM (
        'general',
        'organic',
        'plastic',
        'hazardous',
        'electronic',
        'construction',
        'bulk'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Incident Priority
DO $$ BEGIN
    CREATE TYPE public.severity_level AS ENUM (
        'low',
        'medium',
        'high',
        'critical'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Municipal Collection Schedule Recurrence
DO $$ BEGIN
    CREATE TYPE public.schedule_frequency AS ENUM (
        'daily',
        'weekly',
        'biweekly',
        'monthly'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Schedule Execution Status
DO $$ BEGIN
    CREATE TYPE public.schedule_status AS ENUM (
        'scheduled',
        'in_progress',
        'completed',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
