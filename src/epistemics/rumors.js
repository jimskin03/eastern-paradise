export class RumorRepository {
  constructor({ db }) {
    this.db = db;
  }

  getById(id) {
    return this.db.prepare('SELECT * FROM world_rumors WHERE id = ?').get(id) || null;
  }

  list({ limit = 25, offset = 0 } = {}) {
    const pageLimit = Math.max(1, Math.min(100, Number(limit) || 25));
    const pageOffset = Math.max(0, Number(offset) || 0);
    return this.db.prepare(`
      SELECT * FROM world_rumors
      ORDER BY updated_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(pageLimit, pageOffset);
  }
}

