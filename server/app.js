require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const { runMigrations } = require('./db');
const { setUserLocals, requireAuth } = require('./middleware/auth');
const { setAffMobileNav } = require('./middleware/aff-mobile-nav');
const { userStage, USER_COMPANIES } = require('./lib/users');
const {
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
} = require('./lib/display');
const {
  isAffFieldsComplete,
  canAffClaimRequest,
  canAffManageRequest,
  canAffReopenRequest,
} = require('./lib/request-aff');
const { HOME } = require('./lib/paths');
const { addClient } = require('./sse');
const { initTelegramBot } = require('./telegram');
const authRouter = require('./routes/auth');
const webauthnRouter = require('./routes/webauthn');
const requestsRouter = require('./routes/requests');
const usersRouter = require('./routes/users');
const adminUsersRouter = require('./routes/admin/users');
const teamsRouter = require('./routes/teams');
const profileRouter = require('./routes/profile');

runMigrations();
initTelegramBot();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.geoFlagUrl = geoFlagUrl;
app.locals.geoFlagEmoji = geoFlagEmoji;
app.locals.geoTableLabel = geoTableLabel;
app.locals.geoTableName = geoTableName;
app.locals.formatRequestDate = formatRequestDate;
app.locals.getCardDisplayStatus = getCardDisplayStatus;
app.locals.showCompletedDate = showCompletedDate;
app.locals.truncateNote = truncateNote;
app.locals.formatTeamLabel = formatTeamLabel;
app.locals.buyerStageTeamClass = buyerStageTeamClass;
app.locals.formatRequestProgress = formatRequestProgress;
app.locals.canAffClaimRequest = canAffClaimRequest;
app.locals.isAffFieldsComplete = isAffFieldsComplete;
app.locals.canAffManageRequest = canAffManageRequest;
app.locals.canAffReopenRequest = canAffReopenRequest;
app.locals.userStage = userStage;
app.locals.USER_COMPANIES = USER_COMPANIES;

app.use((req, res, next) => {
  res.locals.geoFlagUrl = geoFlagUrl;
  res.locals.geoFlagEmoji = geoFlagEmoji;
  res.locals.geoTableLabel = geoTableLabel;
  res.locals.geoTableName = geoTableName;
  res.locals.formatRequestDate = formatRequestDate;
  res.locals.getCardDisplayStatus = getCardDisplayStatus;
  res.locals.showCompletedDate = showCompletedDate;
  res.locals.truncateNote = truncateNote;
  res.locals.formatTeamLabel = formatTeamLabel;
  res.locals.buyerStageTeamClass = buyerStageTeamClass;
  res.locals.formatRequestProgress = formatRequestProgress;
  res.locals.canAffClaimRequest = canAffClaimRequest;
  res.locals.isAffFieldsComplete = isAffFieldsComplete;
  res.locals.canAffManageRequest = canAffManageRequest;
  res.locals.canAffReopenRequest = canAffReopenRequest;
  res.locals.userStage = userStage;
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'changeme',
    resave: false,
    saveUninitialized: false,
  })
);

app.use(setUserLocals);

app.use(authRouter);
app.use('/webauthn', webauthnRouter);

app.get('/app', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.redirect(HOME);
});

app.use(requireAuth);
app.use(setAffMobileNav);

app.get('/events', (req, res) => {
  addClient(req, res);
});

app.get(/^\/requests(\/.*)?$/, (req, res) => {
  const rest = req.originalUrl.slice('/requests'.length) || '/';
  res.redirect(301, rest.startsWith('?') ? HOME + rest : rest);
});

app.use('/users', usersRouter);
app.use('/teams', teamsRouter);
app.use('/admin/users', adminUsersRouter);
app.use('/profile', profileRouter);
app.use(HOME, requestsRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
