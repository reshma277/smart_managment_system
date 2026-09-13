import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

export default function WorkerLocationWidget({ onLocationUpdated }) {
  const { user } = useAuth();
  const [updating, setUpdating] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [lastLocation, setLastLocation] = useState({
    coordsText: null,
    updatedAt: null,
  });

  // Fetch current stored profile location
  useEffect(() => {
    if (!user?.id) return;

    let isMounted = true;

    async function loadProfileLocation() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('current_location, last_location_updated_at')
          .eq('id', user.id)
          .maybeSingle();

        if (!error && data && isMounted) {
          let coords = null;
          if (data.current_location) {
            // PostGIS Point can return as GeoJSON or WKT string
            if (typeof data.current_location === 'object' && data.current_location.coordinates) {
              const [lng, lat] = data.current_location.coordinates;
              coords = `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
            } else if (typeof data.current_location === 'string') {
              coords = data.current_location;
            }
          }

          setLastLocation({
            coordsText: coords,
            updatedAt: data.last_location_updated_at,
          });
        }
      } catch (err) {
        console.warn('Could not load worker location:', err);
      }
    }

    loadProfileLocation();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const handleUpdateLocation = () => {
    if (!navigator.geolocation) {
      setErrorMsg('Geolocation is not supported by your browser.');
      return;
    }

    setUpdating(true);
    setStatusMsg(null);
    setErrorMsg(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const wktPoint = `POINT(${longitude} ${latitude})`;
        const nowIso = new Date().toISOString();

        try {
          const { error } = await supabase
            .from('profiles')
            .update({
              current_location: wktPoint,
              last_location_updated_at: nowIso,
            })
            .eq('id', user.id);

          if (error) {
            console.error('Error updating worker location:', error);
            setErrorMsg('Could not update location in database: ' + error.message);
          } else {
            setLastLocation({
              coordsText: `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`,
              updatedAt: nowIso,
            });
            setStatusMsg('GPS coordinates synced successfully.');
            if (onLocationUpdated) onLocationUpdated();
          }
        } catch (err) {
          console.error('Exception updating location:', err);
          setErrorMsg('Network error while updating coordinates.');
        } finally {
          setUpdating(false);
        }
      },
      (geoErr) => {
        setUpdating(false);
        if (geoErr.code === 1) {
          setErrorMsg('Location permission denied. Please allow location access.');
        } else if (geoErr.code === 2) {
          setErrorMsg('Position unavailable. Check your device GPS.');
        } else {
          setErrorMsg('Location request timed out.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const formatTimeAgo = (isoStr) => {
    if (!isoStr) return 'Never updated';
    const d = new Date(isoStr);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="worker-location-bar" role="region" aria-label="Worker GPS Location Dispatch">
      <div className="worker-location-left">
        <span className="location-pin-icon" aria-hidden="true">📍</span>
        <div>
          <div>
            <span>Dispatch Coordinates: </span>
            <span className="location-coords-text">
              {lastLocation.coordsText || 'Not recorded yet'}
            </span>
          </div>
          <div className="location-time-text">
            Last GPS sync: {formatTimeAgo(lastLocation.updatedAt)}
          </div>
          {statusMsg && <div style={{ color: '#059669', fontSize: '0.775rem', marginTop: '2px' }}>{statusMsg}</div>}
          {errorMsg && <div style={{ color: '#ef4444', fontSize: '0.775rem', marginTop: '2px' }}>{errorMsg}</div>}
        </div>
      </div>

      <button
        type="button"
        className="btn-update-location"
        onClick={handleUpdateLocation}
        disabled={updating}
        aria-label="Update My GPS Location"
      >
        <span>{updating ? '🔄 Syncing GPS...' : '🎯 Update My Location'}</span>
      </button>
    </div>
  );
}
