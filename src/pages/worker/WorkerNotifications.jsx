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
    <div className="worker-layout">
      <UserNavbar />

      <main className="worker-main-content" role="main">
        {/* Header Card */}
        <header className="tracking-header-card">
          <div className="tracking-header-content">
            <div className="tracking-eyebrow-wrapper">
              <span className="tracking-eyebrow">FIELD DISPATCH ALERTS</span>
            </div>
            <h1 className="tracking-title">Field Notifications</h1>
            <p className="tracking-subtitle">
              Direct task assignments, status change alerts, and municipal dispatch communications.
            </p>
          </div>

          <div className="tracking-header-actions">
            {unreadCount > 0 && (
              <button
                type="button"
                className="btn-mark-all-pill"
                onClick={handleMarkAllRead}
                disabled={markingAll}
              >
                {markingAll ? 'Updating...' : `✓ Mark All Read (${unreadCount})`}
              </button>
            )}
          </div>
        </header>

        {/* Tab Filters Bar */}
        <nav className="worker-notif-tabs" aria-label="Notification view filters">
          <button
            type="button"
            className={`worker-notif-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Dispatch Alerts ({notifications.length})
          </button>
          <button
            type="button"
            className={`worker-notif-tab-btn ${activeTab === 'unread' ? 'active' : ''}`}
            onClick={() => setActiveTab('unread')}
          >
            Unread Alerts ({unreadCount})
          </button>
        </nav>

        {/* Loading State */}
        {loading && (
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '36px', height: '36px' }} />
            <p className="state-title">Loading dispatch notifications...</p>
            <p className="state-desc">Checking for dispatch updates and task assignments.</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <h2 className="state-title">Error Loading Notifications</h2>
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

        {/* Empty State: No notifications at all */}
        {!loading && !error && notifications.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">🔔</span>
            <h2 className="state-title">No Dispatch Notifications</h2>
            <p className="state-desc">
              You do not have any notifications yet. When municipal dispatch assigns reports to you, alerts will appear here in real time.
            </p>
            <button
              type="button"
              className="btn-worker-link"
              onClick={() => navigate('/worker/reports')}
            >
              View Assigned Reports &rarr;
            </button>
          </div>
        )}

        {/* Empty State: No unread notifications */}
        {!loading && !error && notifications.length > 0 && displayedNotifications.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">✅</span>
            <h2 className="state-title">All Caught Up!</h2>
            <p className="state-desc">You have no unread notifications in your field dispatch inbox.</p>
            <button
              type="button"
              className="btn-form-cancel state-action-btn"
              onClick={() => setActiveTab('all')}
            >
              View All Alerts
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
                <article
                  key={notif.id}
                  className={`worker-notif-card ${!notif.is_read ? 'unread' : 'read'}`}
                  aria-label={`${notif.title}: ${notif.message}`}
                >
                  {!notif.is_read && (
                    <div className="worker-notif-dot" title="Unread alert" aria-hidden="true" />
                  )}

                  <div className="worker-notif-content">
                    <h2 className="worker-notif-title">{notif.title}</h2>
                    <p className="worker-notif-msg">{notif.message}</p>

                    <div className="worker-notif-footer">
                      <time className="worker-notif-time" dateTime={notif.created_at}>
                        {notifDate}
                      </time>

                      <div className="worker-notif-actions">
                        {notif.report_id && (
                          <Link
                            to={`/worker/reports/${notif.report_id}`}
                            className="btn-notif-open"
                            onClick={(e) => {
                              if (!notif.is_read) {
                                handleMarkSingleRead(e, notif.id);
                              }
                            }}
                          >
                            Open Assigned Task &rarr;
                          </Link>
                        )}

                        {!notif.is_read && (
                          <button
                            type="button"
                            className="btn-notif-read"
                            onClick={(e) => handleMarkSingleRead(e, notif.id)}
                            aria-label="Mark notification as read"
                          >
                            Mark Read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
