const depthMap = new WeakMap();

/**
 * Execute a synchronous operation within a SQLite immediate transaction.
 * Supports nested invocations via savepoints.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {Function} operation - Synchronous function to execute
 * @returns {*} Return value of operation
 */
export function withImmediateTransaction(db, operation) {
  const currentDepth = depthMap.get(db) || 0;
  depthMap.set(db, currentDepth + 1);

  if (currentDepth === 0) {
    db.exec('BEGIN IMMEDIATE');
  } else {
    db.exec(`SAVEPOINT ep_tx_${currentDepth}`);
  }

  try {
    const result = operation();
    if (result && typeof result.then === 'function') {
      throw new Error('withImmediateTransaction operation must be synchronous.');
    }

    if (currentDepth === 0) {
      db.exec('COMMIT');
    } else {
      db.exec(`RELEASE ep_tx_${currentDepth}`);
    }
    return result;
  } catch (error) {
    if (currentDepth === 0) {
      db.exec('ROLLBACK');
    } else {
      db.exec(`ROLLBACK TO ep_tx_${currentDepth}`);
      db.exec(`RELEASE ep_tx_${currentDepth}`);
    }
    throw error;
  } finally {
    const depth = depthMap.get(db) || 1;
    if (depth <= 1) {
      depthMap.delete(db);
    } else {
      depthMap.set(db, depth - 1);
    }
  }
}
