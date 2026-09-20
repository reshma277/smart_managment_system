import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/citizen.css';
import '../../styles/citizen-tracking.css';

const GARBAGE_TYPE_CONFIG = {
  general: { label: 'General Waste', icon: '🗑️' },
  household: { label: 'Household Waste', icon: '🏠' },
  commercial: { label: 'Commercial Waste', icon: '🏢' },
  construction: { label: 'Construction / Debris', icon: '🧱' },
  organic: { label: 'Organic / Food Waste', icon: '🍎' },
  plastic: { label: 'Plastic / Recyclable', icon: '♻️' },
  paper: { label: 'Paper / Cardboard', icon: '📦' },
  metal: { label: 'Metal / Scrap', icon: '🥫' },
  electronic: { label: 'Electronic (E-waste)', icon: '💻' },
  hazardous: { label: 'Hazardous / Biohazard', icon: '☣️' },
  bulk: { label: 'Bulk / Large Items', icon: '🛋️' },
  other: { label: 'Other / Mixed', icon: '🗑️' },
};

export default function CitizenDashboard() {
  const navigate = useNavigate();
  const { profile, user } = useAuth();

  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    resolved: 0,
    notifications: 0,
    unreadNotifications: 0,
  });

  const [recentReports, setRecentReports] = useState([]);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Citizen';
  const displayEmail = profile?.email || user?.email || '';

  useEffect(() => {
    const citizenId = user?.id;
    if (!citizenId) return;

    let isMounted = true;

    async function loadDashboardData() {
      try {
        const [
          totalRes,
          activeRes,
          resolvedRes,
          notifsTotalRes,
          notifsUnreadRes,
          reportsRes,
          notifsRes,
        ] = await Promise.all([
          supabase
            .from('reports')
            .select('*', { count: 'exact', head: true })
            .eq('citizen_id', citizenId),
          supabase
            .from('reports')
            .select('*', { count: 'exact', head: true })
            .eq('citizen_id', citizenId)
            .in('status', ['Reported', 'Assigned', 'Accepted', 'In Progress']),
          supabase
            .from('reports')
            .select('*', { count: 'exact', head: true })
            .eq('citizen_id', citizenId)
            .eq('status', 'Resolved'),
          supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', citizenId),
          supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', citizenId)
            .eq('is_read', false),
          supabase
            .from('reports')
            .select('id, title, status, garbage_type, severity, address, created_at')
            .eq('citizen_id', citizenId)
            .order('created_at', { ascending: false })
            .limit(5),
          supabase
            .from('notifications')
            .select('id, title, message, type, is_read, report_id, created_at')
            .eq('user_id', citizenId)
            .order('created_at', { ascending: false })
            .limit(5),
        ]);

        if (reportsRes.error || notifsRes.error || totalRes.error) {
          console.error('Error fetching dashboard data:', reportsRes.error || notifsRes.error || totalRes.error);
          if (isMounted) {
            setError('Unable to load citizen dashboard data. Please try again.');
            setLoading(false);
          }
          return;
        }

        if (isMounted) {
          setStats({
            total: totalRes.count || 0,
            active: activeRes.count || 0,
            resolved: resolvedRes.count || 0,
            notifications: notifsTotalRes.count || 0,
            unreadNotifications: notifsUnreadRes.count || 0,
          });

          setRecentReports(reportsRes.data || []);
          setRecentNotifications(notifsRes.data || []);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        console.error('Exception loading citizen dashboard:', err);
        if (isMounted) {
          setError('Network error while retrieving dashboard information. Please try again.');
          setLoading(false);
        }
      }
    }

    loadDashboardData();

    // Subscribe to changes on reports table for this citizen
    const reportsChannel = supabase
      .channel(`citizen-dash-reports-${citizenId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reports',
          filter: `citizen_id=eq.${citizenId}`,
        },
        () => {
          loadDashboardData();
        }
      )
      .subscribe();

    // Subscribe to changes on notifications table for this citizen
    const notifsChannel = supabase
      .channel(`citizen-dash-notifs-${citizenId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${citizenId}`,
        },
        () => {
          loadDashboardData();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(reportsChannel);
      supabase.removeChannel(notifsChannel);
    };
  }, [user?.id, refreshKey]);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  const handleReportGarbageClick = () => {
    navigate('/citizen/report');
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.is_read) {
      try {
        await supabase.rpc('mark_notification_read', {
          p_notification_id: notif.id,
        });
        setRecentNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
        );
        setStats((prev) => ({
          ...prev,
          unreadNotifications: Math.max(0, prev.unreadNotifications - 1),
        }));
      } catch {
        // Ignored
      }
    }

    if (notif.report_id) {
      navigate(`/citizen/reports/${notif.report_id}`);
    } else {
      navigate('/citizen/notifications');
    }
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatNotificationTime = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="citizen-layout">
      {/* Universal authenticated navigation bar */}
      <UserNavbar />

      <main className="citizen-main-content" role="main">
        {/* 1. Large Premium Green Hero (Base44 Visual Blueprint) */}
        <header className="citizen-hero-card" aria-label="Citizen Portal Hero Banner">
          <div className="hero-mesh-overlay" aria-hidden="true" />
          <div className="hero-content">
            {/* Top Eyebrow Row */}
            <div className="hero-top-bar">
              <button
                type="button"
                className="hero-eyebrow-pill"
                onClick={handleReportGarbageClick}
                aria-label="Report missed garbage pickup now"
              >
                <span className="eyebrow-sparkle" aria-hidden="true">✨</span>
                <span>Missed garbage pickup? Report it now.</span>
              </button>

              <div className="hero-user-context" title={displayEmail || displayName}>
                <span className="user-context-dot" aria-hidden="true" />
                <span>Citizen: {displayName}</span>
              </div>
            </div>

            {/* Main Headline & Supporting Copy */}
            <div className="hero-body">
              <h1 className="hero-headline">
                Report. Track.<br />
                Get it cleaned.
              </h1>
              <p className="hero-description">
                Capture your live location, snap a photo, and your report is instantly auto-assigned to the nearest municipal worker for pickup.
              </p>
            </div>

            {/* Bottom Row: Feature Pills & White Report CTA */}
            <div className="hero-bottom-row">
              <div className="hero-feature-pills">
                <span className="feature-pill">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                  </svg>
                  <span>GPS Location</span>
                </span>
                <span className="feature-pill">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <span>Auto-Assigned</span>
                </span>
                <span className="feature-pill">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                  <span>Real-time Status</span>
                </span>
              </div>

              <button
                type="button"
                className="hero-report-btn"
                onClick={handleReportGarbageClick}
                aria-label="Report Garbage Incident"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span>Report Garbage</span>
              </button>
            </div>
          </div>
        </header>

        {/* 2. Loading / Error State Handling */}
        {loading ? (
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '40px', height: '40px' }} />
            <h2 className="state-title">Loading Citizen Dashboard...</h2>
            <p className="state-desc">Retrieving your reports summary and municipal notifications.</p>
          </div>
        ) : error ? (
          <div className="state-box state-box-error" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <h2 className="state-title">Unable to Load Dashboard</h2>
            <p className="state-desc">{error}</p>
            <button
              type="button"
              className="btn-retry-action"
              onClick={handleRetry}
            >
              <span>Try Again</span>
            </button>
          </div>
        ) : (
          <>
            {/* 3. Minimalist KPI Cards (Base44 Composition) */}
            <section aria-label="Incident Metrics" className="kpi-cards-section">
              <div className="kpi-grid">
                {/* Card 1: Total Reports */}
                <article className="kpi-card">
                  <div className="kpi-icon-tile" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </div>
                  <div className="kpi-value">{stats.total}</div>
                  <div className="kpi-label">Total Reports</div>
                </article>

                {/* Card 2: Active Reports */}
                <article className="kpi-card">
                  <div className="kpi-icon-tile" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                    </svg>
                  </div>
                  <div className="kpi-value">{stats.active}</div>
                  <div className="kpi-label">Active</div>
                </article>

                {/* Card 3: Resolved Reports */}
                <article className="kpi-card">
                  <div className="kpi-icon-tile" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                      <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                  </div>
                  <div className="kpi-value">{stats.resolved}</div>
                  <div className="kpi-label">Resolved</div>
                </article>

                {/* Card 4: Notifications */}
                <article className="kpi-card">
                  <div className="kpi-icon-tile" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                      <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                  </div>
                  <div className="kpi-value">{stats.notifications}</div>
                  <div className="kpi-label">
                    Notifications {stats.unreadNotifications > 0 && <span className="kpi-unread-badge">({stats.unreadNotifications} new)</span>}
                  </div>
                </article>
              </div>
            </section>

            {/* 4 & 5. Recent Reports & Notifications Grid */}
            <div className="citizen-content-grid">
              {/* Recent Reports Section */}
              <section className="citizen-panel-card" aria-labelledby="recent-reports-heading">
                <div className="panel-card-header">
                  <h2 id="recent-reports-heading" className="panel-title">
                    Recent Reports
                  </h2>
                  <Link to="/citizen/reports" className="panel-view-all-link" aria-label="View all citizen reports">
                    View all &rarr;
                  </Link>
                </div>

                {recentReports.length === 0 ? (
                  <div className="compact-empty-state">
                    <div className="empty-state-icon-circle" aria-hidden="true">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </div>
                    <h3 className="empty-state-title">No reports yet</h3>
                    <p className="empty-state-desc">
                      You haven&apos;t filed any waste incident reports yet. Use the button below to report waste accumulation.
                    </p>
                    <button
                      type="button"
                      className="empty-cta-btn"
                      onClick={handleReportGarbageClick}
                    >
                      <span aria-hidden="true">📢</span>
                      <span>Report Garbage</span>
                    </button>
                  </div>
                ) : (
                  <div className="reports-row-list">
                    {recentReports.map((report) => {
                      const typeConfig = GARBAGE_TYPE_CONFIG[report.garbage_type] || {
                        label: report.garbage_type || 'General Waste',
                        icon: '🗑️',
                      };

                      return (
                        <div
                          key={report.id}
                          className="report-row-item"
                          onClick={() => navigate(`/citizen/reports/${report.id}`)}
                          role="button"
                          tabIndex={0}
                          aria-label={`View report: ${report.title}`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              navigate(`/citizen/reports/${report.id}`);
                            }
                          }}
                        >
                          <div className="report-row-left">
                            <div className="report-row-title-bar">
                              <h4 className="report-row-title">{report.title}</h4>
                              <ReportStatusBadge status={report.status} size="small" />
                            </div>

                            <div className="report-row-meta">
                              <span className="report-type-tag">
                                <span aria-hidden="true">{typeConfig.icon}</span>
                                <span>{typeConfig.label}</span>
                              </span>
                              {report.severity && (
                                <span className={`severity-badge severity-${report.severity}`}>
                                  {report.severity}
                                </span>
                              )}
                              <span className="report-row-address">
                                <span aria-hidden="true">📍</span>
                                <span>{report.address || 'Location recorded'}</span>
                              </span>
                              <span className="report-row-time">
                                {formatDate(report.created_at)}
                              </span>
                            </div>
                          </div>

                          <div className="report-row-arrow" aria-hidden="true">
                            &rarr;
                          </div>
                        </div>
                      );
                    })}

                    <div className="panel-footer">
                      <Link to="/citizen/reports" className="panel-footer-link">
                        Manage and track all my reports &rarr;
                      </Link>
                    </div>
                  </div>
                )}
              </section>

              {/* Notifications Section */}
              <section className="citizen-panel-card" aria-labelledby="notifications-heading">
                <div className="panel-card-header">
                  <h2 id="notifications-heading" className="panel-title">
                    Notifications
                  </h2>
                  <Link to="/citizen/notifications" className="panel-view-all-link" aria-label="View all notifications">
                    View all &rarr;
                  </Link>
                </div>

                {recentNotifications.length === 0 ? (
                  <div className="compact-empty-state">
                    <div className="empty-state-icon-circle" aria-hidden="true">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                      </svg>
                    </div>
                    <h3 className="empty-state-title">No notifications yet</h3>
                    <p className="empty-state-desc">
                      You are all caught up. When municipal crews update your reports, updates will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="notifications-row-list">
                    {recentNotifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`notif-row-item ${!notif.is_read ? 'unread' : ''}`}
                        onClick={() => handleNotificationClick(notif)}
                        role="button"
                        tabIndex={0}
                        aria-label={`Notification: ${notif.title}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleNotificationClick(notif);
                          }
                        }}
                      >
                        <div className="notif-row-icon" aria-hidden="true">
                          {!notif.is_read && <span className="notif-unread-pulse" />}
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                          </svg>
                        </div>
                        <div className="notif-row-content">
                          <h4 className="notif-row-title">{notif.title}</h4>
                          <p className="notif-row-msg">{notif.message}</p>
                          <span className="notif-row-time">
                            {formatNotificationTime(notif.created_at)}
                          </span>
                        </div>
                      </div>
                    ))}

                    <div className="panel-footer">
                      <Link to="/citizen/notifications" className="panel-footer-link">
                        Open Notification Center &rarr;
                      </Link>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
