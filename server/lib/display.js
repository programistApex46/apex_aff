const GEO_FLAG_CODES = {
  UA: 'ua',
  PL: 'pl',
  DE: 'de',
  US: 'us',
  GB: 'gb',
  CA: 'ca',
  AU: 'au',
  BR: 'br',
  MX: 'mx',
  IN: 'in',
  KZ: 'kz',
};

const GEO_NAMES = {
  UA: 'Ukraine',
  PL: 'Poland',
  DE: 'Germany',
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  BR: 'Brazil',
  MX: 'Mexico',
  IN: 'India',
  KZ: 'Kazakhstan',
};

function geoFlagUrl(geo) {
  if (!geo || typeof geo !== 'string') return null;
  const normalized = geo.trim().toUpperCase();
  const code = GEO_FLAG_CODES[normalized] || normalized.toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return null;
  return `https://flagcdn.com/w20/${code}.png`;
}

function geoFlagEmoji(geo) {
  if (!geo || typeof geo !== 'string') return '';
  const normalized = geo.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '';
  const points = [...normalized].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65);
  return String.fromCodePoint(...points);
}

function geoTableLabel(geo) {
  if (!geo || typeof geo !== 'string') return '—';

  const normalized = geo.trim().toUpperCase();
  const name = GEO_NAMES[normalized];

  if (name) {
    return `${name} | ${normalized}`;
  }

  return geo;
}

function geoTableName(geo) {
  if (!geo || typeof geo !== 'string') return null;
  return GEO_NAMES[geo.trim().toUpperCase()] || null;
}

function formatRequestDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) {
    return raw.replace(/:\d{2}$/, '').slice(0, 16);
  }
  const pad = (n) => String(n).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${yy} | ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getCardDisplayStatus(request) {
  if (!request) {
    return { key: 'sent', label: 'Sent', badge: 'badge-sent' };
  }

  if (request.status === 'draft') {
    return { key: 'draft', label: 'Draft', badge: 'badge-draft' };
  }

  if (request.status === 'new') {
    return { key: 'sent', label: 'Sent', badge: 'badge-sent' };
  }

  if (request.status === 'in_progress') {
    if (request.is_partial || request.has_remainder) {
      return { key: 'in_progress_partial', label: 'In progress · partial', badge: 'badge-progress' };
    }
    return { key: 'in_progress', label: 'In progress', badge: 'badge-progress' };
  }

  if (request.status === 'done') {
    const aggregate = request.aggregate_result_status || request.result_status;
    if (aggregate === 'rejected') {
      return { key: 'rejected', label: 'Rejected', badge: 'badge-rejected' };
    }
    if (aggregate === 'mixed') {
      return { key: 'approved', label: 'Mixed', badge: 'badge-progress' };
    }
    return { key: 'approved', label: 'Approved', badge: 'badge-done' };
  }

  return { key: 'sent', label: 'Sent', badge: 'badge-sent' };
}

function formatRequestProgress(request) {
  if (!request || !request.progress) return '';
  const p = request.progress;
  if (p.total <= 0) return '';

  const parts = [];
  if (p.done > 0) parts.push(`${p.done}/${p.total} done`);
  if (p.inProgress > 0) parts.push(`${p.inProgress} in progress`);
  if (p.available > 0) parts.push(`${p.available} available`);

  return parts.join(', ');
}

function showCompletedDate(request) {
  return !!(request && request.completed_at && request.status === 'done');
}

const TEAM_LABELS = {
  'Alpha Buyers': 'OLG',
  'Beta Media': 'OST',
  'Core Team': 'OLI',
  'North Ops': 'OLG',
};

function formatTeamLabel(name) {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  return TEAM_LABELS[trimmed] || trimmed;
}

function buyerStageTeamClass(teamName) {
  const label = formatTeamLabel(teamName).toUpperCase();
  if (label === 'OLG') return 'rh-buyer-stage--olg';
  if (label === 'OST') return 'rh-buyer-stage--ost';
  if (label === 'OLI') return 'rh-buyer-stage--oli';
  return 'rh-buyer-stage--default';
}

function truncateNote(text, maxLen = 6) {
  if (!text) {
    return { preview: '', isLong: false, full: '' };
  }

  const full = String(text);
  if (full.length <= maxLen) {
    return { preview: full, isLong: false, full };
  }

  return { preview: `${full.slice(0, maxLen)}...`, isLong: true, full };
}

module.exports = {
  geoFlagUrl,
  geoFlagEmoji,
  geoTableLabel,
  geoTableName,
  formatRequestDate,
  getCardDisplayStatus,
  formatRequestProgress,
  showCompletedDate,
  truncateNote,
  formatTeamLabel,
  buyerStageTeamClass,
  TEAM_LABELS,
  GEO_FLAG_CODES,
  GEO_NAMES,
};
