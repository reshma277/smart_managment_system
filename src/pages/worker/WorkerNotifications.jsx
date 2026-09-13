import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/citizen-tracking.css';
import '../../styles/worker.css';

export default function WorkerNotifications() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [activeTab, setActiveTab] = useState('all'); // 'all' or 'unread'
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    let isMounted = true;

    async function loadNotifications() {
      try {
        const { data, error: fetchErr } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (fetchErr) {
          console.error('Error fetching worker notifications:', fetchErr);
          if (isMounted) setError('Unable to load worker dispatch notifications.');
          return;
        }

        if (isMounted) {
          setNotifications(data || []);
        }
      } catch (err) {
        console.error('Worker notifications exception:', err);
        if (isMounted) setError('Network error while retrieving notifications.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadNotifications();

    // Realtime subscription on worker notifications
    const notifChannel = supabase
      .channel(`worker-notifs-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          loadNotifications();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(notifChannel);
    };
  }, [user, refreshKey]);

  // Mark single notification read using existing RPC: mark_notification_read(p_notification_id)
  const handleMarkSingleRead = async (e, notificationId) => {
    e.stopPropagation();
    try {
      const { error: rpcErr } = await supabase.rpc('mark_notification_read', {
        p_notification_id: notificationId,
      });

      if (rpcErr) {
        console.error('mark_notification_read error:', rpcErr);
        return;
      }

      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
    } catch (err) {
      console.error('Exception marking worker notification read:', err);
    }
  };

  // Mark all notifications read using existing RPC: mark_all_notifications_read()
  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      const { error: rpcErr } = await supabase.rpc('mark_all_notifications_read');

      if (rpcErr) {
        console.error('mark_all_notifications_read error:', rpcErr);
        return;
      }

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.error('Exception marking all read:', err);
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const displayedNotifications = notifications.filter((n) => {
    if (activeTab === 'unread') return !n.is_read;
    return true;
  });

  return (
    <div className="worker-page">
      <UserNavbar />

      <main className="tracking-container" role="main">
        {/* Header */}
        <header className="tracking-header">
          <div className="tracking-header-text">
            <h1>Field Dispatch Notifications</h1>
            <p>Direct assignment notices, emergency alerts, and status change alerts from municipal operations</p>
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              className="btn-mark-all-read"
              onClick={handleMarkAllRead}
              disabled={markingAll}
            >
              {markingAll ? 'Updating...' : `Mark All Read (${unreadCount})`}
            </button>
          )}
        </header>

        {/* Tab Filters */}
        <nav className="filter-nav-bar" aria-label="Notification view filters">
          <button
            type="button"
            className={`filter-pill-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Dispatch Alerts ({notifications.length})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${activeTab === 'unread' ? 'active' : ''}`}
            onClick={() => setActiveTab('unread')}
          >
            Unread Only ({unreadCount})
          </button>
        </nav>

        {/* Loading State */}
        {loading && (
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="state-title">Loading field notifications...</p>
            <p className="state-desc">Checking for dispatch updates and task assignments.</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <p className="state-title">Error Loading Notifications</p>
            <p className="state-desc">{error}</p>
            <button
              type="button"
              className="btn-form-cancel state-action-btn"
              onClick={handleRetry}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && notifications.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">🔔</span>
            <h2 className="state-title">No Dispatch Notifications</h2>
            <p className="state-desc">
              You do not have any notifications yet. New cleanup task assignments will alert you here.
            </p>
            <button
              type="button"
              className="worker-btn worker-btn-primary"
              onClick={() => navigate('/worker/reports')}
            >
              View Assigned Reports &rarr;
            </button>
          </div>
        )}

        {/* Unread Empty State */}
        {!loading && !error && notifications.length > 0 && displayedNotifications.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">✅</span>
            <p className="state-title">All caught up!</p>
            <p className="state-desc">You have no unread notifications.</p>
            <button
              type="button"
              className="btn-form-cancel state-action-btn"
              onClick={() => setActiveTab('all')}
            >
              View All Notifications
            </button>
          </div>
        )}

        {/* Notifications List */}
        {!loading && !error && displayedNotifications.length > 0 && (
          <div className="notifications-list" role="feed" aria-label="Notifications list">
            {displayedNotifications.map((notif) => {
              const notifDate = new Date(notif.created_at).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={notif.id}
                  className={`notification-card ${!notif.is_read ? 'unread' : 'read'}`}
                  role="article"
                  aria-label={`${notif.title}: ${notif.message}`}
                >
                  {!notif.is_read && (
                    <div className="notification-unread-dot" title="Unread alert" />
                  )}

                  <div className="notification-content">
                    <h2 className="notification-card-title">{notif.title}</h2>
                    <p className="notification-card-msg">{notif.message}</p>

                    <div className="notification-card-footer">
                      <time dateTime={notif.created_at}>{notifDate}</time>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        {notif.report_id && (
                          <Link
                            to={`/worker/reports/${notif.report_id}`}
                            className="report-card-link-text"
                            onClick={(e) => {
                              if (!notif.is_read) {
                                handleMarkSingleRead(e, notif.id);
                              }
                            }}
                          >
                            Open Assigned Report &rarr;
                          </Link>
                        )}

                        {!notif.is_read && (
                          <button
                            type="button"
                            className="btn-mark-read"
                            onClick={(e) => handleMarkSingleRead(e, notif.id)}
                            aria-label="Mark notification as read"
                          >
                            Mark Read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
