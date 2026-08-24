/**
 * Request split model: one aff per request row.
 * Partial take → original row goes to aff (reduced qty); remainder → new unassigned child (split_from_id).
 */

function hasTable(db, table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some((col) => col.name === column);
}

function ensureAssignmentSchema(db) {
  if (!hasColumn(db, 'requests', 'remaining_cap')) {
    db.exec('ALTER TABLE requests ADD COLUMN remaining_cap INTEGER');
    db.exec(`
      UPDATE requests
      SET remaining_cap = quantity
      WHERE remaining_cap IS NULL
    `);
  }

  if (!hasColumn(db, 'requests', 'split_from_id')) {
    db.exec(`
      ALTER TABLE requests ADD COLUMN split_from_id INTEGER REFERENCES requests(id)
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_requests_split_from_id ON requests(split_from_id)
    `);
  }

  if (!hasTable(db, 'request_split_meta')) {
    db.exec(`
      CREATE TABLE request_split_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  migrateFromAssignmentPoolOnce(db);
  repairLegacyPartialTakesOnce(db);
}

function splitMetaGet(db, key) {
  if (!hasTable(db, 'request_split_meta')) return null;
  const row = db.prepare('SELECT value FROM request_split_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function splitMetaSet(db, key, value) {
  db.prepare(`
    INSERT INTO request_split_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function copyRequestFieldsForSplit(source) {
  return {
    buyer_id: source.buyer_id,
    stage: source.stage,
    geo: source.geo,
    language: source.language,
    quantity: source.quantity,
    funnel: source.funnel,
    comment: source.comment,
  };
}

function insertRemainderRequest(db, source, remainderQty, splitFromId) {
  const info = db
    .prepare(`
      INSERT INTO requests (
        buyer_id, stage, geo, language, quantity, funnel, comment,
        status, split_from_id, remaining_cap
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
    `)
    .run(
      source.buyer_id,
      source.stage,
      source.geo,
      source.language,
      remainderQty,
      source.funnel,
      source.comment,
      splitFromId,
      remainderQty,
    );
  return info.lastInsertRowid;
}

function migrateFromAssignmentPoolOnce(db) {
  if (splitMetaGet(db, 'child_split_v1') === 'done') return;

  const migrate = db.transaction(() => {
    if (hasTable(db, 'request_assignments')) {
      const assignmentRows = db
        .prepare(`
          SELECT r.*,
            (
              SELECT COUNT(*)
              FROM request_assignments ra
              WHERE ra.request_id = r.id AND ra.status != 'cancelled'
            ) AS assignment_count
          FROM requests r
          WHERE r.id IN (
            SELECT DISTINCT request_id FROM request_assignments WHERE status != 'cancelled'
          )
        `)
        .all();

      for (const row of assignmentRows) {
        const assignments = db
          .prepare(`
            SELECT * FROM request_assignments
            WHERE request_id = ? AND status != 'cancelled'
            ORDER BY taken_at ASC, id ASC
          `)
          .all(row.id);

        if (!assignments.length) continue;

        const primary = assignments.find((a) => a.status === 'in_progress') || assignments[0];
        const remaining = Math.max(0, Number(row.remaining_cap) || 0);

        db.prepare(`
          UPDATE requests
          SET quantity = ?,
              taken_by_id = ?,
              partner = ?,
              aff_geo = ?,
              aff_language = ?,
              aff_wh = ?,
              aff_price = ?,
              result_status = ?,
              result_details = ?,
              result_quantity = ?,
              status = CASE WHEN ? = 'done' THEN 'done' WHEN ? = 'in_progress' THEN 'in_progress' ELSE status END,
              remaining_cap = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          primary.cap_taken,
          primary.aff_id,
          primary.partner,
          primary.aff_geo,
          primary.aff_language,
          primary.aff_wh,
          primary.aff_price,
          primary.result_status,
          primary.result_details,
          primary.result_quantity ?? primary.cap_taken,
          primary.status,
          primary.status,
          primary.cap_taken,
          row.id,
        );

        if (remaining > 0) {
          insertRemainderRequest(db, row, remaining, row.id);
        }

        for (const extra of assignments) {
          if (extra.id === primary.id) continue;
          const childId = db
            .prepare(`
              INSERT INTO requests (
                buyer_id, stage, geo, language, quantity, funnel, comment,
                status, taken_by_id, split_from_id, remaining_cap,
                partner, aff_geo, aff_language, aff_wh, aff_price,
                result_status, result_details, result_quantity, completed_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              row.buyer_id,
              row.stage,
              row.geo,
              row.language,
              extra.cap_taken,
              row.funnel,
              row.comment,
              extra.status === 'done' ? 'done' : 'in_progress',
              extra.aff_id,
              row.id,
              extra.cap_taken,
              extra.partner,
              extra.aff_geo,
              extra.aff_language,
              extra.aff_wh,
              extra.aff_price,
              extra.result_status,
              extra.result_details,
              extra.result_quantity ?? extra.cap_taken,
              extra.completed_at,
            ).lastInsertRowid;

          if (extra.status === 'done' && !extra.completed_at) {
            db.prepare('UPDATE requests SET completed_at = updated_at WHERE id = ?').run(childId);
          }
        }

        db.prepare('DELETE FROM request_assignments WHERE request_id = ?').run(row.id);
      }
    }

    const pooled = db
      .prepare(`
        SELECT *
        FROM requests
        WHERE COALESCE(remaining_cap, quantity) < quantity
          AND taken_by_id IS NULL
          AND status IN ('new', 'in_progress')
          AND split_from_id IS NULL
      `)
      .all();

    for (const row of pooled) {
      const remaining = Math.max(0, Number(row.remaining_cap ?? 0));
      if (remaining <= 0) continue;
      const takenQty = Number(row.quantity) - remaining;
      if (takenQty <= 0) continue;

      db.prepare(`
        UPDATE requests
        SET quantity = ?, remaining_cap = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(takenQty, takenQty, row.id);

      insertRemainderRequest(db, row, remaining, row.id);
    }

    db.prepare(`
      UPDATE requests
      SET remaining_cap = quantity
      WHERE remaining_cap IS NULL
    `).run();

    splitMetaSet(db, 'child_split_v1', 'done');
  });

  migrate();
}

function repairLegacyPartialTakesOnce(db) {
  if (splitMetaGet(db, 'legacy_partial_take_v1') === 'done') return;

  const repair = db.transaction(() => {
    const rows = db
      .prepare(`
        SELECT *
        FROM requests
        WHERE status = 'in_progress'
          AND taken_by_id IS NOT NULL
          AND COALESCE(remaining_cap, quantity) < quantity
          AND NOT EXISTS (
            SELECT 1
            FROM requests child
            WHERE child.split_from_id = requests.id
          )
      `)
      .all();

    for (const row of rows) {
      const remaining = Math.max(0, Number(row.remaining_cap ?? 0));
      if (remaining <= 0 || remaining >= Number(row.quantity)) continue;

      let takenQty = Number(row.quantity) - remaining;
      const resultQty = Number(row.result_quantity);
      if (Number.isInteger(resultQty) && resultQty > 0 && resultQty < Number(row.quantity)) {
        takenQty = resultQty;
      }

      const remainderQty = Number(row.quantity) - takenQty;
      if (remainderQty <= 0 || takenQty <= 0) continue;

      db.prepare(`
        UPDATE requests
        SET quantity = ?,
            remaining_cap = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(takenQty, takenQty, row.id);

      insertRemainderRequest(db, row, remainderQty, row.id);
    }

    splitMetaSet(db, 'legacy_partial_take_v1', 'done');
  });

  repair();
}

function parseCapTaken(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount <= 0) return null;
  return amount;
}

function getAvailableLeads(request) {
  if (!request || request.status !== 'new' || request.taken_by_id) return 0;
  return Number(request.quantity);
}

function hasOpenRemainderDescendant(db, requestId) {
  const row = db
    .prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM requests WHERE split_from_id = ?
        UNION ALL
        SELECT r.id
        FROM requests r
        INNER JOIN descendants d ON r.split_from_id = d.id
      )
      SELECT COUNT(*) AS c
      FROM requests r
      INNER JOIN descendants d ON r.id = d.id
      WHERE r.status = 'new' AND r.taken_by_id IS NULL
    `)
    .get(requestId);
  return row.c > 0;
}
function getSplitChildren(db, requestId) {
  ensureAssignmentSchema(db);
  return db
    .prepare(`
      SELECT *
      FROM requests
      WHERE split_from_id = ?
      ORDER BY id ASC
    `)
    .all(requestId);
}

function getSplitRootId(db, request) {
  if (!request?.split_from_id) return null;

  let currentId = request.split_from_id;
  for (let i = 0; i < 32; i += 1) {
    const row = db.prepare('SELECT id, split_from_id FROM requests WHERE id = ?').get(currentId);
    if (!row) return currentId;
    if (!row.split_from_id) return row.id;
    currentId = row.split_from_id;
  }

  return currentId;
}

function countSplitTreeMembers(db, rootId) {
  ensureAssignmentSchema(db);
  const row = db
    .prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM requests WHERE split_from_id = ?
        UNION ALL
        SELECT r.id
        FROM requests r
        INNER JOIN descendants d ON r.split_from_id = d.id
      )
      SELECT COUNT(*) AS c FROM descendants
    `)
    .get(rootId);
  return Number(row?.c || 0) + 1;
}

function getSplitInsertAfterId(db, rootId, requestId) {
  if (!rootId || !requestId || rootId === requestId) return null;

  const row = db
    .prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM requests WHERE id = ?
        UNION ALL
        SELECT r.id
        FROM requests r
        INNER JOIN tree t ON r.split_from_id = t.id
      )
      SELECT MAX(id) AS max_id
      FROM tree
      WHERE id < ?
    `)
    .get(rootId, requestId);

  return row?.max_id || rootId;
}

function countSplitAffs(db, rootId) {
  ensureAssignmentSchema(db);
  const row = db
    .prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM requests WHERE id = ?
        UNION ALL
        SELECT r.id
        FROM requests r
        INNER JOIN tree t ON r.split_from_id = t.id
      )
      SELECT COUNT(DISTINCT taken_by_id) AS c
      FROM requests
      WHERE id IN (SELECT id FROM tree)
        AND taken_by_id IS NOT NULL
    `)
    .get(rootId);
  return Number(row?.c || 0);
}

function annotateSplitDisplayMeta(requests) {
  let i = 0;

  while (i < requests.length) {
    const root = requests[i];
    if (root.is_subtask) {
      i += 1;
      continue;
    }

    const group = [root];
    let j = i + 1;
    while (j < requests.length && requests[j].is_subtask) {
      const childRoot = requests[j].split_root_id;
      if (childRoot && childRoot !== root.id) break;
      group.push(requests[j]);
      j += 1;
    }

    if (group.length > 1) {
      const affIds = new Set();
      for (const member of group) {
        if (member.taken_by_id) affIds.add(String(member.taken_by_id));
      }

      for (let k = 0; k < group.length; k += 1) {
        const member = group[k];
        member.is_split_member = true;
        member.is_split_root = k === 0;
        member.split_root_id = root.id;
        member.split_group_size = group.length;
        member.split_aff_count = affIds.size;
        member.split_group_index = k;
        member.split_group_first = k === 0;
        member.split_group_last = k === group.length - 1;
        member.split_group_middle = k > 0 && k < group.length - 1;
      }
    }

    i = j;
  }

  return requests;
}

function enrichRequest(db, request) {
  if (!request) return request;
  ensureAssignmentSchema(db);

  const split_children = getSplitChildren(db, request.id);
  const has_remainder = hasOpenRemainderDescendant(db, request.id);
  const is_subtask = !!request.split_from_id;

  let split_tree_root_id = null;
  if (is_subtask) {
    split_tree_root_id = getSplitRootId(db, request);
  } else if (split_children.length > 0 || has_remainder) {
    split_tree_root_id = request.id;
  }

  const split_tree_size = split_tree_root_id
    ? countSplitTreeMembers(db, split_tree_root_id)
    : 1;
  const is_split_tree_root = split_tree_root_id === request.id && split_tree_size > 1;
  const split_root_id = is_subtask ? split_tree_root_id : (is_split_tree_root ? request.id : null);
  const is_split_root = is_split_tree_root;
  const available_leads = getAvailableLeads(request);
  const split_group_size = is_split_tree_root ? split_tree_size : null;
  const split_aff_count = is_split_tree_root ? countSplitAffs(db, request.id) : null;
  const split_insert_after_id = is_subtask && split_tree_root_id
    ? getSplitInsertAfterId(db, split_tree_root_id, request.id)
    : null;

  return {
    ...request,
    remaining_cap: available_leads,
    available_leads,
    split_children,
    split_root_id,
    split_insert_after_id,
    split_tree_root_id,
    split_tree_size,
    has_remainder,
    is_partial: request.status === 'in_progress' && is_split_tree_root,
    is_subtask,
    is_split_root,
    is_split_member: is_subtask || is_split_tree_root,
    is_split: is_split_tree_root || is_subtask,
    split_group_size,
    split_aff_count,
    has_available_cap: available_leads > 0,
    assignments: [],
    progress: null,
    my_assignment: null,
  };
}

function enrichRequestForUser(db, request, user) {
  return enrichRequest(db, request);
}

function enrichRequests(db, requests, user) {
  return requests.map((request) => enrichRequestForUser(db, request, user));
}

function nestRequestsForDisplay(requests) {
  const byId = new Map(requests.map((r) => [r.id, r]));
  const childMap = new Map();

  for (const request of requests) {
    if (request.split_from_id && byId.has(request.split_from_id)) {
      if (!childMap.has(request.split_from_id)) childMap.set(request.split_from_id, []);
      childMap.get(request.split_from_id).push(request);
    }
  }

  for (const children of childMap.values()) {
    children.sort((a, b) => a.id - b.id);
  }

  const placed = new Set();
  const result = [];

  function collectAllDescendants(requestId) {
    const out = [];

    function walk(id) {
      for (const child of childMap.get(id) || []) {
        out.push(child);
        walk(child.id);
      }
    }

    walk(requestId);
    return out.sort((a, b) => a.id - b.id);
  }

  function appendSplitGroup(request) {
    if (placed.has(request.id)) return;
    result.push({ ...request, is_subtask: false, nest_depth: 0 });
    placed.add(request.id);

    for (const descendant of collectAllDescendants(request.id)) {
      result.push({ ...descendant, is_subtask: true, nest_depth: 1 });
      placed.add(descendant.id);
    }
  }

  for (const request of requests) {
    if (placed.has(request.id)) continue;
    if (request.split_from_id && byId.has(request.split_from_id)) continue;
    appendSplitGroup(request);
  }

  for (const request of requests) {
    if (!placed.has(request.id)) {
      appendSplitGroup(request);
    }
  }

  return annotateSplitDisplayMeta(result);
}

function takeRequest(db, requestId, affId, capTaken) {
  ensureAssignmentSchema(db);
  const amount = parseCapTaken(capTaken);

  if (amount === null) {
    return { ok: false, error: 'Enter a whole number greater than 0' };
  }

  return db.transaction(() => {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) return { ok: false, error: 'Request not found' };
    if (request.status === 'draft') return { ok: false, error: 'Request is not available yet' };
    if (request.status === 'done') return { ok: false, error: 'Request is already completed' };
    if (request.taken_by_id) return { ok: false, error: 'Request is already taken' };

    const total = getAvailableLeads(request);
    if (total <= 0) {
      return { ok: false, error: 'Request is not available to take' };
    }
    if (amount > total) {
      return {
        ok: false,
        error: `Only ${total} lead${total === 1 ? '' : 's'} available`,
        remaining: total,
      };
    }

    if (amount === total) {
      db.prepare(`
        UPDATE requests
        SET taken_by_id = ?,
            status = 'in_progress',
            quantity = ?,
            remaining_cap = ?,
            result_quantity = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(affId, amount, amount, amount, requestId);

      return {
        ok: true,
        requestId,
        capTaken: amount,
        split: false,
        remainderRequestId: null,
      };
    }

    const remainder = total - amount;

    db.prepare(`
      UPDATE requests
      SET quantity = ?,
          taken_by_id = ?,
          status = 'in_progress',
          remaining_cap = ?,
          result_quantity = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(amount, affId, amount, amount, requestId);

    const remainderRequestId = insertRemainderRequest(db, request, remainder, requestId);

    return {
      ok: true,
      requestId,
      capTaken: amount,
      split: true,
      remainder,
      remainderRequestId,
    };
  })();
}

function findReleaseMergeTarget(db, request) {
  const direct = db
    .prepare(`
      SELECT id
      FROM requests
      WHERE split_from_id = ?
        AND status = 'new'
        AND taken_by_id IS NULL
      ORDER BY id ASC
      LIMIT 1
    `)
    .get(request.id);
  if (direct) return direct.id;

  if (request.split_from_id) {
    const sibling = db
      .prepare(`
        SELECT id
        FROM requests
        WHERE split_from_id = ?
          AND status = 'new'
          AND taken_by_id IS NULL
          AND id != ?
        ORDER BY id ASC
        LIMIT 1
      `)
      .get(request.split_from_id, request.id);
    if (sibling) return sibling.id;
  }

  return null;
}

function releaseRequest(db, requestId, affId) {
  ensureAssignmentSchema(db);

  return db.transaction(() => {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) return { ok: false, error: 'Request not found' };
    if (request.taken_by_id !== affId) return { ok: false, error: 'Not your request' };
    if (request.status !== 'in_progress') {
      return { ok: false, error: 'Cannot release this request' };
    }

    const qty = Number(request.quantity);
    const mergeTargetId = findReleaseMergeTarget(db, request);

    if (mergeTargetId && qty > 0) {
      db.prepare(`
        UPDATE requests
        SET quantity = quantity + ?,
            remaining_cap = remaining_cap + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(qty, qty, mergeTargetId);

      const otherChildren = db
        .prepare(`
          SELECT COUNT(*) AS c
          FROM requests
          WHERE split_from_id = ? AND id != ?
        `)
        .get(requestId, mergeTargetId).c;

      if (otherChildren > 0) {
        db.prepare(`
          UPDATE requests
          SET split_from_id = ?
          WHERE split_from_id = ? AND id != ?
        `).run(mergeTargetId, requestId, mergeTargetId);

        db.prepare(`
          UPDATE requests
          SET split_from_id = NULL
          WHERE id = ?
        `).run(mergeTargetId);
      } else if (request.split_from_id) {
        db.prepare(`
          UPDATE requests
          SET split_from_id = ?
          WHERE id = ?
        `).run(request.split_from_id, mergeTargetId);
      } else {
        db.prepare(`
          UPDATE requests
          SET split_from_id = NULL
          WHERE id = ?
        `).run(mergeTargetId);
      }

      db.prepare('DELETE FROM requests WHERE id = ?').run(requestId);

      return {
        ok: true,
        requestId,
        mergedInto: mergeTargetId,
        deleted: true,
      };
    }

    db.prepare(`
      UPDATE requests
      SET taken_by_id = NULL,
          status = 'new',
          partner = NULL,
          aff_geo = NULL,
          aff_language = NULL,
          aff_wh = NULL,
          aff_price = NULL,
          result_status = NULL,
          result_details = NULL,
          result_quantity = NULL,
          remaining_cap = quantity,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(requestId);

    return { ok: true, requestId };
  })();
}

function updateAffFields(db, requestId, affId, fields) {
  ensureAssignmentSchema(db);

  return db.transaction(() => {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) return { ok: false, error: 'Request not found' };
    if (request.taken_by_id !== affId) return { ok: false, error: 'Not your request' };
    if (request.status !== 'in_progress') {
      return { ok: false, error: 'Request is not in progress' };
    }

    const affCap = Number(fields.result_quantity);
    const currentQty = Number(request.quantity);
    let remainderRequestId = null;
    let split = false;

    if (!Number.isInteger(affCap) || affCap <= 0) {
      return { ok: false, error: 'Cap must be a whole number greater than 0' };
    }

    if (affCap > currentQty) {
      return {
        ok: false,
        error: `Cap cannot exceed request quantity (${currentQty})`,
      };
    }

    if (affCap < currentQty) {
      const remainder = currentQty - affCap;
      db.prepare(`
        UPDATE requests
        SET quantity = ?,
            remaining_cap = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(affCap, affCap, requestId);

      remainderRequestId = insertRemainderRequest(db, request, remainder, requestId);
      split = true;
    }

    db.prepare(`
      UPDATE requests
      SET aff_geo = ?,
          aff_language = ?,
          partner = ?,
          aff_wh = ?,
          aff_price = ?,
          result_quantity = ?,
          remaining_cap = quantity,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      fields.aff_geo,
      fields.aff_language,
      fields.partner,
      fields.aff_wh,
      fields.aff_price,
      affCap,
      requestId,
    );

    return {
      ok: true,
      requestId,
      split,
      remainderRequestId,
      capTaken: affCap,
      remainder: split ? currentQty - affCap : 0,
    };
  })();
}

function completeRequest(db, requestId, affId, result) {
  ensureAssignmentSchema(db);

  return db.transaction(() => {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) return { ok: false, error: 'Request not found' };
    if (request.taken_by_id !== affId) return { ok: false, error: 'Not your request' };
    if (request.status !== 'in_progress') {
      return { ok: false, error: 'Request is not in progress' };
    }

    db.prepare(`
      UPDATE requests
      SET status = 'done',
          result_status = ?,
          result_details = ?,
          result_quantity = ?,
          aff_geo = COALESCE(?, aff_geo),
          aff_wh = COALESCE(?, aff_wh),
          aff_price = COALESCE(?, aff_price),
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      result.result_status,
      result.result_details,
      result.result_quantity,
      result.aff_geo,
      result.aff_wh,
      result.aff_price,
      requestId,
    );

    return {
      ok: true,
      requestId,
      requestFullyDone: true,
    };
  })();
}

function reopenRequest(db, requestId, affId) {
  ensureAssignmentSchema(db);

  return db.transaction(() => {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) return { ok: false, error: 'Request not found' };
    if (request.taken_by_id !== affId) return { ok: false, error: 'Not your request' };
    if (request.status !== 'done') return { ok: false, error: 'Request is not completed' };

    db.prepare(`
      UPDATE requests
      SET status = 'in_progress',
          result_status = NULL,
          result_details = NULL,
          completed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(requestId);

    return { ok: true, requestId };
  })();
}

function setRemainingCapOnCreate(db, requestId, quantity) {
  ensureAssignmentSchema(db);
  db.prepare(`
    UPDATE requests
    SET remaining_cap = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(quantity, requestId);
}

function validateQuantityEdit(db, requestId, newQuantity) {
  ensureAssignmentSchema(db);
  const request = db.prepare('SELECT quantity, status, taken_by_id FROM requests WHERE id = ?').get(requestId);
  if (!request) return { ok: false, error: 'Request not found' };

  const qty = Number(newQuantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    return { ok: false, error: 'Cap must be a whole number greater than 0' };
  }

  if (request.taken_by_id && request.status === 'in_progress' && qty < request.quantity) {
    return { ok: false, error: 'Cannot reduce cap below taken amount while in progress' };
  }

  return { ok: true };
}

function applyQuantityEdit(db, requestId, newQuantity) {
  const validation = validateQuantityEdit(db, requestId, newQuantity);
  if (!validation.ok) return validation;

  db.prepare(`
    UPDATE requests
    SET quantity = ?, remaining_cap = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newQuantity, newQuantity, requestId);

  return { ok: true };
}

function aggregateResultStatus(request) {
  return request?.result_status || null;
}

module.exports = {
  ensureAssignmentSchema,
  getSplitChildren,
  parseCapTaken,
  getAvailableLeads,
  enrichRequest,
  enrichRequestForUser,
  enrichRequests,
  nestRequestsForDisplay,
  takeRequest,
  claimAssignment: takeRequest,
  releaseRequest,
  cancelAssignment: releaseRequest,
  updateAffFields,
  updateAssignmentFields: updateAffFields,
  completeRequest,
  completeAssignment: completeRequest,
  reopenRequest,
  reopenAssignment: reopenRequest,
  setRemainingCapOnCreate,
  validateQuantityEdit,
  applyQuantityEdit,
  aggregateResultStatus,
};
