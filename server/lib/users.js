function userStage(user) {
  if (!user) return '';
  return user.stage || user.username || '';
}

function coalesceStageSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `COALESCE(${prefix}stage, ${prefix}username)`;
}

const STAGE_SQL = coalesceStageSql();

const USER_COMPANIES = ['ABB', 'SER', 'AM'];
const COMPANY_ROLES = ['buyer', 'teamlead'];

function roleAllowsCompany(role) {
  return COMPANY_ROLES.includes(role);
}

function normalizeCompany(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim().toUpperCase();
  if (!trimmed) return null;
  return USER_COMPANIES.includes(trimmed) ? trimmed : null;
}

function validateCompany(value) {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (!raw) {
    return { error: null, company: null };
  }

  const company = normalizeCompany(raw);
  if (!company) {
    return { error: 'Invalid company', company: null };
  }

  return { error: null, company };
}

function resolveCompanyForRole(role, value) {
  if (!roleAllowsCompany(role)) {
    return { error: null, company: null };
  }
  return validateCompany(value);
}

module.exports = {
  userStage,
  STAGE_SQL,
  coalesceStageSql,
  USER_COMPANIES,
  COMPANY_ROLES,
  roleAllowsCompany,
  normalizeCompany,
  validateCompany,
  resolveCompanyForRole,
};
