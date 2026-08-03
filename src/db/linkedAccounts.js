import { pool } from './pool.js';

export async function getLinkedAccountById(id) {
  const { rows } = await pool.query('select * from linked_accounts where id = $1', [id]);
  return rows[0] ?? null;
}

export async function markNeedsReauth(id) {
  await pool.query(
    "update linked_accounts set status = 'needs_reauth', updated_at = now() where id = $1",
    [id],
  );
}
