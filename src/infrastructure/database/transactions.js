export function withImmediateTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    if (result && typeof result.then === 'function') {
      throw new Error('withImmediateTransaction operation must be synchronous.');
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

