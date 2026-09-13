import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/citizen.css';
import '../../styles/citizen-tracking.css';

export default function CitizenDashboard() {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');

  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    resolved: 0,
    loading: true,
  });

  const [recentReports, setRecentReports] = useState([]);
  const [recentReportsLoading, setRecentReportsLoading] = useState(false);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [recentNotificationsLoading, setRecentNotificationsLoading] = useState(false);

  const displayName = profile?.full_name || user?.user_metadata?.full_name || 'Citizen';
  const displayEmail = profile?.email || user?.email || '';

  // Initial fetch and Realtime listener
  useEffect(() => {
    const citizenId = user?.id;
    if (!citizenId) return;

    let isMounted = true;

    async function loadStats() {
      try {
        const [totalRes, activeRes, resolvedRes] = await Promise.all([
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
        ]);

        if (isMounted) {
          setStats({
            total: totalRes.count || 0,
            active: activeRes.count || 0,
            resolved: resolvedRes.count || 0,
            loading: false,
          });
        }
      } catch (err) {
        console.error('Error loading dashboard stats:', err);
        if (isMounted) setStats((prev) => ({ ...prev, loading: false }));
      }
    }

    async function loadReports() {
      try {
        const { data, error } = await supabase
          .from('reports')
          .select('id, title, status, garbage_type, address, created_at')
          .eq('citizen_id', citizenId)
          .order('created_at', { ascending: false })
          .limit(3);

        if (!error && data && isMounted) {
          setRecentReports(data);
        }
      } catch (err) {
        console.error('Error fetching recent reports:', err);
      } finally {
        if (isMounted) setRecentReportsLoading(false);
      }
    }

    async function loadNotifications() {
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', citizenId)
          .order('created_at', { ascending: false })
          .limit(4);

        if (!error && data && isMounted) {
          setRecentNotifications(data);
        }
      } catch (err) {
        console.error('Error fetching recent notifications:', err);
      } finally {
        if (isMounted) setRecentNotificationsLoading(false);
      }
    }

    loadStats();
    loadReports();
    loadNotifications();

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
          loadStats();
          loadReports();
        }
      )
      .subscribe();

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
          loadNotifications();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(reportsChannel);
      supabase.removeChannel(notifsChannel);
    };
  }, [user]);

  const handleReportGarbageClick = () => {
    navigate('/citizen/report');
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

  return (
    <div className="citizen-layout">
      {/* Universal authenticated navigation bar */}
      <UserNavbar />

      <main className="citizen-main-content" role="main">
        {/* Hero & Page Header */}
        <header className="citizen-hero-card">
          <div className="citizen-hero-top">
            <div className="citizen-header-info">
              <div className="citizen-header-avatar" aria-hidden="true">
                📍
              </div>
              <div className="citizen-header-text">
                <h1>Citizen Waste Portal</h1>
                <div className="citizen-meta">
                  <span>Welcome, <strong>{displayName}</strong></span>
                  {displayEmail && <span className="citizen-email">{displayEmail}</span>}
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="citizen-nav-tabs" aria-label="Citizen portal sections">
              <button
                type="button"
                className={`nav-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
                aria-current={activeTab === 'overview' ? 'page' : undefined}
              >
                <span aria-hidden="true">📊</span> Overview
              </button>
              <button
                type="button"
                className={`nav-tab-btn ${activeTab === 'my-reports' ? 'active' : ''}`}
                onClick={() => setActiveTab('my-reports')}
                aria-current={activeTab === 'my-reports' ? 'page' : undefined}
              >
                <span aria-hidden="true">📋</span> My Reports
                {stats.total > 0 && <span className="tab-counter-badge">{stats.total}</span>}
              </button>
              <button
                type="button"
                className={`nav-tab-btn ${activeTab === 'notifications' ? 'active' : ''}`}
                onClick={() => setActiveTab('notifications')}
                aria-current={activeTab === 'notifications' ? 'page' : undefined}
              >
                <span aria-hidden="true">🔔</span> Notifications
              </button>
            </nav>
          </div>

          <p className="citizen-hero-description">
            Report public waste accumulation, track assigned municipal cleanup teams, and verify incident resolution in real time.
          </p>

          {/* Prominent Primary Action Bar */}
          <div className="citizen-actions-bar">
            <button
              type="button"
              className="btn-report-garbage"
              onClick={handleReportGarbageClick}
              aria-label="Report Garbage Incident"
            >
              <span className="btn-icon" aria-hidden="true">📢</span>
              <span>Report Garbage</span>
            </button>

            <span className="section-badge">Municipal Dispatch Area</span>
          </div>
        </header>

        {/* Real Live Database Summary Cards */}
        <section aria-labelledby="summary-heading">
          <div className="section-header">
            <h2 id="summary-heading">Reports Summary</h2>
            <span className="section-badge section-badge-live">
              <span className="live-dot" aria-hidden="true"></span>
              Live Database
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
                {stats.loading ? (
                  <span className="stat-placeholder-dash">...</span>
                ) : (
                  <span>{stats.total}</span>
                )}
                <span className="stat-state-badge">
                  {stats.loading ? 'Syncing' : 'Filed'}
                </span>
              </div>
              <p className="stat-card-description">
                Total waste incidents reported by your account
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
                {stats.loading ? (
                  <span className="stat-placeholder-dash">...</span>
                ) : (
                  <span>{stats.active}</span>
                )}
                <span className="stat-state-badge">
                  {stats.active > 0 ? 'In Action' : 'All Clear'}
                </span>
              </div>
              <p className="stat-card-description">
                Reports currently pending, assigned, or in progress
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
                {stats.loading ? (
                  <span className="stat-placeholder-dash">...</span>
                ) : (
                  <span>{stats.resolved}</span>
                )}
                <span className="stat-state-badge">
                  {stats.resolved > 0 ? 'Verified' : 'Pending'}
                </span>
              </div>
              <p className="stat-card-description">
                Incidents cleaned and verified by municipal sanitation teams
              </p>
            </article>
          </div>
        </section>

        {/* Tab Content Panels */}
        <section className="citizen-panel-card" aria-label="Selected View">
          {activeTab === 'overview' && (
            <div className="panel-empty-state">
              <span className="empty-icon" aria-hidden="true">🌱</span>
              <h3>Civic Waste Management</h3>
              <p>
                As a registered citizen, you can report unattended waste, track nearby reports, and follow progress directly through the municipal dispatch pipeline.
              </p>

              <div className="step-roadmap-grid">
                <div className="roadmap-item">
                  <span className="roadmap-step-badge">Step 1 — Foundation</span>
                  <h4>Citizen Dashboard</h4>
                  <p>Authenticated access, responsive navigation, and live summary statistics.</p>
                </div>
                <div className="roadmap-item">
                  <span className="roadmap-step-badge">Step 2 — Filing</span>
                  <h4>Report Incident</h4>
                  <p>GPS auto-geolocation, private photo upload, and 30m duplicate check.</p>
                </div>
                <div className="roadmap-item">
                  <span className="roadmap-step-badge">Step 3 — Tracking</span>
                  <h4>Live Tracking & Alerts</h4>
                  <p>Real-time lifecycle timeline from Reported to Resolved.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'my-reports' && (
            <div className="tab-content-container">
              <div className="tab-pane-header">
                <div>
                  <h3 className="tab-pane-title">Recent Waste Incidents</h3>
                  <p className="tab-pane-sub">Your latest reported municipal waste cases</p>
                </div>
                <div className="tab-pane-actions">
                  <Link to="/citizen/reports" className="btn-secondary-link">
                    View All Reports ({stats.total}) →
                  </Link>
                </div>
              </div>

              {recentReportsLoading ? (
                <div className="tracking-loading-state">
                  <div className="tracking-spinner" />
                  <p>Loading your reports...</p>
                </div>
              ) : recentReports.length === 0 ? (
                <div className="panel-empty-state">
                  <span className="empty-icon" aria-hidden="true">📋</span>
                  <h3>No Reports Filed Yet</h3>
                  <p>
                    You haven&apos;t filed any waste incident reports yet. When you submit reports via the &quot;Report Garbage&quot; button, your submissions and live statuses will appear here.
                  </p>
                  <button
                    type="button"
                    className="btn-report-garbage"
                    onClick={handleReportGarbageClick}
                    style={{ marginTop: '1rem' }}
                  >
                    <span>📢 File Your First Report</span>
                  </button>
                </div>
              ) : (
                <div className="recent-reports-list">
                  {recentReports.map((report) => (
                    <div
                      key={report.id}
                      className="recent-report-item"
                      onClick={() => navigate(`/citizen/reports/${report.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          navigate(`/citizen/reports/${report.id}`);
                        }
                      }}
                    >
                      <div className="recent-report-info">
                        <div className="recent-report-top">
                          <h4 className="recent-report-title">{report.title}</h4>
                          <ReportStatusBadge status={report.status} size="small" />
                        </div>
                        <p className="recent-report-address">📍 {report.address || 'Address recorded'}</p>
                        <span className="recent-report-date">{formatDate(report.created_at)}</span>
                      </div>
                      <span className="item-arrow-icon" aria-hidden="true">→</span>
                    </div>
                  ))}

                  <div className="tab-pane-footer">
                    <Link to="/citizen/reports" className="btn-secondary-link full-width-link">
                      Manage and Track All My Reports →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="tab-content-container">
              <div className="tab-pane-header">
                <div>
                  <h3 className="tab-pane-title">Recent Notifications</h3>
                  <p className="tab-pane-sub">Status changes, assignments, and updates on your reports</p>
                </div>
                <div className="tab-pane-actions">
                  <Link to="/citizen/notifications" className="btn-secondary-link">
                    Open Notification Center →
                  </Link>
                </div>
              </div>

              {recentNotificationsLoading ? (
                <div className="tracking-loading-state">
                  <div className="tracking-spinner" />
                  <p>Loading notifications...</p>
                </div>
              ) : recentNotifications.length === 0 ? (
                <div className="panel-empty-state">
                  <span className="empty-icon" aria-hidden="true">🔔</span>
                  <h3>No Notifications</h3>
                  <p>
                    You have no new alerts. When municipal workers are assigned to your reports or complete cleanup, you will be notified here.
                  </p>
                </div>
              ) : (
                <div className="recent-notifications-list">
                  {recentNotifications.map((n) => (
                    <div
                      key={n.id}
                      className={`recent-notif-item ${!n.is_read ? 'unread' : ''}`}
                      onClick={() => {
                        if (n.report_id) {
                          navigate(`/citizen/reports/${n.report_id}`);
                        } else {
                          navigate('/citizen/notifications');
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          if (n.report_id) {
                            navigate(`/citizen/reports/${n.report_id}`);
                          } else {
                            navigate('/citizen/notifications');
                          }
                        }
                      }}
                    >
                      <div className="recent-notif-icon">
                        {!n.is_read && <span className="notif-unread-dot" aria-label="Unread" />}
                        <span>🔔</span>
                      </div>
                      <div className="recent-notif-body">
                        <h4 className="recent-notif-title">{n.title}</h4>
                        <p className="recent-notif-msg">{n.message}</p>
                        <span className="recent-notif-time">{formatDate(n.created_at)}</span>
                      </div>
                    </div>
                  ))}

                  <div className="tab-pane-footer">
                    <Link to="/citizen/notifications" className="btn-secondary-link full-width-link">
                      View All in Notifications Center →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

