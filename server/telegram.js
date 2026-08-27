const TelegramBot = require('node-telegram-bot-api');
const { getDb } = require('./db');
const { getBotUsername, bindTelegramByCode } = require('./lib/telegram-bind');
const { formatRequestDisplayId } = require('./lib/display');

const token = process.env.TELEGRAM_BOT_TOKEN;

let bot = null;

function initTelegramBot() {
  if (!token || bot) {
    return bot;
  }

  bot = new TelegramBot(token, { polling: true });

  bot.on('polling_error', (err) => {
    console.error('Telegram polling error:', err.message);
  });

  bot.onText(/\/start(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const payload = (match[1] || '').trim();

    if (payload.startsWith('bind_')) {
      const code = payload.slice(5);
      const result = bindTelegramByCode(code, chatId);

      if (result.ok) {
        await bot.sendMessage(
          chatId,
          '✅ Telegram linked to Request Hub.\n\nYou will receive request notifications. Return to Profile and refresh the page.'
        );
      } else {
        await bot.sendMessage(
          chatId,
          '❌ The link has expired or was already used.\n\nOpen Profile in Request Hub → Telegram section → tap Open bot again.'
        );
      }
      return;
    }

    await bot.sendMessage(
      chatId,
      [
        `👋 Hi! I'm the Request Hub bot (@${getBotUsername()}).`,
        '',
        'To receive notifications:',
        '1. Sign in to Request Hub',
        '2. Open Profile',
        '3. In the Telegram section, tap Open bot',
        '4. Tap Start',
        '',
        'You cannot link an account without a personal link from Profile.'
      ].join('\n')
    );
  });

  console.log(`Telegram bot @${getBotUsername()} listening for /start`);
  return bot;
}

const RESULT_STATUS_LABELS = {
  approved: 'Approved',
  rejected: 'Rejected'
};

const RESULT_STATUS_EMOJI = {
  approved: '✅',
  rejected: '❌'
};

async function safeSend(chatId, text) {
  if (!bot) {
    console.error('Telegram bot not configured (TELEGRAM_BOT_TOKEN missing)');
    return;
  }

  if (!chatId) {
    return;
  }

  try {
    await bot.sendMessage(chatId, text);
  } catch (err) {
    console.error(`Telegram send failed (chat_id=${chatId}):`, err.message);
  }
}

function getBuyerContext(buyerId) {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT u.telegram_chat_id AS buyer_chat_id,
             tl.telegram_chat_id AS teamlead_chat_id
      FROM users u
      LEFT JOIN users tl ON u.team_lead_id = tl.id AND tl.is_active = 1
      WHERE u.id = ? AND u.is_active = 1
    `
    )
    .get(buyerId);
}

async function sendUniqueMessages(entries) {
  const seen = new Set();

  for (const { chatId, text } of entries) {
    if (!chatId || !text || seen.has(chatId)) {
      continue;
    }
    seen.add(chatId);
    await safeSend(chatId, text);
  }
}

function formatRequestBasics(request) {
  const remaining = request.remaining_cap ?? request.quantity;
  const lines = [`GEO: ${request.geo}`, `Cap: ${request.quantity}`, `Funnel: ${request.funnel || '—'}`];
  if (Number(remaining) < Number(request.quantity)) {
    lines.push(`Available: ${remaining}`);
  }
  return lines;
}

function formatNewRequestForBuyer(request) {
  return [
    `✅ Your request #${formatRequestDisplayId(request)} has been created and sent`,
    `Stage: ${request.buyer_stage}`,
    ...formatRequestBasics(request)
  ].join('\n');
}

function formatNewRequestForTeamlead(request) {
  return [
    `🆕 Buyer ${request.buyer_stage} created and sent request #${formatRequestDisplayId(request)}`,
    ...formatRequestBasics(request)
  ].join('\n');
}

function formatRequestClaimedForBuyer(request, affUser, claimResult) {
  const took = Number(claimResult.remainingAfter === 0
    ? request.quantity - (request.progress?.available ?? 0)
    : request.quantity - claimResult.remainingAfter);

  if (claimResult.tookAllRemaining && !request.is_split) {
    return [
      `🔄 Request #${request.id} taken in progress`,
      `Aff: ${affUser.stage || affUser.username}`,
      `Cap: ${claimResult.remainingAfter === 0 ? request.quantity : took}`
    ].join('\n');
  }

  return [
    `✂️ Request #${request.id} has been split`,
    `Aff: ${affUser.stage || affUser.username}`,
    `Claimed: ${request.quantity - claimResult.remainingAfter - (request.progress?.claimed ?? 0) + (request.my_assignment?.cap_taken ?? took)} of ${request.quantity}`,
    `Still available: ${claimResult.remainingAfter}`
  ].join('\n');
}

function formatRequestClaimedForTeamlead(request, affUser, claimResult) {
  return [
    `✂️ Team request #${request.id} split update`,
    `Buyer: ${request.buyer_stage}`,
    `Aff: ${affUser.stage || affUser.username}`,
    `Still available: ${claimResult.remainingAfter} of ${request.quantity}`
  ].join('\n');
}

function formatAssignmentDoneForBuyer(request, assignment, meta) {
  const emoji = RESULT_STATUS_EMOJI[assignment.result_status] || '📊';
  const statusLabel = RESULT_STATUS_LABELS[assignment.result_status] || assignment.result_status;
  const pieceCap = assignment.result_quantity ?? assignment.cap_taken;

  if (!meta.requestFullyDone) {
    return [
      `${emoji} Part of request #${request.id} completed (${pieceCap} of ${assignment.cap_taken})`,
      `Status: ${statusLabel}`,
      `Progress: ${meta.progress.done}/${meta.progress.total} done, ${meta.progress.available} available`
    ].join('\n');
  }

  return [
    `${emoji} Request #${request.id} completed`,
    `Status: ${statusLabel}`,
    `Total cap: ${request.quantity}`,
    `Completed: ${meta.progress.done}/${meta.progress.total}`,
    `Approved: ${meta.progress.approved}, Rejected: ${meta.progress.rejected}`,
    `Details: ${assignment.result_details || '—'}`
  ].join('\n');
}

function formatAssignmentDoneForTeamlead(request, assignment, meta) {
  const emoji = RESULT_STATUS_EMOJI[assignment.result_status] || '📊';
  const statusLabel = RESULT_STATUS_LABELS[assignment.result_status] || assignment.result_status;
  const affStage = assignment.aff_stage || '—';
  const pieceCap = assignment.result_quantity ?? assignment.cap_taken;

  if (!meta.requestFullyDone) {
    return [
      `${emoji} Part of team request #${request.id} completed`,
      `Buyer: ${request.buyer_stage}`,
      `Aff: ${affStage}`,
      `Piece: ${pieceCap} of ${assignment.cap_taken}`,
      `Progress: ${meta.progress.done}/${meta.progress.total} done`
    ].join('\n');
  }

  return [
    `${emoji} Team request #${request.id} completed`,
    `Buyer: ${request.buyer_stage}`,
    `Aff: ${affStage}`,
    `Status: ${statusLabel}`,
    `Total: ${meta.progress.done}/${meta.progress.total}`,
    `Details: ${assignment.result_details || '—'}`
  ].join('\n');
}

async function notifyNewRequest(request) {
  try {
    const ctx = getBuyerContext(request.buyer_id);
    const entries = [];

    if (ctx?.buyer_chat_id) {
      entries.push({
        chatId: ctx.buyer_chat_id,
        text: formatNewRequestForBuyer(request)
      });
    }

    if (ctx?.teamlead_chat_id) {
      entries.push({
        chatId: ctx.teamlead_chat_id,
        text: formatNewRequestForTeamlead(request)
      });
    }

    if (entries.length === 0) {
      console.error(`No telegram recipients for new request #${request.id}`);
      return;
    }

    await sendUniqueMessages(entries);
  } catch (err) {
    console.error('notifyNewRequest failed:', err.message);
  }
}

async function notifyRequestClaimed(request, affUser, claimResult, remainderRequest) {
  try {
    const ctx = getBuyerContext(request.buyer_id);
    const entries = [];
    const affLabel = affUser.stage || affUser.username;

    if (ctx?.buyer_chat_id) {
      if (claimResult.split && remainderRequest) {
        entries.push({
          chatId: ctx.buyer_chat_id,
          text: [
            `✂️ Request #${formatRequestDisplayId(request)} has been split`,
            `Aff: ${affLabel} claimed ${claimResult.capTaken} of ${request.quantity}`,
            `Part: #${formatRequestDisplayId(remainderRequest)} (${claimResult.capTaken} leads)`,
          ].join('\n'),
        });
      } else {
        entries.push({
          chatId: ctx.buyer_chat_id,
          text: [
            `🔄 Request #${formatRequestDisplayId(request)} taken in progress`,
            `Aff: ${affLabel}`,
            `Cap: ${claimResult.capTaken}`,
          ].join('\n'),
        });
      }
    }

    if (ctx?.teamlead_chat_id && claimResult.split && remainderRequest) {
      entries.push({
        chatId: ctx.teamlead_chat_id,
        text: [
          `✂️ Team request #${formatRequestDisplayId(request)} split`,
          `Buyer: ${request.buyer_stage}`,
          `Aff: ${affLabel} claimed ${claimResult.capTaken}`,
          `Part: #${formatRequestDisplayId(remainderRequest)} (${claimResult.capTaken} leads)`,
        ].join('\n'),
      });
    }

    if (entries.length === 0) return;
    await sendUniqueMessages(entries);
  } catch (err) {
    console.error('notifyRequestClaimed failed:', err.message);
  }
}

async function notifyAssignmentDone(request) {
  try {
    const ctx = getBuyerContext(request.buyer_id);
    const entries = [];
    const emoji = RESULT_STATUS_EMOJI[request.result_status] || '📊';
    const statusLabel = RESULT_STATUS_LABELS[request.result_status] || request.result_status;
    const pieceCap = request.result_quantity ?? request.quantity;

    if (ctx?.buyer_chat_id) {
      entries.push({
        chatId: ctx.buyer_chat_id,
        text: [
          `${emoji} Request #${formatRequestDisplayId(request)} completed`,
          `Status: ${statusLabel}`,
          `Cap: ${pieceCap}`,
          `Details: ${request.result_details || '—'}`,
        ].join('\n'),
      });
    }

    if (ctx?.teamlead_chat_id) {
      entries.push({
        chatId: ctx.teamlead_chat_id,
        text: [
          `${emoji} Team request #${formatRequestDisplayId(request)} completed`,
          `Buyer: ${request.buyer_stage}`,
          `Aff: ${request.taken_by_stage || '—'}`,
          `Status: ${statusLabel}`,
          `Cap: ${pieceCap}`,
          `Details: ${request.result_details || '—'}`,
        ].join('\n'),
      });
    }

    if (entries.length === 0) {
      console.error(`No telegram recipients for completed request #${request.id}`);
      return;
    }

    await sendUniqueMessages(entries);
  } catch (err) {
    console.error('notifyAssignmentDone failed:', err.message);
  }
}

async function notifyRequestDone(request) {
  return notifyAssignmentDone(request);
}

module.exports = {
  initTelegramBot,
  safeSend,
  notifyNewRequest,
  notifyRequestClaimed,
  notifyAssignmentDone,
  notifyRequestDone,
};
