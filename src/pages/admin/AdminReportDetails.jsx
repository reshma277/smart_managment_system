import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import ReportTimeline from '../../components/citizen/ReportTimeline';
import ReportSlaBadge from '../../components/admin/ReportSlaBadge';
import VehicleStatusBadge from '../../components/admin/VehicleStatusBadge';
import { getReportAssignmentSla, getReportResolutionSla, formatSlaDuration, SLA_CONFIG } from '../../utils/sla';
import { getVehicleTypeIcon, getVehicleTypeLabel, formatCapacity } from '../../utils/fleet';
import { supabase } from '../../lib/supabase';
import '../../styles/admin.css';

const GARBAGE_TYPE_LABELS = {
  general: 'General Waste',
  household: 'Household Waste',
  commercial: 'Commercial Waste',
  construction: 'Construction / Debris',
  organic: 'Organic / Food Waste',
  plastic: 'Plastic / Recyclable',
  electronic: 'Electronic (E-waste)',
  hazardous: 'Hazardous / Biohazard',
  other: 'Other / Mixed Waste',
};

const LIFECYCLE_STAGES = [
  'Reported',
  'Assigned',
  'Accepted',
  'In Progress',
  'Resolved',
];

function getWorkerDistance(workerLocation, reportLat, reportLng) {
  if (!workerLocation || reportLat == null || reportLng == null) return null;
  let wLat = null;
  let wLng = null;
  if (typeof workerLocation === 'object' && Array.isArray(workerLocation.coordinates)) {
    [wLng, wLat] = workerLocation.coordinates;
  } else if (typeof workerLocation === 'string') {
    const match = workerLocation.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) {
      wLng = parseFloat(match[1]);
      wLat = parseFloat(match[2]);
    }
  }
  if (wLat == null || wLng == null || Number.isNaN(wLat) || Number.isNaN(wLng)) return null;

  const R = 6371; // km
  const dLat = ((reportLat - wLat) * Math.PI) / 180;
  const dLng = ((reportLng - wLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((wLat * Math.PI) / 180) *
      Math.cos((reportLat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d)} km`;
}

export default function AdminReportDetails() {
  const { reportId } = useParams();

  const [report, setReport] = useState(null);
  const [assignedWorker, setAssignedWorker] = useState(null);
  const [reportingCitizen, setReportingCitizen] = useState(null);
  const [availableWorkers, setAvailableWorkers] = useState([]);
  const [workerSchedules, setWorkerSchedules] = useState([]);
  const [incidentPhotoSignedUrl, setIncidentPhotoSignedUrl] = useState(null);
  const [resolutionPhotoSignedUrl, setResolutionPhotoSignedUrl] = useState(null);

  // Dispatch Assignment state
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignFeedback, setAssignFeedback] = useState(null);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);

  // Reassignment state
  const [showReassignForm, setShowReassignForm] = useState(false);
  const [reassignWorkerId, setReassignWorkerId] = useState('');
  const [reassignNotes, setReassignNotes] = useState('');
  const [isReassigning, setIsReassigning] = useState(false);
  const [reassignFeedback, setReassignFeedback] = useState(null);

  // Vehicle Assignment state
  const [assignedVehicle, setAssignedVehicle] = useState(null);
  const [availableVehicles, setAvailableVehicles] = useState([]);
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [vehicleModalMode, setVehicleModalMode] = useState('assign');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [vehicleNotes, setVehicleNotes] = useState('');
  const [isAssigningVehicle, setIsAssigningVehicle] = useState(false);
  const [isReleasingVehicle, setIsReleasingVehicle] = useState(false);
  const [vehicleFeedback, setVehicleFeedback] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    if (!reportId) return;

    let isMounted = true;

    async function loadReportDetails() {
      try {
        // 1. Fetch main incident report
        const { data: reportData, error: reportErr } = await supabase
          .from('reports')
          .select('*')
          .eq('id', reportId)
          .maybeSingle();

        if (reportErr) {
          console.error('Error loading report details:', reportErr);
          if (isMounted) setError('Unable to load incident report details.');
          return;
        }

        if (!reportData) {
          if (isMounted) setError('Incident report not found.');
          return;
        }

        // 2. Fetch assigned worker if set
        let workerInfo = null;
        if (reportData.assigned_worker_id) {
          try {
            const { data: wData } = await supabase
              .from('public_profiles')
              .select('id, full_name, role')
              .eq('id', reportData.assigned_worker_id)
              .maybeSingle();
            workerInfo = wData || null;
          } catch (wErr) {
            console.warn('Could not load assigned worker profile:', wErr);
          }
        }

        // 3. Fetch citizen info if set
        let citizenInfo = null;
        if (reportData.citizen_id) {
          try {
            const { data: cData } = await supabase
              .from('public_profiles')
              .select('id, full_name, role')
              .eq('id', reportData.citizen_id)
              .maybeSingle();
            citizenInfo = cData || null;
          } catch (cErr) {
            console.warn('Could not load citizen profile:', cErr);
          }
        }

        // 4. Fetch available workers for dispatch assignment + active task loads
        let workerList = [];
        try {
          const [workersRes, activeLoadsRes] = await Promise.all([
            supabase
              .from('profiles')
              .select('id, full_name, role, is_active, current_location')
              .eq('role', 'worker')
              .order('full_name', { ascending: true }),
            supabase
              .from('reports')
              .select('assigned_worker_id')
              .in('status', ['Assigned', 'Accepted', 'In Progress'])
              .not('assigned_worker_id', 'is', null),
          ]);

          const loadMap = {};
          (activeLoadsRes.data || []).forEach((r) => {
            if (r.assigned_worker_id) {
              loadMap[r.assigned_worker_id] = (loadMap[r.assigned_worker_id] || 0) + 1;
            }
          });

          workerList = (workersRes.data || []).map((w) => ({
            ...w,
            activeTasks: loadMap[w.id] || 0,
          }));
        } catch (wListErr) {
          console.warn('Could not load workers roster:', wListErr);
        }

        // 5. Create signed URLs for photos
        let beforeUrl = null;
        if (reportData.photo_url) {
          try {
            const { data: sData } = await supabase.storage
              .from('report-photos')
              .createSignedUrl(reportData.photo_url, 3600);
            beforeUrl = sData?.signedUrl || null;
          } catch (signErr) {
            console.warn('Could not sign before photo URL:', signErr);
          }
        }

        let afterUrl = null;
        if (reportData.resolution_photo_url) {
          try {
            const { data: resData } = await supabase.storage
              .from('resolution-photos')
              .createSignedUrl(reportData.resolution_photo_url, 3600);
            afterUrl = resData?.signedUrl || null;
          } catch (resSignErr) {
            console.warn('Could not sign resolution photo URL:', resSignErr);
          }
        }

        // 5. Fetch assigned worker's active collection schedules if assigned
        let activeSchedules = [];
        if (reportData.assigned_worker_id) {
          try {
            const { data: schedData } = await supabase
              .from('collection_schedules')
              .select('id, title, zone_name, frequency, scheduled_date, scheduled_start_time, scheduled_end_time, status')
              .eq('assigned_worker_id', reportData.assigned_worker_id)
              .in('status', ['scheduled', 'in_progress'])
              .order('scheduled_date', { ascending: true })
              .limit(5);
            activeSchedules = schedData || [];
          } catch (sErr) {
            console.warn('Could not load worker schedules:', sErr);
          }
        }

        // 6. Fetch active vehicle assignment for this report
        let currentVehicleAsgn = null;
        try {
          const { data: vaData, error: vaErr } = await supabase
            .from('vehicle_assignments')
            .select(`
              id,
              vehicle_id,
              worker_id,
              assigned_at,
              status,
              notes,
              vehicle:vehicles!vehicle_assignments_vehicle_id_fkey(id, registration_number, vehicle_name, vehicle_type, capacity_kg, status),
              worker:profiles!vehicle_assignments_worker_id_fkey(id, full_name)
            `)
            .eq('report_id', reportId)
            .is('released_at', null)
            .maybeSingle();

          if (!vaErr && vaData) {
            currentVehicleAsgn = vaData;
          }
        } catch (vaEx) {
          console.warn('Could not load report vehicle assignment:', vaEx);
        }

        // 7. Fetch available active vehicles for assignment dropdown
        let availVehicles = [];
        try {
          const { data: vListData } = await supabase
            .from('vehicles')
            .select('id, registration_number, vehicle_name, vehicle_type, capacity_kg, status')
            .eq('is_active', true)
            .eq('status', 'Available')
            .order('registration_number', { ascending: true });
          availVehicles = vListData || [];
        } catch (vListEx) {
          console.warn('Could not load available vehicles:', vListEx);
        }

        if (isMounted) {
          setReport(reportData);
          setAssignedWorker(workerInfo);
          setReportingCitizen(citizenInfo);
          setAvailableWorkers(workerList);
          setWorkerSchedules(activeSchedules);
          setAssignedVehicle(currentVehicleAsgn);
          setAvailableVehicles(availVehicles);
          setIncidentPhotoSignedUrl(beforeUrl);
          setResolutionPhotoSignedUrl(afterUrl);
          setError(null);
        }
      } catch (err) {
        console.error('Exception loading admin report details:', err);
        if (isMounted) setError('Network error while retrieving report information.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadReportDetails();

    const channel = supabase
      .channel(`admin-report-detail-${reportId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports', filter: `id=eq.${reportId}` },
        () => {
          loadReportDetails();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vehicle_assignments', filter: `report_id=eq.${reportId}` },
        () => {
          loadReportDetails();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [reportId, refreshKey]);

  // Handle worker assignment via RPC assign_report_to_worker
  const handleAssignWorker = async (e) => {
    e.preventDefault();
    if (!selectedWorkerId || isAssigning || !reportId) return;

    setIsAssigning(true);
    setAssignFeedback(null);

    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('assign_report_to_worker', {
        p_report_id: reportId,
        p_worker_id: selectedWorkerId,
        p_notes: assignNotes.trim() || null,
      });

      if (rpcErr) {
        console.error('assign_report_to_worker error:', rpcErr);
        setAssignFeedback({
          type: 'error',
          message: rpcErr.message || 'Worker assignment failed.',
        });
      } else if (rpcRes?.success === false) {
        setAssignFeedback({
          type: 'error',
          message: rpcRes.message || 'Assignment rejected. Verify report is in Reported status.',
        });
      } else {
        setAssignFeedback({
          type: 'success',
          message: 'Worker assigned successfully! Incident status updated to Assigned.',
        });
        setSelectedWorkerId('');
        setAssignNotes('');
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error('Assignment exception:', err);
      setAssignFeedback({
        type: 'error',
        message: 'Network error occurred during assignment.',
      });
    } finally {
      setIsAssigning(false);
    }
  };

  // Handle on-demand auto-assignment via RPC auto_assign_report
  const handleAutoAssign = async () => {
    if (isAutoAssigning || !reportId) return;

    setIsAutoAssigning(true);
    setAssignFeedback(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('auto_assign_report', {
        p_report_id: reportId,
      });

      if (rpcErr) {
        console.error('auto_assign_report error:', rpcErr);
        setAssignFeedback({
          type: 'error',
          message: rpcErr.message || 'Auto-assignment failed.',
        });
      } else if (data?.success === false) {
        setAssignFeedback({
          type: 'error',
          message: data.code === 'NO_AVAILABLE_WORKER'
            ? 'No available on-duty worker found within operational range.'
            : (data.message || 'Auto-assignment rejected.'),
        });
      } else {
        setAssignFeedback({
          type: 'success',
          message: `Auto-assigned to ${data.worker_name || 'optimal worker'}! Incident status updated to Assigned.`,
        });
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error('Auto-assign exception:', err);
      setAssignFeedback({
        type: 'error',
        message: 'Network error occurred during auto-assignment.',
      });
    } finally {
      setIsAutoAssigning(false);
    }
  };

  // Handle worker reassignment via RPC reassign_report_to_worker
  const handleReassignWorker = async (e) => {
    e.preventDefault();
    if (!reassignWorkerId || isReassigning || !reportId) return;

    setIsReassigning(true);
    setReassignFeedback(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('reassign_report_to_worker', {
        p_report_id: reportId,
        p_new_worker_id: reassignWorkerId,
        p_notes: reassignNotes.trim() || null,
      });

      if (rpcErr) {
        console.error('reassign_report_to_worker error:', rpcErr);
        setReassignFeedback({
          type: 'error',
          message: rpcErr.message || 'Worker reassignment failed.',
        });
      } else if (data?.success === false) {
        setReassignFeedback({
          type: 'error',
          message: data.message || 'Reassignment rejected. Verify worker eligibility.',
        });
      } else {
        setReassignFeedback({
          type: 'success',
          message: `Incident successfully reassigned to ${data.new_worker_name || 'new field operator'}!`,
        });
        setReassignWorkerId('');
        setReassignNotes('');
        setRefreshKey((k) => k + 1);
        setTimeout(() => {
          setShowReassignForm(false);
        }, 2200);
      }
    } catch (err) {
      console.error('Reassignment exception:', err);
      setReassignFeedback({
        type: 'error',
        message: 'Network error occurred during reassignment.',
      });
    } finally {
      setIsReassigning(false);
    }
  };

  // Vehicle Assignment Handlers
  const handleOpenVehicleModal = (mode) => {
    setVehicleModalMode(mode);
    setSelectedVehicleId('');
    setVehicleNotes('');
    setVehicleFeedback(null);
    setIsVehicleModalOpen(true);
  };

  const handleAssignVehicleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedVehicleId) return;

    setIsAssigningVehicle(true);
    setVehicleFeedback(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('assign_vehicle_to_report', {
        p_vehicle_id: selectedVehicleId,
        p_report_id: reportId,
        p_worker_id: assignedWorker?.id || null,
        p_notes: vehicleNotes.trim() || null,
      });

      if (rpcErr) {
        console.error('assign_vehicle_to_report error:', rpcErr);
        setVehicleFeedback({
          type: 'error',
          message: rpcErr.message || 'Failed to assign vehicle.',
        });
      } else if (data && !data.success) {
        setVehicleFeedback({
          type: 'error',
          message: data.message || 'Vehicle assignment was rejected.',
        });
      } else {
        setIsVehicleModalOpen(false);
        setSelectedVehicleId('');
        setVehicleNotes('');
        setVehicleFeedback({
          type: 'success',
          message: `Vehicle ${data.registration_number || ''} successfully assigned to this report.`,
        });
        handleRetry();
        setTimeout(() => setVehicleFeedback(null), 5000);
      }
    } catch (err) {
      console.error('Vehicle assignment exception:', err);
      setVehicleFeedback({
        type: 'error',
        message: 'Network error while assigning vehicle.',
      });
    } finally {
      setIsAssigningVehicle(false);
    }
  };

  const handleReleaseVehicle = async () => {
    if (!assignedVehicle) return;

    setIsReleasingVehicle(true);
    setVehicleFeedback(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('release_vehicle_assignment', {
        p_assignment_id: assignedVehicle.id,
        p_notes: 'Released manually via Admin Report Details Console',
      });

      if (rpcErr) {
        console.error('release_vehicle_assignment error:', rpcErr);
        setVehicleFeedback({
          type: 'error',
          message: rpcErr.message || 'Failed to release vehicle.',
        });
      } else if (data && !data.success) {
        setVehicleFeedback({
          type: 'error',
          message: data.message || 'Vehicle release rejected.',
        });
      } else {
        setVehicleFeedback({
          type: 'success',
          message: 'Vehicle released and returned to Available fleet.',
        });
        handleRetry();
        setTimeout(() => setVehicleFeedback(null), 5000);
      }
    } catch (err) {
      console.error('Vehicle release exception:', err);
      setVehicleFeedback({
        type: 'error',
        message: 'Network error while releasing vehicle.',
      });
    } finally {
      setIsReleasingVehicle(false);
    }
  };

  const currentStageIndex = report ? LIFECYCLE_STAGES.indexOf(report.status) : -1;

  return (
    <div className="admin-layout">
      <UserNavbar />

      <main className="admin-main" role="main">
        {/* TOP BREADCRUMB & HEADER */}
        <div>
          <Link
            to="/admin/reports"
            className="btn-admin-secondary btn-admin-sm"
            style={{ display: 'inline-flex', marginBottom: '0.75rem' }}
          >
            &larr; Back to Reports
          </Link>

          {report && (
            <div className="admin-detail-header-card">
              <div className="admin-detail-title-row">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <span className="ref-id-badge">#{report.id.slice(0, 8)}</span>
                    <span className={`admin-severity-badge severity-${(report.severity || 'medium').toLowerCase()}`}>
                      {report.severity?.toUpperCase()}
                    </span>
                  </div>
                  <h1 className="admin-detail-title">{report.title}</h1>
                </div>

                <ReportStatusBadge status={report.status} />
              </div>

              {/* COMPACT LIFECYCLE STEPPER */}
              <div className="admin-lifecycle-bar" role="navigation" aria-label="Incident Lifecycle">
                {LIFECYCLE_STAGES.map((stage, idx) => {
                  const isCompleted = currentStageIndex > idx;
                  const isActive = currentStageIndex === idx;

                  return (
                    <div
                      key={stage}
                      className={`admin-lifecycle-step ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}
                    >
                      <span className="lifecycle-step-dot" aria-hidden="true">
                        {isCompleted ? '✓' : idx + 1}
                      </span>
                      <span>{stage}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* LOADING STATE */}
        {loading && (
          <div className="admin-state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="admin-state-title">Loading Incident Information...</p>
            <p className="admin-state-desc">Retrieving municipal dispatch history, evidence, and field logs.</p>
          </div>
        )}

        {/* ERROR STATE */}
        {!loading && error && (
          <div className="admin-state-box" role="alert">
            <span className="admin-state-icon" aria-hidden="true">⚠️</span>
            <p className="admin-state-title">Unable to Load Report</p>
            <p className="admin-state-desc">{error}</p>
            <button
              type="button"
              className="btn-admin-primary"
              onClick={handleRetry}
            >
              Try Again
            </button>
          </div>
        )}

        {/* MAIN OPERATIONAL CONTENT */}
        {!loading && !error && report && (
          <>
            <div className="admin-detail-grid">
              {/* LEFT COLUMN: INCIDENT OVERVIEW & RESOLUTION EVIDENCE */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* INCIDENT OVERVIEW CARD */}
                <section className="admin-card" aria-labelledby="incident-overview-heading">
                  <h2 id="incident-overview-heading" style={{ margin: '0 0 1rem 0', fontSize: '1.15rem', color: 'var(--admin-text-h)' }}>
                    Incident Overview
                  </h2>

                  {incidentPhotoSignedUrl ? (
                    <div className="evidence-img-container" style={{ marginBottom: '1.25rem' }}>
                      <img
                        src={incidentPhotoSignedUrl}
                        alt={`Incident site: ${report.title}`}
                        className="evidence-img"
                      />
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '2rem',
                        background: 'var(--admin-bg)',
                        borderRadius: '10px',
                        textAlign: 'center',
                        color: 'var(--admin-text-body)',
                        marginBottom: '1.25rem',
                        border: '1px dashed var(--admin-border)',
                      }}
                    >
                      📸 No Initial Incident Photo Uploaded
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>
                        Description
                      </span>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.925rem', color: 'var(--admin-text-h)', lineHeight: 1.55 }}>
                        {report.description || 'No detailed incident description provided.'}
                      </p>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid var(--admin-border-subtle)' }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>
                          Category
                        </span>
                        <p style={{ margin: '0.15rem 0 0 0', fontWeight: 600, color: 'var(--admin-text-h)' }}>
                          {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}
                        </p>
                      </div>

                      <div>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>
                          Location Address
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.15rem' }}>
                          <p style={{ margin: 0, fontWeight: 600, color: 'var(--admin-text-h)' }}>
                            📍 {report.address || 'Coordinates Recorded'}
                          </p>
                          {report.latitude && report.longitude && (
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${report.latitude},${report.longitude}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-admin-secondary btn-admin-sm"
                              style={{ textDecoration: 'none', padding: '0.25rem 0.65rem', fontSize: '0.75rem' }}
                              id="btn-admin-navigate"
                            >
                              🧭 NAVIGATE ↗
                            </a>
                          )}
                        </div>
                      </div>

                      <div>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>
                          Reported By Citizen
                        </span>
                        <p style={{ margin: '0.15rem 0 0 0', fontWeight: 600, color: 'var(--admin-text-h)' }}>
                          {reportingCitizen ? reportingCitizen.full_name : 'Municipal Resident'}
                        </p>
                      </div>

                      <div>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>
                          Submitted Time
                        </span>
                        <p style={{ margin: '0.15rem 0 0 0', fontWeight: 600, color: 'var(--admin-text-h)' }}>
                          {new Date(report.created_at).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* OPERATIONAL SLA PERFORMANCE CARD */}
                {report && (
                  (() => {
                    const assignmentSla = getReportAssignmentSla(report);
                    const resolutionSla = getReportResolutionSla(report);
                    const config = SLA_CONFIG[report.severity?.toLowerCase()] || SLA_CONFIG.medium;

                    return (
                      <section className="admin-card" aria-labelledby="sla-performance-heading">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <h2 id="sla-performance-heading" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--admin-text-h)' }}>
                              Operational SLA Performance
                            </h2>
                            <ReportSlaBadge report={report} />
                          </div>
                          <span style={{ fontSize: '0.775rem', fontWeight: 600, color: 'var(--admin-text-body)' }}>
                            Target Tier: <strong style={{ color: 'var(--admin-text-h)' }}>{config.label}</strong> ({formatSlaDuration(config.assignmentMinutes)} assign / {formatSlaDuration(config.resolutionMinutes)} resolve)
                          </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                          {/* ASSIGNMENT SLA */}
                          <div style={{ padding: '1rem', background: 'var(--admin-bg)', borderRadius: '8px', border: '1px solid var(--admin-border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>
                                Assignment Response
                              </span>
                              <span className={`sla-badge sla-${assignmentSla.state}`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
                                {assignmentSla.state === 'breached' ? 'Breached' : assignmentSla.state === 'approaching' ? 'Near Target' : 'Within Target'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--admin-text-h)' }}>
                                {formatSlaDuration(assignmentSla.elapsedMinutes)}
                              </span>
                              <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-body)' }}>
                                / {formatSlaDuration(assignmentSla.targetMinutes)} target
                              </span>
                            </div>
                            <div style={{ height: '6px', background: '#E2E8F0', borderRadius: '3px', overflow: 'hidden', margin: '0.5rem 0' }}>
                              <div
                                style={{
                                  height: '100%',
                                  width: `${Math.min(100, Math.round((assignmentSla.elapsedMinutes / assignmentSla.targetMinutes) * 100))}%`,
                                  background: assignmentSla.state === 'breached' ? '#DC2626' : assignmentSla.state === 'approaching' ? '#D97706' : '#16A34A',
                                  transition: 'width 0.3s ease',
                                }}
                              />
                            </div>
                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--admin-text-body)' }}>
                              {report.assigned_at
                                ? `Assigned in ${formatSlaDuration(assignmentSla.elapsedMinutes)}`
                                : assignmentSla.state === 'breached'
                                  ? `Overdue by ${formatSlaDuration(Math.abs(assignmentSla.remainingMinutes))}`
                                  : `${formatSlaDuration(assignmentSla.remainingMinutes)} remaining until target`}
                            </p>
                          </div>

                          {/* RESOLUTION SLA */}
                          <div style={{ padding: '1rem', background: 'var(--admin-bg)', borderRadius: '8px', border: '1px solid var(--admin-border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>
                                Remediation Target
                              </span>
                              <span className={`sla-badge sla-${resolutionSla.state}`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
                                {resolutionSla.state === 'breached' ? 'Breached' : resolutionSla.state === 'approaching' ? 'Near Target' : 'Within Target'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--admin-text-h)' }}>
                                {formatSlaDuration(resolutionSla.elapsedMinutes)}
                              </span>
                              <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-body)' }}>
                                / {formatSlaDuration(resolutionSla.targetMinutes)} target
                              </span>
                            </div>
                            <div style={{ height: '6px', background: '#E2E8F0', borderRadius: '3px', overflow: 'hidden', margin: '0.5rem 0' }}>
                              <div
                                style={{
                                  height: '100%',
                                  width: `${Math.min(100, Math.round((resolutionSla.elapsedMinutes / resolutionSla.targetMinutes) * 100))}%`,
                                  background: resolutionSla.state === 'breached' ? '#DC2626' : resolutionSla.state === 'approaching' ? '#D97706' : '#16A34A',
                                  transition: 'width 0.3s ease',
                                }}
                              />
                            </div>
                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--admin-text-body)' }}>
                              {report.resolved_at
                                ? `Resolved in ${formatSlaDuration(resolutionSla.elapsedMinutes)}`
                                : resolutionSla.state === 'breached'
                                  ? `Breached by ${formatSlaDuration(Math.abs(resolutionSla.remainingMinutes))}`
                                  : `${formatSlaDuration(resolutionSla.remainingMinutes)} remaining until target`}
                            </p>
                          </div>
                        </div>
                      </section>
                    );
                  })()
                )}

                {/* RESOLUTION EVIDENCE (WHEN AVAILABLE) */}
                {(resolutionPhotoSignedUrl || report.resolution_notes || report.resolved_at) && (
                  <section className="admin-card" aria-labelledby="resolution-heading">
                    <h2 id="resolution-heading" style={{ margin: '0 0 1rem 0', fontSize: '1.15rem', color: 'var(--admin-text-h)' }}>
                      Resolution Verification Evidence
                    </h2>

                    <div className="evidence-compare-grid">
                      {incidentPhotoSignedUrl && (
                        <div className="evidence-photo-box">
                          <span className="evidence-photo-label">Before (Reported)</span>
                          <div className="evidence-img-container">
                            <img src={incidentPhotoSignedUrl} alt="Before site" className="evidence-img" />
                          </div>
                        </div>
                      )}

                      {resolutionPhotoSignedUrl && (
                        <div className="evidence-photo-box">
                          <span className="evidence-photo-label" style={{ color: 'var(--admin-resolved)' }}>
                            After (Remediated)
                          </span>
                          <div className="evidence-img-container">
                            <img src={resolutionPhotoSignedUrl} alt="After cleanup site" className="evidence-img" />
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: '1rem', padding: '0.85rem 1rem', background: 'var(--admin-bg)', borderRadius: '8px', border: '1px solid var(--admin-border)' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>
                        Field Resolution Notes
                      </span>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.9rem', color: 'var(--admin-text-h)' }}>
                        {report.resolution_notes || 'Cleanup certified by field operator.'}
                      </p>
                      {report.resolved_at && (
                        <div style={{ marginTop: '0.35rem', fontSize: '0.775rem', color: 'var(--admin-text-body)' }}>
                          Certified at: {new Date(report.resolved_at).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </section>
                )}
              </div>

              {/* RIGHT COLUMN: DISPATCH / ASSIGNMENT ACTION CARD */}
              <aside style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div className="admin-dispatch-card" aria-labelledby="dispatch-action-heading">
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--admin-primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      FIELD DISPATCH CONTROL
                    </span>
                    <h2 id="dispatch-action-heading" style={{ margin: '0.2rem 0 0 0', fontSize: '1.2rem', color: 'var(--admin-text-h)' }}>
                      Worker Assignment
                    </h2>
                  </div>

                  {/* CURRENT ASSIGNMENT BOX */}
                  <div className="dispatch-current-box">
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>
                      Current Assignment
                    </span>
                    <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.95rem', fontWeight: 800, color: 'var(--admin-text-h)' }}>
                      {assignedWorker ? (
                        <span>👤 {assignedWorker.full_name}</span>
                      ) : (
                        <span style={{ color: 'var(--admin-warning)' }}>Unassigned (Awaiting Worker)</span>
                      )}
                    </p>
                    {report.assigned_at && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-body)' }}>
                        Dispatched: {new Date(report.assigned_at).toLocaleDateString()} at {new Date(report.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}

                    {/* ASSIGNED WORKER ACTIVE COLLECTION ROUTES */}
                    {assignedWorker && (
                      <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--admin-border-subtle)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                          <span style={{ fontSize: '0.725rem', fontWeight: 800, color: 'var(--admin-primary)', textTransform: 'uppercase' }}>
                            Worker Collection Routes
                          </span>
                          <Link to="/admin/schedules" style={{ fontSize: '0.725rem', color: 'var(--admin-primary)', fontWeight: 600, textDecoration: 'none' }}>
                            Schedules &rarr;
                          </Link>
                        </div>
                        {workerSchedules.length === 0 ? (
                          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--admin-text-body)' }}>
                            No active collection routes assigned to this worker today.
                          </p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            {workerSchedules.map((s) => (
                              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0.45rem', background: 'var(--admin-bg)', borderRadius: '4px', border: '1px solid var(--admin-border-subtle)', fontSize: '0.75rem' }}>
                                <div>
                                  <strong style={{ color: 'var(--admin-text-h)' }}>{s.title}</strong>
                                  <span style={{ marginLeft: '0.25rem', color: 'var(--admin-text-body)' }}>({s.zone_name})</span>
                                </div>
                                <span style={{ fontSize: '0.675rem', color: 'var(--admin-text-body)' }}>
                                  {s.scheduled_start_time?.slice(0, 5)} - {s.scheduled_end_time?.slice(0, 5)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ASSIGN / REASSIGN FORM */}
                  {report.status === 'Reported' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      {/* AUTO-ASSIGN ACTION */}
                      <div style={{ padding: '0.85rem 1rem', background: 'var(--admin-bg)', borderRadius: '8px', border: '1px solid var(--admin-border)' }}>
                        <div style={{ fontSize: '0.775rem', fontWeight: 800, color: 'var(--admin-primary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                          ⚡ Automated Dispatch
                        </div>
                        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.825rem', color: 'var(--admin-text-body)', lineHeight: 1.4 }}>
                          Automatically match with the nearest on-duty field worker based on incident severity ({report.severity}) and active queue load.
                        </p>
                        <button
                          type="button"
                          className="btn-admin-secondary"
                          onClick={handleAutoAssign}
                          disabled={isAutoAssigning || isAssigning}
                          style={{ width: '100%', borderColor: 'var(--admin-primary)', color: 'var(--admin-primary)', fontWeight: 700 }}
                        >
                          {isAutoAssigning ? '⚡ Evaluating Nearest Worker...' : '⚡ Auto-Assign Field Worker'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--admin-text-body)', fontSize: '0.75rem', fontWeight: 700 }}>
                        <div style={{ flex: 1, height: '1px', background: 'var(--admin-border)' }} />
                        <span>OR DISPATCH MANUALLY</span>
                        <div style={{ flex: 1, height: '1px', background: 'var(--admin-border)' }} />
                      </div>

                      <form onSubmit={handleAssignWorker} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div className="admin-filter-field">
                          <label htmlFor="detail-worker-select" className="admin-filter-label">
                            Select Field Operator *
                          </label>
                          <select
                            id="detail-worker-select"
                            className="admin-filter-select"
                            value={selectedWorkerId}
                            onChange={(e) => setSelectedWorkerId(e.target.value)}
                            required
                            disabled={isAssigning || isAutoAssigning}
                          >
                            <option value="">Select an active worker...</option>
                            {availableWorkers.map((w) => {
                              const dutyText = w.is_active === false ? 'Off-Duty' : 'On-Duty';
                              const taskCount = w.activeTasks ?? 0;
                              const taskText = `${taskCount} active ${taskCount === 1 ? 'task' : 'tasks'}`;
                              const dist = getWorkerDistance(w.current_location, report?.latitude, report?.longitude);
                              const distText = dist ? ` · ~${dist} away` : '';
                              return (
                                <option key={w.id} value={w.id} disabled={w.is_active === false}>
                                  {w.full_name} ({dutyText} · {taskText}{distText})
                                </option>
                              );
                            })}
                          </select>
                        </div>

                        <div className="admin-filter-field">
                          <label htmlFor="detail-worker-notes" className="admin-filter-label">
                            Dispatch Notes (Optional)
                          </label>
                          <textarea
                            id="detail-worker-notes"
                            className="admin-search-input"
                            style={{ height: '70px', padding: '0.65rem 0.85rem' }}
                            placeholder="Instructions for worker..."
                            value={assignNotes}
                            onChange={(e) => setAssignNotes(e.target.value)}
                            disabled={isAssigning || isAutoAssigning}
                          />
                        </div>

                        <button
                          type="submit"
                          className="btn-admin-primary"
                          disabled={!selectedWorkerId || isAssigning || isAutoAssigning}
                        >
                          {isAssigning ? 'Assigning Worker...' : 'Confirm Assignment'}
                        </button>

                        {assignFeedback && (
                          <div
                            style={{
                              padding: '0.65rem 0.85rem',
                              borderRadius: '6px',
                              fontSize: '0.825rem',
                              fontWeight: 600,
                              background: assignFeedback.type === 'success' ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)',
                              color: assignFeedback.type === 'success' ? '#16A34A' : '#DC2626',
                              border: `1px solid ${assignFeedback.type === 'success' ? 'rgba(22, 163, 74, 0.3)' : 'rgba(220, 38, 38, 0.3)'}`,
                            }}
                          >
                            {assignFeedback.message}
                          </div>
                        )}
                      </form>
                    </div>
                  ) : ['Assigned', 'Accepted', 'In Progress'].includes(report.status) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      {!showReassignForm ? (
                        <div>
                          <p style={{ margin: '0 0 0.85rem 0', fontSize: '0.825rem', color: 'var(--admin-text-body)', lineHeight: 1.45 }}>
                            Task is currently assigned to <strong>{assignedWorker?.full_name || 'Field Operator'}</strong> in <em>{report.status}</em> stage. If required due to route delays, shift change, or emergencies, you may reassign this report.
                          </p>
                          <button
                            type="button"
                            className="btn-admin-secondary btn-admin-sm"
                            onClick={() => {
                              setShowReassignForm(true);
                              setReassignFeedback(null);
                            }}
                            style={{ width: '100%' }}
                          >
                            🔄 Reassign to Different Worker
                          </button>
                        </div>
                      ) : (
                        <form onSubmit={handleReassignWorker} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--admin-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--admin-border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.825rem', fontWeight: 800, color: 'var(--admin-text-h)' }}>
                              Reassign Field Operator
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowReassignForm(false)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--admin-text-body)' }}
                              aria-label="Close reassignment form"
                            >
                              &times;
                            </button>
                          </div>

                          <div className="admin-filter-field">
                            <label htmlFor="reassign-worker-select" className="admin-filter-label">
                              Select New Field Worker *
                            </label>
                            <select
                              id="reassign-worker-select"
                              className="admin-filter-select"
                              value={reassignWorkerId}
                              onChange={(e) => setReassignWorkerId(e.target.value)}
                              required
                              disabled={isReassigning}
                            >
                              <option value="">Choose an active worker...</option>
                              {availableWorkers.map((w) => {
                                const isCurrent = w.id === report.assigned_worker_id;
                                const dutyText = w.is_active === false ? 'Off-Duty' : 'On-Duty';
                                const taskCount = w.activeTasks ?? 0;
                                const taskText = `${taskCount} active ${taskCount === 1 ? 'task' : 'tasks'}`;
                                const dist = getWorkerDistance(w.current_location, report?.latitude, report?.longitude);
                                const distText = dist ? ` · ~${dist} away` : '';
                                return (
                                  <option key={w.id} value={w.id} disabled={w.is_active === false || isCurrent}>
                                    {w.full_name} {isCurrent ? '(Current Operator)' : `(${dutyText} · ${taskText}${distText})`}
                                  </option>
                                );
                              })}
                            </select>
                          </div>

                          <div className="admin-filter-field">
                            <label htmlFor="reassign-notes" className="admin-filter-label">
                              Reassignment Reason / Instructions (Optional)
                            </label>
                            <textarea
                              id="reassign-notes"
                              className="admin-search-input"
                              style={{ height: '65px', padding: '0.65rem 0.85rem' }}
                              placeholder="State reason for reassignment..."
                              value={reassignNotes}
                              onChange={(e) => setReassignNotes(e.target.value)}
                              disabled={isReassigning}
                            />
                          </div>

                          {reassignFeedback && (
                            <div
                              style={{
                                padding: '0.65rem 0.85rem',
                                borderRadius: '6px',
                                fontSize: '0.825rem',
                                fontWeight: 600,
                                background: reassignFeedback.type === 'success' ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)',
                                color: reassignFeedback.type === 'success' ? '#16A34A' : '#DC2626',
                                border: `1px solid ${reassignFeedback.type === 'success' ? 'rgba(22, 163, 74, 0.3)' : 'rgba(220, 38, 38, 0.3)'}`,
                              }}
                            >
                              {reassignFeedback.message}
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn-admin-secondary btn-admin-sm"
                              onClick={() => setShowReassignForm(false)}
                              disabled={isReassigning}
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              className="btn-admin-primary btn-admin-sm"
                              disabled={!reassignWorkerId || isReassigning}
                            >
                              {isReassigning ? 'Reassigning...' : 'Confirm Reassignment'}
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  ) : (
                    <div style={{ background: 'var(--admin-bg)', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid var(--admin-border-subtle)' }}>
                      <p style={{ margin: 0, fontSize: '0.825rem', color: 'var(--admin-text-body)', lineHeight: 1.45 }}>
                        Incident lifecycle is finalized (<strong>{report.status}</strong>). Worker dispatch and reassignment are disabled.
                      </p>
                    </div>
                  )}
                </div>

                {/* MUNICIPAL VEHICLE ASSIGNMENT CARD */}
                <div className="admin-dispatch-card" aria-labelledby="vehicle-dispatch-heading">
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--admin-primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      MUNICIPAL FLEET ASSIGNMENT
                    </span>
                    <h2 id="vehicle-dispatch-heading" style={{ margin: '0.2rem 0 0 0', fontSize: '1.2rem', color: 'var(--admin-text-h)' }}>
                      Vehicle Assignment
                    </h2>
                  </div>

                  {vehicleFeedback && (
                    <div
                      className={`admin-alert ${vehicleFeedback.type === 'error' ? 'admin-alert-danger' : 'admin-alert-success'}`}
                      role="alert"
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem' }}
                    >
                      <span>{vehicleFeedback.type === 'error' ? '⚠️' : '✅'}</span>
                      <span>{vehicleFeedback.message}</span>
                    </div>
                  )}

                  {assignedVehicle ? (
                    <div className="dispatch-current-box" style={{ borderColor: '#B7E4C7', background: 'rgba(45, 106, 79, 0.04)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>
                          Assigned Vehicle
                        </span>
                        <VehicleStatusBadge status={assignedVehicle.vehicle?.status || 'Assigned'} size="sm" />
                      </div>

                      <p style={{ margin: '0 0 0.25rem 0', fontSize: '1.05rem', fontWeight: 800, color: 'var(--admin-text-h)' }}>
                        <span aria-hidden="true">{getVehicleTypeIcon(assignedVehicle.vehicle?.vehicle_type)}</span>{' '}
                        {assignedVehicle.vehicle?.vehicle_name || 'Municipal Vehicle'}
                      </p>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8125rem', marginTop: '0.5rem', color: 'var(--admin-text-p)' }}>
                        <div>
                          <span style={{ color: 'var(--admin-text-muted)', display: 'block', fontSize: '0.725rem' }}>Registration</span>
                          <strong style={{ fontFamily: 'monospace' }}>{assignedVehicle.vehicle?.registration_number}</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--admin-text-muted)', display: 'block', fontSize: '0.725rem' }}>Type</span>
                          <strong>{getVehicleTypeLabel(assignedVehicle.vehicle?.vehicle_type)}</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--admin-text-muted)', display: 'block', fontSize: '0.725rem' }}>Payload Capacity</span>
                          <strong>{formatCapacity(assignedVehicle.vehicle?.capacity_kg)}</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--admin-text-muted)', display: 'block', fontSize: '0.725rem' }}>Assigned Crew</span>
                          <strong>{assignedVehicle.worker?.full_name || assignedWorker?.full_name || 'Unassigned'}</strong>
                        </div>
                      </div>

                      {assignedVehicle.assigned_at && (
                        <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--admin-border-subtle)', fontSize: '0.75rem', color: 'var(--admin-text-muted)' }}>
                          Assigned on {new Date(assignedVehicle.assigned_at).toLocaleDateString()} at {new Date(assignedVehicle.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}

                      {/* Action Buttons for Assigned Vehicle */}
                      {report.status !== 'Resolved' && report.status !== 'Cancelled' && (
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                          <button
                            type="button"
                            className="btn-admin-secondary btn-admin-sm"
                            style={{ flex: 1 }}
                            onClick={() => handleOpenVehicleModal('change')}
                            disabled={isReleasingVehicle}
                            id="btn-change-vehicle"
                          >
                            🔄 Change Vehicle
                          </button>
                          <button
                            type="button"
                            className="btn-admin-secondary btn-admin-sm"
                            style={{ flex: 1, borderColor: '#FCA5A5', color: '#DC2626' }}
                            onClick={handleReleaseVehicle}
                            disabled={isReleasingVehicle}
                            id="btn-release-vehicle"
                          >
                            {isReleasingVehicle ? 'Releasing...' : '🔓 Release Vehicle'}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div className="dispatch-current-box" style={{ textAlign: 'center', padding: '1rem 0.75rem' }}>
                        <span style={{ fontSize: '1.75rem', display: 'block', marginBottom: '0.25rem' }}>🚛</span>
                        <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.9rem', fontWeight: 600, color: 'var(--admin-text-h)' }}>
                          No Vehicle Assigned
                        </p>
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)' }}>
                          Assign a municipal collection truck or compactor to assist cleanup.
                        </span>
                      </div>

                      {report.status !== 'Resolved' && report.status !== 'Cancelled' && (
                        <button
                          type="button"
                          className="btn-admin-primary"
                          style={{ width: '100%', justifyContent: 'center' }}
                          onClick={() => handleOpenVehicleModal('assign')}
                          id="btn-assign-vehicle"
                        >
                          ➕ Assign Vehicle
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </aside>
            </div>

            {/* TIMELINE SECTION */}
            <section className="admin-card" aria-labelledby="timeline-heading" style={{ marginTop: '0.5rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <h2 id="timeline-heading" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--admin-text-h)' }}>
                  Incident Audit Timeline
                </h2>
                <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.85rem', color: 'var(--admin-text-body)' }}>
                  Chronological progression of all dispatch, acceptance, transit, and resolution milestones.
                </p>
              </div>

              <ReportTimeline key={refreshKey} reportId={report.id} />
            </section>
          </>
        )}
      </main>

      {/* VEHICLE ASSIGNMENT MODAL */}
      {isVehicleModalOpen && (
        <div className="admin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="vehicle-modal-title">
          <div className="admin-modal-card">
            <div className="admin-modal-header">
              <h2 id="vehicle-modal-title" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--admin-text-h)' }}>
                {vehicleModalMode === 'change' ? '🔄 Change Assigned Vehicle' : '➕ Assign Municipal Vehicle'}
              </h2>
              <button
                type="button"
                className="alert-close-btn"
                onClick={() => setIsVehicleModalOpen(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <p style={{ margin: '0.5rem 0 1rem 0', fontSize: '0.875rem', color: 'var(--admin-text-body)' }}>
              Select an available municipal vehicle from the fleet to dispatch for report #{report.id.slice(0, 8)}.
            </p>

            <form onSubmit={handleAssignVehicleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="admin-filter-field">
                <label htmlFor="vehicle-select" className="admin-filter-label">
                  Select Available Vehicle *
                </label>
                <select
                  id="vehicle-select"
                  className="admin-filter-select"
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  required
                  disabled={isAssigningVehicle}
                >
                  <option value="">Choose an available vehicle ({availableVehicles.length} available)...</option>
                  {availableVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {getVehicleTypeIcon(v.vehicle_type)} {v.registration_number} — {v.vehicle_name} ({getVehicleTypeLabel(v.vehicle_type)}, {formatCapacity(v.capacity_kg)})
                    </option>
                  ))}
                </select>
                {availableVehicles.length === 0 && (
                  <span style={{ fontSize: '0.75rem', color: '#DC2626', marginTop: '0.25rem' }}>
                    No active vehicles are currently in 'Available' status.{' '}
                    <Link to="/admin/fleet" style={{ color: 'var(--admin-primary)', fontWeight: 600 }}>
                      Manage fleet &rarr;
                    </Link>
                  </span>
                )}
              </div>

              <div className="admin-filter-field">
                <label htmlFor="vehicle-notes" className="admin-filter-label">
                  Assignment Notes / Mission Instructions (Optional)
                </label>
                <textarea
                  id="vehicle-notes"
                  className="admin-search-input"
                  style={{ height: '65px', padding: '0.65rem 0.85rem' }}
                  placeholder="e.g. Bring compactor to handle high debris load..."
                  value={vehicleNotes}
                  onChange={(e) => setVehicleNotes(e.target.value)}
                  disabled={isAssigningVehicle}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-admin-secondary"
                  onClick={() => setIsVehicleModalOpen(false)}
                  disabled={isAssigningVehicle}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-admin-primary"
                  disabled={!selectedVehicleId || isAssigningVehicle}
                  id="btn-confirm-assign-vehicle"
                >
                  {isAssigningVehicle ? 'Assigning...' : vehicleModalMode === 'change' ? 'Confirm Change' : 'Assign Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
