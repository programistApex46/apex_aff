const BASE_CARD_SORT_OPTIONS = [
  { key: 'created_at', label: 'Created' },
  { key: 'id', label: 'ID' },
  { key: 'geo', label: 'GEO' },
  { key: 'language', label: 'Lang' },
  { key: 'quantity', label: 'Cap' },
  { key: 'funnel', label: 'Funnel' },
  { key: 'comment', label: 'Note' },
];

const EXTENDED_CARD_SORT_OPTIONS = [
  { key: 'stage', label: 'Stage' },
  { key: 'team', label: 'Team' },
  { key: 'company', label: 'Org' },
];

const AFF_CARD_SORT_OPTIONS = [
  { key: 'aff', label: 'Aff' },
  { key: 'partner', label: 'Partner' },
  { key: 'aff_cap', label: 'Aff cap' },
  { key: 'aff_wh', label: 'Wh' },
  { key: 'aff_price', label: 'Price' },
  { key: 'aff_status', label: 'Result' },
];

function getCardSortOptions(role) {
  const options = [...BASE_CARD_SORT_OPTIONS];

  if (role !== 'buyer') {
    options.push(...EXTENDED_CARD_SORT_OPTIONS, ...AFF_CARD_SORT_OPTIONS);
  }

  return options;
}

const ALLOWED_PER_PAGE = [10, 25, 50, 100];
const DEFAULT_PER_PAGE = 50;

function parsePerPage(value) {
  const perPage = Number(value);
  return ALLOWED_PER_PAGE.includes(perPage) ? perPage : DEFAULT_PER_PAGE;
}

function getPerPageOptions() {
  return ALLOWED_PER_PAGE.map((value) => ({ value, label: String(value) }));
}

module.exports = {
  getCardSortOptions,
  getPerPageOptions,
  parsePerPage,
  DEFAULT_PER_PAGE,
  ALLOWED_PER_PAGE,
};
