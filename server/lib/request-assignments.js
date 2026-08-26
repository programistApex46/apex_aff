/**
 * Request split model: one aff per request row.
 * Full take → same row goes to aff (in_progress).
 * Partial take → original (root) stays open; new child row for taken cap (split_from_id).
 * Root closes when pool is empty and all children are done.
 */

const { nextRootRequestId, requestsUseTextIds, compareRequestIds } = require('./request-id');

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

  if (!hasColumn(db, 'requests', 'split_part')) {
    db.exec('ALTER TABLE requests ADD COLUMN split_part INTEGER');
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_split_part
      ON requests(split_from_id, split_part)
      WHERE split_from_id IS NOT NULL AND split_part IS NOT NULL
    `);
  }

  if (!hasColumn(db, 'requests', 'display_ref')) {
    db.exec('ALTER TABLE requests ADD COLUMN display_ref TEXT');
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_display_ref
      ON requests(display_ref)
      WHERE display_ref IS NOT NULL
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
  repairParentStaysSplitModelOnce(db);
  flattenNestedSplitChildrenOnce(db);
  repairSplitTreeIntegrityOnce(db);
  backfillDisplayRefsOnce(db);
  migrateRequestTextIdsOnce(db);
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

function nextSplitPartNumber(db, rootId) {
  const row = db
    .prepare('SELECT COALESCE(MAX(split_part), 0) + 1 AS n FROM requests WHERE split_from_id = ?')
    .get(rootId);
  return Number(row?.n || 1);
}

function resolveDisplayRef(request) {
  if (!request) return '';
  return String(request.id ?? '');
}

function insertTakenChildRequest(db, source, takenQty, splitFromId, affId) {
  const splitPart = nextSplitPartNumber(db, splitFromId);

  if (requestsUseTextIds(db)) {
    const childId = `${splitFromId}/${splitPart}`;
    db.prepare(`
      INSERT INTO requests (
        id, buyer_id, stage, geo, language, quantity, funnel, comment,
        status, split_from_id, split_part, remaining_cap, taken_by_id, result_quantity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, ?)
    `).run(
      childId,
      source.buyer_id,
      source.stage,
      source.geo,
      source.language,
      takenQty,
      source.funnel,
      source.comment,
      splitFromId,
      splitPart,
      takenQty,
      affId,
      takenQty,
    );
    return childId;
  }

  const info = db
    .prepare(`
      INSERT INTO requests (
        buyer_id, stage, geo, language, quantity, funnel, comment,
        status, split_from_id, split_part, remaining_cap, taken_by_id, result_quantity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, ?)
    `)
    .run(
      source.buyer_id,
      source.stage,
      source.geo,
      source.language,
      takenQty,
      source.funnel,
      source.comment,
      splitFromId,
      splitPart,
      takenQty,
      affId,
      takenQty,
    );
  return info.lastInsertRowid;
}

function resolveSplitRootId(db, request) {
  if (!request) return null;
  if (!request.split_from_id) return request.id;
  return getSplitRootId(db, request);
}

function getRootPoolCap(db, rootId) {
  const root = db.prepare('SELECT * FROM requests WHERE id = ?').get(rootId);
  if (!root || root.status !== 'new' || root.taken_by_id) return 0;
  return Math.max(0, Number(root.remaining_cap ?? root.quantity ?? 0));
}

function decrementRootPool(db, rootId, amount) {
  db.prepare(`
    UPDATE requests
    SET remaining_cap = COALESCE(remaining_cap, quantity) - ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(amount, rootId);
}

function countDirectSplitChildren(db, rootId) {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM requests WHERE split_from_id = ?')
    .get(rootId);
  return Number(row?.c || 0);
}

function maybeCloseSplitRoot(db, rootId) {
  const root = db.prepare('SELECT * FROM requests WHERE id = ?').get(rootId);
  if (!root || root.taken_by_id || root.status === 'done') return null;

  const openPool = getRootPoolCap(db, rootId);
  if (openPool > 0) return null;

  const row = db
    .prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM requests WHERE split_from_id = ?
        UNION ALL
        SELECT r.id
        FROM requests r
        INNER JOIN tree t ON r.split_from_id = t.id
      )
      SELECT COUNT(*) AS c
      FROM requests r
      INNER JOIN tree t ON r.id = t.id
      WHERE r.status != 'done'
    `)
    .get(rootId);
  if (Number(row?.c || 0) > 0) return null;

  db.prepare(`
    UPDATE requests
    SET status = 'done',
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(rootId);

  return rootId;
}

function repairParentStaysSplitModelOnce(db) {
  if (splitMetaGet(db, 'parent_stays_split_v1') === 'done') return;

  const repair = db.transaction(() => {
    const poolChildren = db
      .prepare(`
        SELECT *
        FROM requests
        WHERE status = 'new'
          AND taken_by_id IS NULL
          AND split_from_id IS NOT NULL
      `)
      .all();

    for (const child of poolChildren) {
      const rootId = resolveSplitRootId(db, child);
      if (!rootId) continue;
      db.prepare(`
        UPDATE requests
        SET remaining_cap = COALESCE(remaining_cap, quantity) + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(child.quantity, rootId);
      db.prepare('DELETE FROM requests WHERE id = ?').run(child.id);
    }

    const takenRoots = db
      .prepare(`
        SELECT *
        FROM requests
        WHERE status = 'in_progress'
          AND taken_by_id IS NOT NULL
          AND split_from_id IS NULL
          AND EXISTS (
            SELECT 1 FROM requests child WHERE child.split_from_id = requests.id
          )
      `)
      .all();

    for (const root of takenRoots) {
      const childId = insertTakenChildRequest(db, root, root.quantity, root.id, root.taken_by_id);
      db.prepare(`
        UPDATE requests
        SET aff_geo = ?,
            aff_language = ?,
            partner = ?,
            aff_wh = ?,
            aff_price = ?,
            result_quantity = ?,
            result_status = ?,
            result_details = ?,
            status = ?,
            completed_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        root.aff_geo,
        root.aff_language,
        root.partner,
        root.aff_wh,
        root.aff_price,
        root.result_quantity,
        root.result_status,
        root.result_details,
        root.status,
        root.completed_at,
        childId,
      );
    }

    const roots = db
      .prepare(`
        SELECT id
        FROM requests r
        WHERE r.split_from_id IS NULL
          AND EXISTS (SELECT 1 FROM requests child WHERE child.split_from_id = r.id)
      `)
      .all()
      .map((row) => row.id);

    for (const rootId of new Set(roots)) {
      recomputeSplitTreeRoot(db, rootId);
    }

    splitMetaSet(db, 'parent_stays_split_v1', 'done');
  });

  repair();
}

function recomputeSplitTreeRoot(db, rootId) {
  const root = db.prepare('SELECT * FROM requests WHERE id = ?').get(rootId);
  if (!root) return;

  const descendants = db
    .prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM requests WHERE split_from_id = ?
        UNION ALL
        SELECT r.id
        FROM requests r
        INNER JOIN tree t ON r.split_from_id = t.id
      )
      SELECT r.*
      FROM requests r
      INNER JOIN tree t ON r.id = t.id
    `)
    .all(rootId);

  if (!descendants.length) return;

  if (root.taken_by_id && root.status === 'in_progress' && !descendants.length) {
    return;
  }

  const poolCap = Math.max(0, getRootPoolCap(db, rootId));

  db.prepare(`
    UPDATE requests
    SET status = 'new',
        taken_by_id = NULL,
        partner = NULL,
        aff_geo = NULL,
        aff_language = NULL,
        aff_wh = NULL,
        aff_price = NULL,
        result_quantity = NULL,
        result_status = NULL,
        result_details = NULL,
        completed_at = NULL,
        remaining_cap = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(poolCap, rootId);
}

function flattenNestedSplitChildrenOnce(db) {
  if (splitMetaGet(db, 'flatten_split_children_v1') === 'done') return;

  const flatten = db.transaction(() => {
    const nested = db
      .prepare(`
        SELECT c.id, c.split_from_id
        FROM requests c
        INNER JOIN requests p ON c.split_from_id = p.id
        WHERE p.split_from_id IS NOT NULL
      `)
      .all();

    for (const row of nested) {
      const rootId = getSplitRootId(db, { split_from_id: row.split_from_id });
      if (!rootId || rootId === row.id) continue;
      db.prepare(`
        UPDATE requests
        SET split_from_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(rootId, row.id);
    }

    splitMetaSet(db, 'flatten_split_children_v1', 'done');
  });

  flatten();
}

function repairSplitTreeIntegrityOnce(db) {
  if (splitMetaGet(db, 'split_tree_integrity_v1') === 'done') return;

  const repair = db.transaction(() => {
    const poolChildren = db
      .prepare(`
        SELECT *
        FROM requests
        WHERE status = 'new'
          AND taken_by_id IS NULL
          AND split_from_id IS NOT NULL
      `)
      .all();

    for (const child of poolChildren) {
      const rootId = resolveSplitRootId(db, child);
      if (!rootId) continue;
      db.prepare(`
        UPDATE requests
        SET remaining_cap = COALESCE(remaining_cap, quantity) + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(child.quantity, rootId);
      db.prepare('DELETE FROM requests WHERE id = ?').run(child.id);
    }

    const takenRoots = db
      .prepare(`
        SELECT *
        FROM requests
        WHERE status = 'in_progress'
          AND taken_by_id IS NOT NULL
          AND split_from_id IS NULL
          AND EXISTS (
            SELECT 1 FROM requests child WHERE child.split_from_id = requests.id
          )
      `)
      .all();

    for (const root of takenRoots) {
      const childId = insertTakenChildRequest(db, root, root.quantity, root.id, root.taken_by_id);
      db.prepare(`
        UPDATE requests
        SET aff_geo = ?,
            aff_language = ?,
            partner = ?,
            aff_wh = ?,
            aff_price = ?,
            result_quantity = ?,
            result_status = ?,
            result_details = ?,
            status = ?,
            completed_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        root.aff_geo,
        root.aff_language,
        root.partner,
        root.aff_wh,
        root.aff_price,
        root.result_quantity,
        root.result_status,
        root.result_details,
        root.status,
        root.completed_at,
        childId,
      );
      recomputeSplitTreeRoot(db, root.id);
    }

    const roots = db
      .prepare(`
        SELECT id
        FROM requests r
        WHERE r.split_from_id IS NULL
          AND EXISTS (SELECT 1 FROM requests child WHERE child.split_from_id = r.id)
      `)
      .all();

    for (const { id: rootId } of roots) {
      const root = db.prepare('SELECT * FROM requests WHERE id = ?').get(rootId);
      if (!root) continue;

      const childrenSum = Number(
        db
          .prepare('SELECT COALESCE(SUM(quantity), 0) AS s FROM requests WHERE split_from_id = ?')
          .get(rootId)?.s || 0,
      );
      const pool = Math.max(0, Number(root.remaining_cap ?? 0));
      const expectedQty = pool + childrenSum;

      if (expectedQty > 0 && Number(root.quantity) !== expectedQty) {
        db.prepare(`
          UPDATE requests
          SET quantity = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(expectedQty, rootId);
      }

      const children = db
        .prepare('SELECT id, split_part FROM requests WHERE split_from_id = ? ORDER BY COALESCE(split_part, 999999) ASC, id ASC')
        .all(rootId);
      children.forEach((child, index) => {
        const part = index + 1;
        if (Number(child.split_part) !== part) {
          db.prepare(`
            UPDATE requests
            SET split_part = ?,
                display_ref = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(part, `${rootId}/${part}`, child.id);
        }
      });

      if (!root.taken_by_id && root.status !== 'new' && root.status !== 'done') {
        db.prepare(`
          UPDATE requests
          SET status = 'new', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(rootId);
      }
    }

    splitMetaSet(db, 'split_tree_integrity_v1', 'done');
  });

  repair();
}

function backfillDisplayRefsOnce(db) {
  if (splitMetaGet(db, 'display_ref_v1') === 'done') return;

  const backfill = db.transaction(() => {
    db.prepare(`
      UPDATE requests
      SET display_ref = CAST(id AS TEXT)
      WHERE split_from_id IS NULL
        AND (display_ref IS NULL OR display_ref = '')
    `).run();

    const roots = db
      .prepare(`
        SELECT id
        FROM requests
        WHERE split_from_id IS NULL
          AND EXISTS (SELECT 1 FROM requests child WHERE child.split_from_id = requests.id)
      `)
      .all();

    for (const { id: rootId } of roots) {
      const children = db
        .prepare('SELECT id, split_part FROM requests WHERE split_from_id = ? ORDER BY COALESCE(split_part, 999999) ASC, id ASC')
        .all(rootId);
      children.forEach((child, index) => {
        const part = Number(child.split_part) > 0 ? Number(child.split_part) : index + 1;
        const displayRef = `${rootId}/${part}`;
        db.prepare(`
          UPDATE requests
          SET split_part = ?,
              display_ref = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(part, displayRef, child.id);
      });
    }

    splitMetaSet(db, 'display_ref_v1', 'done');
  });

  backfill();
}

function migrateRequestTextIdsOnce(db) {
  if (splitMetaGet(db, 'text_request_id_v1') === 'done') return;
  if (requestsUseTextIds(db)) {
    splitMetaSet(db, 'text_request_id_v1', 'done');
    return;
  }

  const migrate = db.transaction(() => {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DROP TABLE IF EXISTS requests_new');

    db.exec(`
      CREATE TEMP TABLE requests_id_map (
        old_id INTEGER PRIMARY KEY,
        new_id TEXT NOT NULL
      )
    `);

    const mapInsert = db.prepare('INSERT INTO requests_id_map (old_id, new_id) VALUES (?, ?)');
    const roots = db.prepare(`
      SELECT id, display_ref
      FROM requests
      WHERE split_from_id IS NULL
    `).all();

    for (const root of roots) {
      mapInsert.run(root.id, root.display_ref || String(root.id));
    }

    const children = db.prepare(`
      SELECT id, split_from_id, split_part, display_ref
      FROM requests
      WHERE split_from_id IS NOT NULL
    `).all();

    for (const child of children) {
      const parent = db
        .prepare('SELECT new_id FROM requests_id_map WHERE old_id = ?')
        .get(child.split_from_id);
      const parentId = parent?.new_id || String(child.split_from_id);
      const newId = child.display_ref || `${parentId}/${child.split_part || 1}`;
      mapInsert.run(child.id, newId);
    }

    db.exec(`
      CREATE TABLE requests_new (
        id TEXT PRIMARY KEY,
        buyer_id INTEGER NOT NULL REFERENCES users(id),
        stage TEXT,
        geo TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        funnel TEXT,
        comment TEXT,
        status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('draft', 'new', 'in_progress', 'done')),
        taken_by_id INTEGER REFERENCES users(id),
        aff_geo TEXT,
        aff_wh TEXT,
        aff_price TEXT,
        result_status TEXT,
        result_details TEXT,
        result_quantity INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        language TEXT,
        aff_language TEXT,
        partner TEXT,
        remaining_cap INTEGER,
        split_from_id TEXT REFERENCES requests_new(id),
        split_part INTEGER
      )
    `);

    db.exec(`
      INSERT INTO requests_new (
        id, buyer_id, stage, geo, quantity, funnel, comment, status,
        taken_by_id, aff_geo, aff_wh, aff_price, result_status, result_details,
        result_quantity, created_at, updated_at, completed_at, language, aff_language,
        partner, remaining_cap, split_from_id, split_part
      )
      SELECT
        m.new_id,
        r.buyer_id, r.stage, r.geo, r.quantity, r.funnel, r.comment, r.status,
        r.taken_by_id, r.aff_geo, r.aff_wh, r.aff_price, r.result_status, r.result_details,
        r.result_quantity, r.created_at, r.updated_at, r.completed_at, r.language, r.aff_language,
        r.partner, r.remaining_cap,
        pm.new_id,
        r.split_part
      FROM requests r
      INNER JOIN requests_id_map m ON m.old_id = r.id
      LEFT JOIN requests_id_map pm ON pm.old_id = r.split_from_id
    `);

    db.exec('DROP TABLE requests');
    db.exec('ALTER TABLE requests_new RENAME TO requests');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_requests_split_from_id ON requests(split_from_id)
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_split_part
      ON requests(split_from_id, split_part)
      WHERE split_from_id IS NOT NULL AND split_part IS NOT NULL
    `);

    db.exec('PRAGMA foreign_keys = ON');
    splitMetaSet(db, 'text_request_id_v1', 'done');
  });

  migrate();
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
      if (countDirectSplitChildren(db, row.id) > 0) continue;

      const childTaken = db
        .prepare('SELECT COALESCE(SUM(quantity), 0) AS s FROM requests WHERE split_from_id = ?')
        .get(row.id);
      if (Number(childTaken?.s || 0) > 0) continue;

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
      const originalQty = Number(row.quantity);
      const remaining = Math.max(0, Number(row.remaining_cap ?? 0));
      if (remaining <= 0 || remaining >= originalQty) continue;

      let takenQty = originalQty - remaining;
      const resultQty = Number(row.result_quantity);
      if (Number.isInteger(resultQty) && resultQty > 0 && resultQty < originalQty) {
        takenQty = resultQty;
      }

      const remainderQty = originalQty - takenQty;
      if (remainderQty <= 0 || takenQty <= 0) continue;

      const childId = insertTakenChildRequest(db, row, takenQty, row.id, row.taken_by_id);
      db.prepare(`
        UPDATE requests
        SET aff_geo = ?,
            aff_language = ?,
            partner = ?,
            aff_wh = ?,
            aff_price = ?,
            result_quantity = ?,
            result_status = ?,
            result_details = ?,
            status = ?,
            completed_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        row.aff_geo,
        row.aff_language,
        row.partner,
        row.aff_wh,
        row.aff_price,
        row.result_quantity,
        row.result_status,
        row.result_details,
        row.status,
        row.completed_at,
        childId,
      );

      db.prepare(`
        UPDATE requests
        SET status = 'new',
            taken_by_id = NULL,
            partner = NULL,
            aff_geo = NULL,
            aff_language = NULL,
            aff_wh = NULL,
            aff_price = NULL,
            result_quantity = NULL,
            result_status = NULL,
            result_details = NULL,
            completed_at = NULL,
            remaining_cap = ?,
            quantity = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(remainderQty, originalQty, row.id);
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
  return Math.max(0, Number(request.remaining_cap ?? request.quantity ?? 0));
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
      ORDER BY COALESCE(split_part, 999999) ASC, id ASC
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

  const current = db.prepare('SELECT split_part FROM requests WHERE id = ?').get(requestId);
  if (!current?.split_part) return rootId;

  const row = db
    .prepare(`
      WITH RECURSIVE tree(id, split_part) AS (
        SELECT id, split_part FROM requests WHERE id = ?
        UNION ALL
        SELECT r.id, r.split_part
        FROM requests r
        INNER JOIN tree t ON r.split_from_id = t.id
      )
      SELECT id
      FROM tree
      WHERE id != ?
        AND split_part IS NOT NULL
        AND split_part < ?
      ORDER BY split_part DESC
      LIMIT 1
    `)
    .get(rootId, requestId, current.split_part);

  return row?.id || rootId;
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

function getSplitTreeAssignees(db, rootId) {
  ensureAssignmentSchema(db);
  return db
    .prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM requests WHERE id = ?
        UNION ALL
        SELECT r.id
        FROM requests r
        INNER JOIN tree t ON r.split_from_id = t.id
      )
      SELECT DISTINCT
        r.taken_by_id AS id,
        COALESCE(u.stage, u.username) AS stage,
        u.avatar_path
      FROM requests r
      INNER JOIN tree t ON r.id = t.id
      INNER JOIN users u ON r.taken_by_id = u.id
      WHERE r.taken_by_id IS NOT NULL
      ORDER BY stage ASC, r.taken_by_id ASC
    `)
    .all(rootId);
}

function getSplitTreeInWorkCap(db, rootId) {
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
      SELECT COALESCE(SUM(r.quantity), 0) AS total
      FROM requests r
      INNER JOIN tree t ON r.id = t.id
      WHERE r.id != ?
        AND r.status = 'in_progress'
        AND r.taken_by_id IS NOT NULL
        AND r.split_from_id IS NOT NULL
    `)
    .get(rootId, rootId);
  return Number(row?.total || 0);
}

function getSplitTreeClosedCap(db, rootId) {
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
      SELECT COALESCE(SUM(COALESCE(r.result_quantity, r.quantity)), 0) AS total
      FROM requests r
      INNER JOIN tree t ON r.id = t.id
      WHERE r.id != ?
        AND r.status = 'done'
        AND r.split_from_id IS NOT NULL
    `)
    .get(rootId, rootId);
  return Number(row?.total || 0);
}

function getSplitTreeAllocatedCap(db, rootId) {
  return getSplitTreeInWorkCap(db, rootId) + getSplitTreeClosedCap(db, rootId);
}

function getSplitTreeApprovedCap(db, rootId) {
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
      SELECT COALESCE(SUM(COALESCE(r.result_quantity, r.quantity)), 0) AS total
      FROM requests r
      INNER JOIN tree t ON r.id = t.id
      WHERE r.status = 'done'
        AND r.result_status = 'approved'
    `)
    .get(rootId);
  return Number(row?.total || 0);
}

function getRequestAgreedCap(db, request, isSplitTreeRoot, splitTreeRootId) {
  if (!request) return 0;
  if (isSplitTreeRoot) {
    return getSplitTreeApprovedCap(db, request.id);
  }
  if (request.status === 'done' && request.result_status === 'approved') {
    return Number(request.result_quantity ?? request.quantity ?? 0);
  }
  if (splitTreeRootId && request.split_from_id) {
    return 0;
  }
  return 0;
}

function getSplitPartNumber(db, request) {
  if (!request?.split_from_id) return null;
  if (Number.isInteger(request.split_part) && request.split_part > 0) {
    return request.split_part;
  }
  const rootId = getSplitRootId(db, request);
  if (!rootId || rootId === request.id) return null;
  const children = getSplitChildren(db, rootId);
  const idx = children.findIndex((child) => child.id === request.id);
  return idx >= 0 ? idx + 1 : null;
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
        if (k === 0) {
          member.split_part_number = null;
          member.display_id = String(root.id);
        } else {
          member.split_part_number = member.split_part ?? member.split_part_number ?? k;
          member.display_id = String(member.id);
        }
      }
    } else {
      for (const member of group) {
        member.is_split_member = false;
        member.is_split_root = false;
        member.split_group_size = null;
        member.split_aff_count = null;
        member.split_group_index = null;
        member.split_group_first = false;
        member.split_group_last = false;
        member.split_group_middle = false;
        member.split_part_number = null;
        member.display_id = String(member.id);
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
  const split_aff_count = is_split_tree_root ? countSplitAffs(db, request.id) : null;
  const split_in_work_cap = is_split_tree_root ? getSplitTreeInWorkCap(db, request.id) : 0;
  const split_closed_cap = is_split_tree_root ? getSplitTreeClosedCap(db, request.id) : 0;
  const split_allocated_cap = is_split_tree_root
    ? split_in_work_cap + split_closed_cap
    : 0;
  const agreed_cap = getRequestAgreedCap(db, request, is_split_tree_root, split_tree_root_id);
  const split_insert_after_id = is_subtask && split_tree_root_id
    ? getSplitInsertAfterId(db, split_tree_root_id, request.id)
    : null;
  const split_part_number = is_subtask ? getSplitPartNumber(db, request) : null;
  const display_id = String(request.id ?? '');
  const split_assignees = is_split_tree_root ? getSplitTreeAssignees(db, request.id) : [];

  return {
    ...request,
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
    is_split_tree_root,
    is_split_member: is_subtask || is_split_tree_root,
    is_split: is_split_tree_root || is_subtask,
    split_group_size: null,
    split_tree_size,
    split_aff_count,
    split_assignees,
    split_in_work_cap,
    split_closed_cap,
    split_allocated_cap,
    agreed_cap,
    split_part_number,
    display_id,
    has_available_cap: available_leads > 0,
    assignments: [],
    progress: null,
    my_assignment: null,
  };
}

function enrichRequestForUser(db, request, user) {
  return enrichRequest(db, request);
}

function resolveSplitTreeRootId(db, requestId) {
  const row = db.prepare('SELECT id, split_from_id FROM requests WHERE id = ?').get(requestId);
  if (!row) return null;
  if (!row.split_from_id) return row.id;
  return getSplitRootId(db, row);
}

function getSplitTreeMemberRequests(db, startId, mapRow) {
  ensureAssignmentSchema(db);
  const first = mapRow(startId);
  if (!first) return [];

  const rootId = first.split_tree_root_id || first.id;
  const memberIds =
    countSplitTreeMembers(db, rootId) > 1 ? getSplitTreeMemberIds(db, rootId) : [startId];

  const seen = new Set();
  const requests = [];
  for (const memberId of memberIds) {
    if (seen.has(memberId)) continue;
    seen.add(memberId);
    const request = mapRow(memberId);
    if (request) requests.push(request);
  }

  return nestRequestsForDisplay(requests);
}

function enrichRequests(db, requests, user) {
  return requests.map((request) => enrichRequestForUser(db, request, user));
}

function getSplitTreeMemberIds(db, rootId) {
  ensureAssignmentSchema(db);
  return db
    .prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM requests WHERE id = ?
        UNION ALL
        SELECT r.id
        FROM requests r
        INNER JOIN tree t ON r.split_from_id = t.id
      )
      SELECT r.id
      FROM tree t
      INNER JOIN requests r ON r.id = t.id
      ORDER BY CASE WHEN r.id = ? THEN 0 ELSE 1 END, COALESCE(r.split_part, 999999), r.id
    `)
    .all(rootId, rootId)
    .map((row) => row.id);
}

function shouldAttachSplitTreeMembers(filters = {}) {
  if (filters.assigned) return false;
  if (filters.status === 'approved' || filters.status === 'rejected') return false;
  return true;
}

function collectMissingSplitTreeMemberIds(db, requests, filters = {}) {
  if (!shouldAttachSplitTreeMembers(filters) || !requests.length) return [];

  const byId = new Set(requests.map((r) => r.id));
  const missing = new Set();
  const roots = new Set();

  for (const request of requests) {
    if (request.split_from_id) {
      roots.add(getSplitRootId(db, request));
    } else {
      const children = getSplitChildren(db, request.id);
      if (children.length > 0 || hasOpenRemainderDescendant(db, request.id)) {
        roots.add(request.id);
      }
    }
  }

  for (const rootId of roots) {
    if (!rootId || countSplitTreeMembers(db, rootId) <= 1) continue;
    for (const id of getSplitTreeMemberIds(db, rootId)) {
      if (!byId.has(id)) missing.add(id);
    }
  }

  return [...missing];
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
    children.sort((a, b) => {
      const partDiff = Number(a.split_part ?? 0) - Number(b.split_part ?? 0);
      if (partDiff !== 0) return partDiff;
      return compareRequestIds(a.id, b.id);
    });
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
    return out.sort((a, b) => {
      const partDiff = Number(a.split_part ?? 0) - Number(b.split_part ?? 0);
      if (partDiff !== 0) return partDiff;
      return compareRequestIds(a.id, b.id);
    });
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
    if (request.split_from_id) continue;
    appendSplitGroup(request);
  }

  for (const request of requests) {
    if (!placed.has(request.id)) {
      if (request.split_from_id) {
        result.push({
          ...request,
          is_subtask: true,
          nest_depth: 1,
          split_root_id: request.split_tree_root_id || request.split_from_id,
          display_id: String(request.id),
        });
        placed.add(request.id);
      } else {
        appendSplitGroup(request);
      }
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
    if (request.split_from_id) {
      return { ok: false, error: 'Only the original request can be taken or split' };
    }

    const rootId = request.id;
    const root = db.prepare('SELECT * FROM requests WHERE id = ?').get(rootId);
    const poolRequest = root?.status === 'new' && !root?.taken_by_id ? root : request;
    const total = getAvailableLeads(poolRequest);
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

    const hasChildren = countDirectSplitChildren(db, rootId) > 0;
    const removedPoolChildIds = [];

    if (amount === total && !hasChildren && poolRequest.id === rootId) {
      db.prepare(`
        UPDATE requests
        SET taken_by_id = ?,
            status = 'in_progress',
            quantity = ?,
            remaining_cap = ?,
            result_quantity = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(affId, amount, amount, amount, rootId);

      return {
        ok: true,
        requestId: rootId,
        rootId,
        capTaken: amount,
        split: false,
        remainderRequestId: null,
        removedPoolChildIds,
      };
    }

    decrementRootPool(db, rootId, amount);

    if (poolRequest.id !== rootId && amount === total) {
      removedPoolChildIds.push(poolRequest.id);
      db.prepare('DELETE FROM requests WHERE id = ?').run(poolRequest.id);
    }

    const childId = insertTakenChildRequest(db, root, amount, rootId, affId);

    return {
      ok: true,
      requestId: rootId,
      rootId,
      capTaken: amount,
      split: true,
      remainder: total - amount,
      remainderRequestId: childId,
      removedPoolChildIds,
    };
  })();
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
    const rootId = request.split_from_id ? resolveSplitRootId(db, request) : null;

    if (rootId && request.id !== rootId) {
      db.prepare(`
        UPDATE requests
        SET remaining_cap = COALESCE(remaining_cap, quantity) + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(qty, rootId);

      db.prepare('DELETE FROM requests WHERE id = ?').run(requestId);

      return {
        ok: true,
        requestId,
        rootId,
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

    return { ok: true, requestId, rootId: requestId };
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

    if (request.split_from_id && affCap !== currentQty) {
      return { ok: false, error: 'Cap cannot be changed on a split task' };
    }

    if (affCap < currentQty) {
      db.prepare(`
        UPDATE requests
        SET quantity = ?,
            remaining_cap = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(affCap, affCap, requestId);
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
      rootId: request.split_from_id ? resolveSplitRootId(db, request) : null,
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

    const rootId = request.split_from_id ? resolveSplitRootId(db, request) : null;
    const rootClosedId = rootId ? maybeCloseSplitRoot(db, rootId) : null;

    return {
      ok: true,
      requestId,
      rootId,
      rootClosedId,
      requestFullyDone: !rootId,
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

    const rootId = request.split_from_id ? resolveSplitRootId(db, request) : null;
    if (rootId) {
      db.prepare(`
        UPDATE requests
        SET status = 'new',
            completed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'done'
          AND taken_by_id IS NULL
      `).run(rootId);
    }

    return { ok: true, requestId, rootId };
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
  collectMissingSplitTreeMemberIds,
  shouldAttachSplitTreeMembers,
  nestRequestsForDisplay,
  resolveSplitTreeRootId,
  getSplitTreeMemberRequests,
  getSplitTreeMemberIds,
  countSplitTreeMembers,
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
