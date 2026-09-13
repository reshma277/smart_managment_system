import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's default marker asset paths in Vite
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
});

// Custom SVG-based Pin Icon for municipal incident marker
const incidentPinIcon = L.divIcon({
  className: 'custom-incident-pin',
  html: `
    <div class="incident-pin-wrapper">
      <div class="incident-pin-glow"></div>
      <div class="incident-pin-head">
        <span>📍</span>
      </div>
      <div class="incident-pin-point"></div>
    </div>
  `,
  iconSize: [36, 46],
  iconAnchor: [18, 46],
  popupAnchor: [0, -46],
});

// Neutral default municipal map center (Visakhapatnam municipal area)
// NOT used as selected report location
const DEFAULT_CENTER = [17.6868, 83.2185];
const DEFAULT_ZOOM = 13;

/**
 * Handles map click events to update the incident coordinates.
 */
function MapClickHandler({ onLocationSelect }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/**
 * Re-centers map view when new coordinates are received from GPS or selection.
 */
function MapRecenter({ targetCenter }) {
  const map = useMap();
  const prevCenterRef = useRef(null);

  useEffect(() => {
    if (!targetCenter) return;
    const [lat, lng] = targetCenter;
    const prev = prevCenterRef.current;

    // Only setView if center actually changed significantly
    if (!prev || Math.abs(prev[0] - lat) > 0.0001 || Math.abs(prev[1] - lng) > 0.0001) {
      map.setView([lat, lng], Math.max(map.getZoom(), 16), { animate: true });
      prevCenterRef.current = [lat, lng];
    }
  }, [targetCenter, map]);

  return null;
}

export default function IncidentLocationPicker({
  latitude,
  longitude,
  onLocationChange,
  locationStatus,
  setLocationStatus,
  locationError,
  setLocationError,
}) {
  const hasCoordinates = latitude !== null && longitude !== null;

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('unavailable');
      setLocationError('Geolocation is not supported by your browser. Please click directly on the map to pinpoint the incident.');
      return;
    }

    setLocationStatus('getting');
    setLocationError('');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        onLocationChange({ lat, lng });
        setLocationStatus('selected');
        setLocationError('');
      },
      (err) => {
        let message = 'Unable to determine your location. Please click directly on the map to choose the spot.';
        if (err.code === err.PERMISSION_DENIED) {
          setLocationStatus('denied');
          message = 'Location permission was denied. Please allow location permissions in your browser or click on the map to pinpoint the incident.';
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setLocationStatus('unavailable');
          message = 'Location information is currently unavailable. You can click on the map to manually set the incident location.';
        } else if (err.code === err.TIMEOUT) {
          setLocationStatus('timeout');
          message = 'Location request timed out. Please try again or click the map directly.';
        } else {
          setLocationStatus('error');
        }
        setLocationError(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  const handleManualMapSelect = (lat, lng) => {
    onLocationChange({ lat, lng });
    setLocationStatus('selected');
    setLocationError('');
  };

  // Status badge display helper
  const getStatusBadge = () => {
    switch (locationStatus) {
      case 'getting':
        return (
          <span className="location-status-badge status-getting" role="status">
            <span className="status-spinner" aria-hidden="true" />
            Getting location...
          </span>
        );
      case 'selected':
        return (
          <span className="location-status-badge status-selected">
            <span aria-hidden="true">✓</span> Location selected
          </span>
        );
      case 'denied':
        return (
          <span className="location-status-badge status-denied">
            <span aria-hidden="true">✕</span> Location permission denied
          </span>
        );
      case 'unavailable':
        return (
          <span className="location-status-badge status-unavailable">
            <span aria-hidden="true">⚠️</span> Location unavailable
          </span>
        );
      case 'timeout':
        return (
          <span className="location-status-badge status-timeout">
            <span aria-hidden="true">⏱️</span> Location request timed out
          </span>
        );
      default:
        return (
          <span className="location-status-badge status-not-selected">
            <span aria-hidden="true">📍</span> Not selected
          </span>
        );
    }
  };

  return (
    <div className="location-picker-wrapper">
      {/* Geolocation Trigger & Status Bar */}
      <div className="location-toolbar">
        <button
          type="button"
          className="btn-use-gps"
          onClick={handleUseCurrentLocation}
          disabled={locationStatus === 'getting'}
          aria-label="Use my device's current location"
        >
          <span className="btn-icon" aria-hidden="true">
            {locationStatus === 'getting' ? '⏳' : '🛰️'}
          </span>
          <span>
            {locationStatus === 'getting' ? 'Locating device...' : 'Use My Current Location'}
          </span>
        </button>

        <div className="location-status-container">
          {getStatusBadge()}
        </div>
      </div>

      {/* User-friendly Error Alert */}
      {locationError && (
        <div className="location-error-alert" role="alert">
          <span className="alert-icon" aria-hidden="true">⚠️</span>
          <p>{locationError}</p>
        </div>
      )}

      {/* Interactive Map Container */}
      <div className="map-embed-container">
        <p className="map-instructions" id="map-instructions-hint">
          Click anywhere on the map or drag the pin to position the incident precisely.
        </p>

        <div className="leaflet-map-frame" aria-describedby="map-instructions-hint">
          <MapContainer
            center={hasCoordinates ? [latitude, longitude] : DEFAULT_CENTER}
            zoom={hasCoordinates ? 16 : DEFAULT_ZOOM}
            scrollWheelZoom={true}
            className="leaflet-map-element"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />

            <MapClickHandler onLocationSelect={handleManualMapSelect} />

            {hasCoordinates && (
              <>
                <MapRecenter targetCenter={[latitude, longitude]} />
                <Marker
                  position={[latitude, longitude]}
                  icon={incidentPinIcon}
                  draggable={true}
                  eventHandlers={{
                    dragend(e) {
                      const marker = e.target;
                      const pos = marker.getLatLng();
                      handleManualMapSelect(pos.lat, pos.lng);
                    },
                  }}
                >
                  <Popup>
                    <div className="marker-popup-content">
                      <strong>Incident Location</strong>
                      <p>
                        Lat: {latitude.toFixed(6)}<br />
                        Lng: {longitude.toFixed(6)}
                      </p>
                      <small>Drag marker to adjust</small>
                    </div>
                  </Popup>
                </Marker>
              </>
            )}
          </MapContainer>
        </div>
      </div>

      {/* Selected Coordinates Readout */}
      {hasCoordinates ? (
        <div className="location-readout-card selected">
          <div className="readout-header">
            <span className="readout-title">
              <span aria-hidden="true">📍</span> Confirmed Pin Location
            </span>
            <span className="readout-note">Ready for municipal dispatch</span>
          </div>
          <div className="coords-grid">
            <div className="coord-box">
              <span className="coord-label">Latitude:</span>
              <span className="coord-value">{latitude.toFixed(6)}</span>
            </div>
            <div className="coord-box">
              <span className="coord-label">Longitude:</span>
              <span className="coord-value">{longitude.toFixed(6)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="location-readout-card unselected">
          <div className="unselected-text">
            <strong>Location not selected:</strong> Please click &ldquo;Use My Current Location&rdquo; or click on the map above to select the incident coordinates.
          </div>
        </div>
      )}
    </div>
  );
}
