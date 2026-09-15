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
            .select('id, title, status, garbage_type, address, created_at')
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
        {/* 1. Dashboard Header */}
        <header className="citizen-hero-card">
          <div className="citizen-hero-top">
            <div className="citizen-header-info">
              <div className="citizen-header-avatar" aria-hidden="true">
                📍
              </div>
              <div className="citizen-header-text">
                <h1>Welcome back, {displayName}</h1>
                <div className="citizen-meta">
                  <span>Citizen Operations Portal</span>
                  {displayEmail && <span className="citizen-email">{displayEmail}</span>}
                </div>
              </div>
            </div>

            <div className="citizen-actions-bar" style={{ border: 'none', padding: 0 }}>
              <button
                type="button"
                className="btn-report-garbage"
                onClick={handleReportGarbageClick}
                aria-label="Report Garbage Incident"
              >
                <span className="btn-icon" aria-hidden="true">📢</span>
                <span>Report Garbage</span>
              </button>
            </div>
          </div>

          <p className="citizen-hero-description">
            Report public waste accumulation in your neighborhood, track assigned municipal cleanup teams, and receive verified resolution alerts in real time.
          </p>
        </header>

        {/* 5. Loading / Error State Handling */}
        {loading ? (
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '36px', height: '36px' }} />
            <h2 className="state-title">Loading Citizen Dashboard...</h2>
            <p className="state-desc">Retrieving your reports summary and municipal notifications.</p>
          </div>
        ) : error ? (
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <h2 className="state-title">Unable to Load Dashboard</h2>
            <p className="state-desc">{error}</p>
            <button
              type="button"
              className="btn-report-garbage state-action-btn"
              onClick={handleRetry}
            >
              <span>Try Again</span>
            </button>
          </div>
        ) : (
          <>
            {/* 2. Summary Cards Grid */}
            <section aria-labelledby="summary-heading">
              <div className="section-header">
                <h2 id="summary-heading">Activity Overview</h2>
                <span className="section-badge section-badge-live">
                  <span className="live-dot" aria-hidden="true"></span>
                  Live Dispatch
                </span>
              </div>

              <div className="citizen-stats-grid">
                {/* Card 1: Total Reports */}
                <article className="stat-card">
                  <div className="stat-card-header">
                    <h3 className="stat-card-title">Total Reports</h3>
                    <div className="stat-card-icon stat-icon-total" aria-hidden="true">
                      📋
                    </div>
                  </div>
                  <div className="stat-card-value">
                    <span>{stats.total}</span>
                    <span className="stat-state-badge">Filed</span>
                  </div>
                  <p className="stat-card-description">
                    Total waste incidents submitted from your account
                  </p>
                </article>

                {/* Card 2: Active Reports */}
                <article className="stat-card">
                  <div className="stat-card-header">
                    <h3 className="stat-card-title">Active Reports</h3>
                    <div className="stat-card-icon stat-icon-active" aria-hidden="true">
                      ⏳
                    </div>
                  </div>
                  <div className="stat-card-value">
                    <span>{stats.active}</span>
                    <span className="stat-state-badge">
                      {stats.active > 0 ? 'In Action' : 'All Clear'}
                    </span>
                  </div>
                  <p className="stat-card-description">
                    Incidents currently pending, assigned, or in progress
                  </p>
                </article>

                {/* Card 3: Resolved Reports */}
                <article className="stat-card">
                  <div className="stat-card-header">
                    <h3 className="stat-card-title">Resolved Reports</h3>
                    <div className="stat-card-icon stat-icon-resolved" aria-hidden="true">
                      ✅
                    </div>
                  </div>
                  <div className="stat-card-value">
                    <span>{stats.resolved}</span>
                    <span className="stat-state-badge">
                      {stats.resolved > 0 ? 'Verified' : 'Pending'}
                    </span>
                  </div>
                  <p className="stat-card-description">
                    Incidents cleaned and verified with resolution evidence
                  </p>
                </article>

                {/* Card 4: Notifications */}
                <article className="stat-card">
                  <div className="stat-card-header">
                    <h3 className="stat-card-title">Notifications</h3>
                    <div className="stat-card-icon stat-icon-notifs" aria-hidden="true">
                      🔔
                    </div>
                  </div>
                  <div className="stat-card-value">
                    <span>{stats.notifications}</span>
                    <span className="stat-state-badge">
                      {stats.unreadNotifications > 0
                        ? `${stats.unreadNotifications} Unread`
                        : 'All Read'}
                    </span>
                  </div>
                  <p className="stat-card-description">
                    Updates, status changes, and dispatch alerts
                  </p>
                </article>
              </div>
            </section>

            {/* 3 & 4. Recent Reports & Recent Notifications Grid */}
            <div className="citizen-dashboard-grid">
              {/* 3. Recent Reports Section */}
              <section className="citizen-dashboard-section" aria-labelledby="recent-reports-heading">
                <div className="citizen-section-header">
                  <div>
                    <h2 id="recent-reports-heading">
                      <span aria-hidden="true">📋</span> Recent Reports
                    </h2>
                  </div>
                  <Link to="/citizen/reports" className="btn-secondary-link">
                    View All Reports ({stats.total}) &rarr;
                  </Link>
                </div>

                {recentReports.length === 0 ? (
                  <div className="state-box" style={{ padding: '2.5rem 1.5rem' }}>
                    <span className="state-icon" aria-hidden="true">📋</span>
                    <h3 className="state-title">No Reports Filed Yet</h3>
                    <p className="state-desc">
                      You haven&apos;t filed any waste incident reports yet. Use the button below to report waste accumulation in your area.
                    </p>
                    <button
                      type="button"
                      className="btn-report-garbage state-action-btn"
                      onClick={handleReportGarbageClick}
                    >
                      <span className="btn-icon" aria-hidden="true">📢</span>
                      <span>File Your First Report</span>
                    </button>
                  </div>
                ) : (
                  <div className="recent-reports-list">
                    {recentReports.map((report) => {
                      const typeConfig = GARBAGE_TYPE_CONFIG[report.garbage_type] || {
                        label: report.garbage_type || 'General Waste',
                        icon: '🗑️',
                      };

                      return (
                        <div
                          key={report.id}
                          className="recent-report-item"
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
                          <div className="recent-report-info">
                            <div className="recent-report-top">
                              <h4 className="recent-report-title">{report.title}</h4>
                              <ReportStatusBadge status={report.status} size="small" />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <span className="garbage-type-badge">
                                <span aria-hidden="true">{typeConfig.icon}</span>
                                <span>{typeConfig.label}</span>
                              </span>
                            </div>

                            <p className="recent-report-address">
                              <span aria-hidden="true">📍</span>
                              <span>{report.address || 'Address recorded'}</span>
                            </p>

                            <span className="recent-report-date">
                              Reported on {formatDate(report.created_at)}
                            </span>
                          </div>

                          <span className="item-arrow-icon" aria-hidden="true">
                            &rarr;
                          </span>
                        </div>
                      );
                    })}

                    <div className="tab-pane-footer">
                      <Link to="/citizen/reports" className="btn-secondary-link full-width-link">
                        Manage and Track All My Reports &rarr;
                      </Link>
                    </div>
                  </div>
                )}
              </section>

              {/* 4. Recent Notifications Section */}
              <section className="citizen-dashboard-section" aria-labelledby="recent-notifs-heading">
                <div className="citizen-section-header">
                  <div>
                    <h2 id="recent-notifs-heading">
                      <span aria-hidden="true">🔔</span> Notifications
                    </h2>
                  </div>
                  <Link to="/citizen/notifications" className="btn-secondary-link">
                    View All ({stats.notifications}) &rarr;
                  </Link>
                </div>

                {recentNotifications.length === 0 ? (
                  <div className="state-box" style={{ padding: '2.5rem 1.5rem' }}>
                    <span className="state-icon" aria-hidden="true">🔔</span>
                    <h3 className="state-title">No Notifications Yet</h3>
                    <p className="state-desc">
                      You are all caught up. When municipal crews update your reports or complete cleanup, notifications will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="recent-notifications-list">
                    {recentNotifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`recent-notif-item ${!notif.is_read ? 'unread' : ''}`}
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
                        <div className="recent-notif-icon">
                          {!notif.is_read && <span className="notif-unread-dot" aria-label="Unread alert" />}
                          <span aria-hidden="true">🔔</span>
                        </div>
                        <div className="recent-notif-body">
                          <h4 className="recent-notif-title">{notif.title}</h4>
                          <p className="recent-notif-msg">{notif.message}</p>
                          <span className="recent-notif-time">
                            {formatNotificationTime(notif.created_at)}
                          </span>
                        </div>
                      </div>
                    ))}

                    <div className="tab-pane-footer">
                      <Link to="/citizen/notifications" className="btn-secondary-link full-width-link">
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
