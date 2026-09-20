/**
 * Fleet & Vehicle Management Utilities
 * CleanAlert Municipal Operations
 */

export const VEHICLE_TYPES = [
  { value: 'mini truck', label: 'Mini Truck', icon: '🛻', description: 'Light urban collection (narrow lanes)' },
  { value: 'garbage truck', label: 'Garbage Truck', icon: '🚛', description: 'Standard municipal waste collection' },
  { value: 'compactor', label: 'Compactor', icon: '🚚', description: 'High-density heavy waste compactor' },
  { value: 'tipper', label: 'Tipper', icon: '🚜', description: 'Debris, construction, & bulk haulage' },
  { value: 'tractor', label: 'Tractor', icon: '🚜', description: 'Rural & peripheral zone transport' },
  { value: 'other', label: 'Other Special Vehicle', icon: '🚐', description: 'Auxiliary utility vehicle' },
];

export const VEHICLE_STATUSES = [
  'Available',
  'Assigned',
  'In Transit',
  'Maintenance',
  'Offline',
];

export const VEHICLE_STATUS_CONFIG = {
  Available: {
    label: 'Available',
    color: '#2D6A4F',
    bg: 'rgba(45, 106, 79, 0.1)',
    border: '#B7E4C7',
    badgeClass: 'status-available',
    icon: '🟢',
  },
  Assigned: {
    label: 'Assigned',
    color: '#1D4ED8',
    bg: 'rgba(29, 78, 216, 0.1)',
    border: '#BFDBFE',
    badgeClass: 'status-assigned',
    icon: '🔵',
  },
  'In Transit': {
    label: 'In Transit',
    color: '#B45309',
    bg: 'rgba(180, 83, 9, 0.1)',
    border: '#FDE68A',
    badgeClass: 'status-transit',
    icon: '🟡',
  },
  Maintenance: {
    label: 'Maintenance',
    color: '#C2410C',
    bg: 'rgba(194, 65, 12, 0.1)',
    border: '#FED7AA',
    badgeClass: 'status-maintenance',
    icon: '🟠',
  },
  Offline: {
    label: 'Offline',
    color: '#6B7280',
    bg: 'rgba(107, 114, 128, 0.1)',
    border: '#E5E7EB',
    badgeClass: 'status-offline',
    icon: '⚪',
  },
};

/**
 * Returns user-friendly label for a vehicle type
 */
export function getVehicleTypeLabel(type) {
  const found = VEHICLE_TYPES.find((t) => t.value === type);
  return found ? found.label : type || 'Unknown';
}

/**
 * Returns emoji icon for a vehicle type
 */
export function getVehicleTypeIcon(type) {
  const found = VEHICLE_TYPES.find((t) => t.value === type);
  return found ? found.icon : '🚚';
}

/**
 * Formats capacity in kg or metric tonnes
 */
export function formatCapacity(capacityKg) {
  const num = Number(capacityKg);
  if (isNaN(num) || num <= 0) return '0 kg';
  if (num >= 1000) {
    const tonnes = num / 1000;
    return `${tonnes % 1 === 0 ? tonnes : tonnes.toFixed(1)} MT (${num.toLocaleString()} kg)`;
  }
  return `${num.toLocaleString()} kg`;
}

/**
 * Parses PostGIS Point coordinates safely from GeoJSON or WKT string
 */
export function parseVehicleCoordinates(currentLocation) {
  if (!currentLocation) return null;

  // Case 1: GeoJSON Point object { type: 'Point', coordinates: [lng, lat] }
  if (typeof currentLocation === 'object' && Array.isArray(currentLocation.coordinates)) {
    const [lng, lat] = currentLocation.coordinates;
    if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  }

  // Case 2: WKT String "POINT(lng lat)" or "SRID=4326;POINT(lng lat)"
  if (typeof currentLocation === 'string') {
    const match = currentLocation.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) {
      const lng = parseFloat(match[1]);
      const lat = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }
  }

  return null;
}
