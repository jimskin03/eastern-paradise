import assert from 'node:assert/strict';

// The public memorial is append-only; a test's new records may be on any page.
export async function collectMemorialInscriptions(fetchPage) {
  const inscriptions = [];
  let cursor = null;
  do {
    const page = await fetchPage(cursor);
    inscriptions.push(...page.inscriptions);
    if (!page.pagination.has_more) return inscriptions;
    const nextCursor = page.pagination.next_cursor;
    assert.ok(Number.isFinite(nextCursor) && (cursor === null || nextCursor !== cursor),
      'Memorial pagination must advance without repeating a page');
    cursor = nextCursor;
  } while (true);
}
