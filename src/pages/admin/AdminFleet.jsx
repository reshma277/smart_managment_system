import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import VehicleStatusBadge from '../../components/admin/VehicleStatusBadge';
import { supabase } from '../../lib/supabase';
import {
  VEHICLE_TYPES,
  VEHICLE_STATUSES,
  getVehicleTypeLabel,
  getVehicleTypeIcon,
  formatCapacity,
} from '../../utils/fleet';
import '../../styles/admin.css';

export default function AdminFleet() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  // Search and Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');

  // Feedback Notification Banner
  const [actionFeedback, setActionFeedback] = useState(null);

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  // Add/Edit Form State
  const [formData, setFormData] = useState({
    registration_number: '',
    vehicle_name: '',
    vehicle_type: 'garbage truck',
    capacity_kg: '2500',
    status: 'Available',
    is_active: true,
  });

  // Release Assignment Confirmation State
  const [releaseModalData, setReleaseModalData] = useState(null);
  const [isReleasing, setIsReleasing] = useState(false);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  }, []);

  // Fetch Fleet Data
  useEffect(() => {
    let isMounted = true;

    async function loadFleetData() {
      try {
        // Query vehicles with their active assignment details
        const { data: vehiclesData, error: vehiclesErr } = await supabase
          .from('vehicles')
          .select(`
            id,
            registration_number,
            vehicle_name,
            vehicle_type,
            capacity_kg,
            status,
            is_active,
            current_location,
            last_location_updated_at,
            created_at,
            updated_at
          `)
          .order('registration_number', { ascending: true });

        if (vehiclesErr) {
          console.error('Error fetching vehicles:', vehiclesErr);
          if (isMounted) setError('Unable to load municipal fleet data.');
          return;
        }

        // Query active assignments with related report and schedule info
        const { data: assignmentsData, error: assignmentsErr } = await supabase
          .from('vehicle_assignments')
          .select(`
            id,
            vehicle_id,
            worker_id,
            report_id,
            schedule_id,
            assigned_at,
            status,
            notes,
            worker:profiles!vehicle_assignments_worker_id_fkey(id, full_name),
            report:reports!vehicle_assignments_report_id_fkey(id, title, status, address),
            schedule:collection_schedules!vehicle_assignments_schedule_id_fkey(id, title, zone_name, status)
          `)
          .is('released_at', null);

        if (assignmentsErr) {
          console.error('Error fetching vehicle assignments:', assignmentsErr);
        }

        if (isMounted) {
          const activeAssignmentsByVehicle = {};
          (assignmentsData || []).forEach((asgn) => {
            activeAssignmentsByVehicle[asgn.vehicle_id] = asgn;
          });

          const enriched = (vehiclesData || []).map((v) => ({
            ...v,
            activeAssignment: activeAssignmentsByVehicle[v.id] || null,
          }));

          setVehicles(enriched);
          setLastRefreshed(new Date());
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        console.error('Fleet loading exception:', err);
        if (isMounted) {
          setError('Failed to communicate with fleet management service.');
          setLoading(false);
        }
      }
    }

    loadFleetData();

    // Supabase Realtime: subscribe to vehicles and assignments changes
    const vehiclesChannel = supabase
      .channel('admin-fleet-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => {
        loadFleetData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_assignments' }, () => {
        loadFleetData();
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(vehiclesChannel);
    };
  }, [refreshKey]);

  // KPI Metrics (Calculated dynamically from real database values)
  const metrics = useMemo(() => {
    const total = vehicles.length;
    const available = vehicles.filter((v) => v.is_active && v.status === 'Available').length;
    const assigned = vehicles.filter((v) => v.status === 'Assigned').length;
    const maintenance = vehicles.filter((v) => v.status === 'Maintenance').length;
    const offline = vehicles.filter((v) => v.status === 'Offline' || !v.is_active).length;
    return { total, available, assigned, maintenance, offline };
  }, [vehicles]);

  // Filtered vehicles
  const filteredVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      // Search term
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const matchesReg = v.registration_number?.toLowerCase().includes(query);
        const matchesName = v.vehicle_name?.toLowerCase().includes(query);
        if (!matchesReg && !matchesName) return false;
      }

      // Status filter
      if (statusFilter !== 'All' && v.status !== statusFilter) {
        return false;
      }

      // Type filter
      if (typeFilter !== 'All' && v.vehicle_type !== typeFilter) {
        return false;
      }

      return true;
    });
  }, [vehicles, searchTerm, statusFilter, typeFilter]);

  // Open Add Modal
  const handleOpenAddModal = () => {
    setFormData({
      registration_number: '',
      vehicle_name: '',
      vehicle_type: 'garbage truck',
      capacity_kg: '2500',
      status: 'Available',
      is_active: true,
    });
    setFormError(null);
    setIsAddModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (vehicle) => {
    setEditingVehicle(vehicle);
    setFormData({
      registration_number: vehicle.registration_number,
      vehicle_name: vehicle.vehicle_name,
      vehicle_type: vehicle.vehicle_type,
      capacity_kg: String(vehicle.capacity_kg),
      status: vehicle.status,
      is_active: vehicle.is_active,
    });
    setFormError(null);
    setIsEditModalOpen(true);
  };

  // Submit Add Vehicle
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    const reg = formData.registration_number.trim().toUpperCase();
    const name = formData.vehicle_name.trim();
    const capacity = parseFloat(formData.capacity_kg);

    if (!reg) {
      setFormError('Registration number is required.');
      return;
    }

    if (!name) {
      setFormError('Vehicle name or label is required.');
      return;
    }

    if (isNaN(capacity) || capacity < 0) {
      setFormError('Capacity must be a positive number or zero.');
      return;
    }

    setFormSubmitting(true);

    try {
      // Check duplicate registration
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('registration_number', reg)
        .maybeSingle();

      if (existing) {
        setFormError(`A vehicle with registration "${reg}" already exists.`);
        setFormSubmitting(false);
        return;
      }

      const { error: insertErr } = await supabase.from('vehicles').insert([
        {
          registration_number: reg,
          vehicle_name: name,
          vehicle_type: formData.vehicle_type,
          capacity_kg: capacity,
          status: formData.status,
          is_active: formData.is_active,
        },
      ]);

      if (insertErr) {
        console.error('Insert vehicle error:', insertErr);
        setFormError(insertErr.message || 'Failed to register vehicle.');
      } else {
        setIsAddModalOpen(false);
        setActionFeedback({
          type: 'success',
          message: `Vehicle ${reg} registered successfully in the municipal fleet.`,
        });
        setRefreshKey((k) => k + 1);
        setTimeout(() => setActionFeedback(null), 5000);
      }
    } catch (err) {
      console.error('Add vehicle exception:', err);
      setFormError('Network error while saving vehicle.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Submit Edit Vehicle
  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingVehicle) return;

    setFormError(null);
    const name = formData.vehicle_name.trim();
    const capacity = parseFloat(formData.capacity_kg);

    if (!name) {
      setFormError('Vehicle name or label is required.');
      return;
    }

    if (isNaN(capacity) || capacity < 0) {
      setFormError('Capacity must be a non-negative number.');
      return;
    }

    setFormSubmitting(true);

    try {
      // Use secure RPC to prevent orphaning active assignments
      const { data, error: rpcErr } = await supabase.rpc('update_vehicle_safe', {
        p_vehicle_id: editingVehicle.id,
        p_vehicle_name: name,
        p_vehicle_type: formData.vehicle_type,
        p_capacity_kg: capacity,
        p_status: formData.status,
        p_is_active: formData.is_active,
      });

      if (rpcErr) {
        console.error('update_vehicle_safe error:', rpcErr);
        setFormError(rpcErr.message || 'Could not update vehicle.');
      } else if (data && !data.success) {
        setFormError(data.message || 'Vehicle update rejected by municipal safety rules.');
      } else {
        setIsEditModalOpen(false);
        setEditingVehicle(null);
        setActionFeedback({
          type: 'success',
          message: `Vehicle ${editingVehicle.registration_number} updated successfully.`,
        });
        setRefreshKey((k) => k + 1);
        setTimeout(() => setActionFeedback(null), 5000);
      }
    } catch (err) {
      console.error('Edit vehicle exception:', err);
      setFormError('Network error while updating vehicle.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Release Vehicle Assignment
  const handleConfirmRelease = async () => {
    if (!releaseModalData) return;
    setIsReleasing(true);

    try {
      const { data, error: rpcErr } = await supabase.rpc('release_vehicle_assignment', {
        p_assignment_id: releaseModalData.assignmentId,
        p_notes: 'Released manually via Admin Fleet Console',
      });

      if (rpcErr) {
        console.error('release_vehicle_assignment error:', rpcErr);
        setActionFeedback({
          type: 'error',
          message: rpcErr.message || 'Failed to release vehicle assignment.',
        });
      } else if (data && !data.success) {
        setActionFeedback({
          type: 'error',
          message: data.message || 'Assignment release failed.',
        });
      } else {
        setActionFeedback({
          type: 'success',
          message: `Vehicle ${releaseModalData.registrationNumber} released back to Available pool.`,
        });
        setReleaseModalData(null);
        setRefreshKey((k) => k + 1);
        setTimeout(() => setActionFeedback(null), 5000);
      }
    } catch (err) {
      console.error('Release assignment exception:', err);
      setActionFeedback({
        type: 'error',
        message: 'Network error releasing vehicle.',
      });
    } finally {
      setIsReleasing(false);
    }
  };

  return (
    <div className="admin-layout">
      <UserNavbar />

      <main className="admin-main" role="main">
        {/* HEADER SECTION */}
        <header className="admin-page-header">
          <div className="admin-header-content">
            <div className="admin-eyebrow-row">
              <span className="admin-eyebrow">MUNICIPAL FLEET</span>
              <span className="admin-role-badge">
                <span aria-hidden="true">🚛</span> Vehicle Operations
              </span>
            </div>
            <h1 className="admin-title">Municipal Fleet Management</h1>
            <p className="admin-subtitle">
              Register vehicles, monitor operational availability, manage dispatch readiness, and track municipal fleet capacity.
            </p>
          </div>

          <div className="admin-header-actions">
            <button
              type="button"
              className="btn-admin-primary"
              onClick={handleOpenAddModal}
              id="btn-add-vehicle"
            >
              ➕ Register Vehicle
            </button>
            <Link to="/admin/map" className="btn-admin-secondary">
              🗺️ Dispatch Map
            </Link>
            <button
              type="button"
              className="btn-admin-secondary btn-admin-sm"
              onClick={handleRetry}
              disabled={loading}
              title={`Last synchronized: ${lastRefreshed.toLocaleTimeString()}`}
            >
              {loading ? 'Refreshing...' : '🔄 Refresh'}
            </button>
          </div>
        </header>

        {/* FEEDBACK BANNER */}
        {actionFeedback && (
          <div
            className={`admin-alert ${actionFeedback.type === 'error' ? 'admin-alert-danger' : 'admin-alert-success'}`}
            role="alert"
            style={{ marginBottom: '1.5rem' }}
          >
            <span>{actionFeedback.type === 'error' ? '⚠️' : '✅'}</span>
            <span>{actionFeedback.message}</span>
            <button
              type="button"
              className="alert-close-btn"
              onClick={() => setActionFeedback(null)}
              aria-label="Dismiss message"
            >
              ✕
            </button>
          </div>
        )}

        {/* KPI METRIC CARDS */}
        <section className="admin-kpi-grid" aria-label="Fleet Key Performance Indicators">
          <div className="kpi-card">
            <div className="kpi-icon-tile" style={{ backgroundColor: 'rgba(45, 106, 79, 0.1)', color: '#2D6A4F' }}>
              🚛
            </div>
            <div className="kpi-details">
              <span className="kpi-value">{loading ? '—' : metrics.total}</span>
              <span className="kpi-label">Total Vehicles</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon-tile" style={{ backgroundColor: 'rgba(45, 106, 79, 0.1)', color: '#2D6A4F' }}>
              🟢
            </div>
            <div className="kpi-details">
              <span className="kpi-value" style={{ color: '#2D6A4F' }}>{loading ? '—' : metrics.available}</span>
              <span className="kpi-label">Available for Dispatch</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon-tile" style={{ backgroundColor: 'rgba(29, 78, 216, 0.1)', color: '#1D4ED8' }}>
              🔵
            </div>
            <div className="kpi-details">
              <span className="kpi-value" style={{ color: '#1D4ED8' }}>{loading ? '—' : metrics.assigned}</span>
              <span className="kpi-label">Assigned to Tasks</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon-tile" style={{ backgroundColor: 'rgba(194, 65, 12, 0.1)', color: '#C2410C' }}>
              🟠
            </div>
            <div className="kpi-details">
              <span className="kpi-value" style={{ color: '#C2410C' }}>{loading ? '—' : metrics.maintenance}</span>
              <span className="kpi-label">In Maintenance</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon-tile" style={{ backgroundColor: 'rgba(107, 114, 128, 0.1)', color: '#6B7280' }}>
              ⚪
            </div>
            <div className="kpi-details">
              <span className="kpi-value" style={{ color: '#6B7280' }}>{loading ? '—' : metrics.offline}</span>
              <span className="kpi-label">Offline / Inactive</span>
            </div>
          </div>
        </section>

        {/* CONTROLS & FILTER BAR */}
        <section className="admin-controls-card" aria-label="Fleet Search and Filters">
          <div className="admin-search-wrapper">
            <span className="search-icon" aria-hidden="true">🔍</span>
            <input
              type="text"
              className="admin-search-input"
              placeholder="Search by registration (e.g. AP-31-TV-1001) or vehicle name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              id="fleet-search-input"
            />
            {searchTerm && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchTerm('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="admin-filter-group">
            <label htmlFor="fleet-status-filter" className="filter-label">Status:</label>
            <select
              id="fleet-status-filter"
              className="admin-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="All">All Statuses ({vehicles.length})</option>
              {VEHICLE_STATUSES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>

          <div className="admin-filter-group">
            <label htmlFor="fleet-type-filter" className="filter-label">Type:</label>
            <select
              id="fleet-type-filter"
              className="admin-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="All">All Vehicle Types</option>
              {VEHICLE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
              ))}
            </select>
          </div>
        </section>

        {/* MAIN FLEET CONTENT */}
        {loading ? (
          <div className="admin-state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '36px', height: '36px' }} />
            <p className="admin-state-title">Loading Municipal Vehicles...</p>
            <p className="admin-state-sub">Syncing operational fleet status and assignments.</p>
          </div>
        ) : error ? (
          <div className="admin-state-box" role="alert">
            <span style={{ fontSize: '2.5rem' }}>⚠️</span>
            <p className="admin-state-title">Unable to Load Fleet Data</p>
            <p className="admin-state-sub">{error}</p>
            <button type="button" className="btn-admin-primary" onClick={handleRetry}>
              Retry Connection
            </button>
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className="admin-state-box">
            <span style={{ fontSize: '2.5rem' }}>🚛</span>
            <p className="admin-state-title">No Vehicles Found</p>
            <p className="admin-state-sub">
              {searchTerm || statusFilter !== 'All' || typeFilter !== 'All'
                ? 'No municipal vehicles match the current filter criteria.'
                : 'No vehicles have been registered in the municipal fleet database yet.'}
            </p>
            <button type="button" className="btn-admin-primary" onClick={handleOpenAddModal}>
              ➕ Register First Vehicle
            </button>
          </div>
        ) : (
          <section className="admin-card" aria-label="Municipal Fleet Roster">
            <div className="admin-table-header-row">
              <h2 style={{ fontSize: '1.15rem', margin: 0, color: 'var(--admin-text-h)' }}>
                Registered Fleet ({filteredVehicles.length})
              </h2>
            </div>

            {/* DESKTOP TABLE */}
            <div className="admin-table-container">
              <table className="admin-table" id="fleet-table">
                <thead>
                  <tr>
                    <th scope="col">Registration</th>
                    <th scope="col">Vehicle Name</th>
                    <th scope="col">Type</th>
                    <th scope="col">Capacity</th>
                    <th scope="col">Status</th>
                    <th scope="col">Current Assignment</th>
                    <th scope="col">GPS Status</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVehicles.map((vehicle) => {
                    const asgn = vehicle.activeAssignment;
                    const hasLocation = Boolean(vehicle.current_location);
                    const lastUpdatedStr = vehicle.last_location_updated_at
                      ? new Date(vehicle.last_location_updated_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Not recorded';

                    return (
                      <tr key={vehicle.id} className={!vehicle.is_active ? 'row-inactive' : ''}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--admin-text-h)' }}>
                              {vehicle.registration_number}
                            </span>
                            {!vehicle.is_active && (
                              <span style={{ fontSize: '0.7rem', color: '#DC2626', fontWeight: 600 }}>
                                🚫 Inactive
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600, color: 'var(--admin-text-h)' }}>
                            {vehicle.vehicle_name}
                          </span>
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span aria-hidden="true">{getVehicleTypeIcon(vehicle.vehicle_type)}</span>
                            <span>{getVehicleTypeLabel(vehicle.vehicle_type)}</span>
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 500, color: 'var(--admin-text-p)' }}>
                            {formatCapacity(vehicle.capacity_kg)}
                          </span>
                        </td>
                        <td>
                          <VehicleStatusBadge status={vehicle.status} />
                        </td>
                        <td>
                          {asgn ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.8125rem' }}>
                              {asgn.report && (
                                <Link
                                  to={`/admin/reports/${asgn.report.id}`}
                                  style={{ color: 'var(--admin-primary)', fontWeight: 600, textDecoration: 'none' }}
                                  title={`Report: ${asgn.report.title}`}
                                >
                                  📍 Report: {asgn.report.title.slice(0, 24)}...
                                </Link>
                              )}
                              {asgn.schedule && (
                                <Link
                                  to="/admin/schedules"
                                  style={{ color: '#2563EB', fontWeight: 600, textDecoration: 'none' }}
                                  title={`Schedule: ${asgn.schedule.title}`}
                                >
                                  📅 Schedule: {asgn.schedule.title}
                                </Link>
                              )}
                              {asgn.worker && (
                                <span style={{ color: 'var(--admin-text-muted)', fontSize: '0.75rem' }}>
                                  👤 Crew: {asgn.worker.full_name}
                                </span>
                              )}
                              <button
                                type="button"
                                className="btn-link-action"
                                style={{
                                  alignSelf: 'flex-start',
                                  fontSize: '0.75rem',
                                  color: '#DC2626',
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                }}
                                onClick={() =>
                                  setReleaseModalData({
                                    assignmentId: asgn.id,
                                    vehicleId: vehicle.id,
                                    registrationNumber: vehicle.registration_number,
                                    vehicleName: vehicle.vehicle_name,
                                  })
                                }
                              >
                                Release vehicle ↗
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--admin-text-muted)', fontSize: '0.8125rem' }}>
                              — No active assignment
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.75rem' }}>
                            <span style={{ color: hasLocation ? '#16A34A' : 'var(--admin-text-muted)', fontWeight: 600 }}>
                              {hasLocation ? '🛰️ Synced' : '⚪ No GPS Signal'}
                            </span>
                            <span style={{ color: 'var(--admin-text-muted)' }}>{lastUpdatedStr}</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn-admin-secondary btn-admin-sm"
                              onClick={() => handleOpenEditModal(vehicle)}
                              id={`btn-edit-vehicle-${vehicle.id}`}
                            >
                              ✏️ Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {/* REGISTER / ADD VEHICLE MODAL */}
      {isAddModalOpen && (
        <div className="admin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-vehicle-title">
          <div className="admin-modal-card">
            <div className="admin-modal-header">
              <h2 id="add-vehicle-title" style={{ margin: 0, fontSize: '1.25rem', color: 'var(--admin-text-h)' }}>
                ➕ Register New Municipal Vehicle
              </h2>
              <button
                type="button"
                className="alert-close-btn"
                onClick={() => setIsAddModalOpen(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="admin-alert admin-alert-danger" role="alert" style={{ margin: '1rem 0' }}>
                <span>⚠️ {formError}</span>
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="admin-form" style={{ marginTop: '1rem' }}>
              <div className="admin-form-group">
                <label htmlFor="add-reg-num" className="admin-label">
                  Registration Number <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  type="text"
                  id="add-reg-num"
                  className="admin-input"
                  placeholder="e.g. AP-31-TV-1001"
                  required
                  value={formData.registration_number}
                  onChange={(e) => setFormData({ ...formData, registration_number: e.target.value })}
                />
                <span className="admin-help-text">Standard municipal registration or fleet plate ID.</span>
              </div>

              <div className="admin-form-group">
                <label htmlFor="add-vehicle-name" className="admin-label">
                  Vehicle Name / Identifier <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  type="text"
                  id="add-vehicle-name"
                  className="admin-input"
                  placeholder="e.g. Ward 4 Compactor #1"
                  required
                  value={formData.vehicle_name}
                  onChange={(e) => setFormData({ ...formData, vehicle_name: e.target.value })}
                />
              </div>

              <div className="admin-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="admin-form-group">
                  <label htmlFor="add-vehicle-type" className="admin-label">
                    Vehicle Type <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <select
                    id="add-vehicle-type"
                    className="admin-select"
                    value={formData.vehicle_type}
                    onChange={(e) => setFormData({ ...formData, vehicle_type: e.target.value })}
                  >
                    {VEHICLE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.icon} {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="admin-form-group">
                  <label htmlFor="add-capacity" className="admin-label">
                    Payload Capacity (kg) <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <input
                    type="number"
                    id="add-capacity"
                    className="admin-input"
                    min="0"
                    step="50"
                    required
                    value={formData.capacity_kg}
                    onChange={(e) => setFormData({ ...formData, capacity_kg: e.target.value })}
                  />
                </div>
              </div>

              <div className="admin-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="admin-form-group">
                  <label htmlFor="add-status" className="admin-label">
                    Initial Status
                  </label>
                  <select
                    id="add-status"
                    className="admin-select"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    {VEHICLE_STATUSES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>

                <div className="admin-form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <label className="admin-checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '1.2rem' }}>
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    />
                    <span style={{ fontWeight: 600, color: 'var(--admin-text-h)' }}>Active in Municipal Fleet</span>
                  </label>
                </div>
              </div>

              <div className="admin-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                <button
                  type="button"
                  className="btn-admin-secondary"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={formSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-admin-primary"
                  disabled={formSubmitting}
                  id="btn-submit-add-vehicle"
                >
                  {formSubmitting ? 'Registering...' : 'Register Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT VEHICLE MODAL */}
      {isEditModalOpen && editingVehicle && (
        <div className="admin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-vehicle-title">
          <div className="admin-modal-card">
            <div className="admin-modal-header">
              <h2 id="edit-vehicle-title" style={{ margin: 0, fontSize: '1.25rem', color: 'var(--admin-text-h)' }}>
                ✏️ Edit Vehicle: {editingVehicle.registration_number}
              </h2>
              <button
                type="button"
                className="alert-close-btn"
                onClick={() => setIsEditModalOpen(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="admin-alert admin-alert-danger" role="alert" style={{ margin: '1rem 0' }}>
                <span>⚠️ {formError}</span>
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="admin-form" style={{ marginTop: '1rem' }}>
              <div className="admin-form-group">
                <label className="admin-label">Registration Number</label>
                <input
                  type="text"
                  className="admin-input"
                  value={editingVehicle.registration_number}
                  disabled
                  style={{ backgroundColor: '#F3F4F6', cursor: 'not-allowed' }}
                />
                <span className="admin-help-text">Registration plate identifier cannot be modified.</span>
              </div>

              <div className="admin-form-group">
                <label htmlFor="edit-vehicle-name" className="admin-label">
                  Vehicle Name / Identifier <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  type="text"
                  id="edit-vehicle-name"
                  className="admin-input"
                  required
                  value={formData.vehicle_name}
                  onChange={(e) => setFormData({ ...formData, vehicle_name: e.target.value })}
                />
              </div>

              <div className="admin-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="admin-form-group">
                  <label htmlFor="edit-vehicle-type" className="admin-label">
                    Vehicle Type <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <select
                    id="edit-vehicle-type"
                    className="admin-select"
                    value={formData.vehicle_type}
                    onChange={(e) => setFormData({ ...formData, vehicle_type: e.target.value })}
                  >
                    {VEHICLE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.icon} {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="admin-form-group">
                  <label htmlFor="edit-capacity" className="admin-label">
                    Payload Capacity (kg) <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <input
                    type="number"
                    id="edit-capacity"
                    className="admin-input"
                    min="0"
                    step="50"
                    required
                    value={formData.capacity_kg}
                    onChange={(e) => setFormData({ ...formData, capacity_kg: e.target.value })}
                  />
                </div>
              </div>

              <div className="admin-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="admin-form-group">
                  <label htmlFor="edit-status" className="admin-label">
                    Operational Status
                  </label>
                  <select
                    id="edit-status"
                    className="admin-select"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    {VEHICLE_STATUSES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>

                <div className="admin-form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <label className="admin-checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '1.2rem' }}>
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    />
                    <span style={{ fontWeight: 600, color: 'var(--admin-text-h)' }}>Active in Municipal Fleet</span>
                  </label>
                </div>
              </div>

              {editingVehicle.activeAssignment && (
                <div
                  style={{
                    backgroundColor: 'rgba(217, 119, 6, 0.1)',
                    border: '1px solid #FCD34D',
                    borderRadius: '8px',
                    padding: '0.75rem 1rem',
                    fontSize: '0.8125rem',
                    color: '#92400E',
                    marginTop: '0.5rem',
                  }}
                >
                  ⚠️ <strong>Active Assignment Notice:</strong> This vehicle is currently assigned to an operational task.
                  Setting it to Maintenance, Offline, or Inactive requires releasing the assignment first.
                </div>
              )}

              <div className="admin-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                <button
                  type="button"
                  className="btn-admin-secondary"
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={formSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-admin-primary"
                  disabled={formSubmitting}
                  id="btn-submit-edit-vehicle"
                >
                  {formSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM RELEASE ASSIGNMENT MODAL */}
      {releaseModalData && (
        <div className="admin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="release-modal-title">
          <div className="admin-modal-card">
            <div className="admin-modal-header">
              <h2 id="release-modal-title" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--admin-text-h)' }}>
                Release Vehicle Assignment
              </h2>
              <button
                type="button"
                className="alert-close-btn"
                onClick={() => setReleaseModalData(null)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <p style={{ margin: '1rem 0', color: 'var(--admin-text-p)', fontSize: '0.9375rem' }}>
              Are you sure you want to release vehicle <strong>{releaseModalData.registrationNumber}</strong> (
              {releaseModalData.vehicleName}) from its current operational task?
            </p>
            <p style={{ margin: '0 0 1.5rem 0', color: 'var(--admin-text-muted)', fontSize: '0.8125rem' }}>
              The vehicle status will return to <strong>Available</strong> for immediate re-dispatch.
            </p>

            <div className="admin-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button
                type="button"
                className="btn-admin-secondary"
                onClick={() => setReleaseModalData(null)}
                disabled={isReleasing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-admin-primary"
                style={{ backgroundColor: '#DC2626' }}
                onClick={handleConfirmRelease}
                disabled={isReleasing}
              >
                {isReleasing ? 'Releasing...' : 'Confirm Release'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
