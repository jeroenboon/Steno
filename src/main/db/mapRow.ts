/**
 * Map a SQLite row to a validated domain object.
 *
 * Every repo reads rows with snake_case columns and nullable optional fields,
 * then hand-maps them to a camelCase domain shape before a Zod `parse`. That
 * mapping is mechanical and identical across repos, so it lives here:
 *
 *  - snake_case column names → camelCase field names (`agenda_item_id` →
 *    `agendaItemId`);
 *  - SQL `NULL` → `undefined` (so optional fields drop out under
 *    `exactOptionalPropertyTypes` rather than arriving as `null`);
 *  - the foreign-key column (`meeting_id`) and any other column the schema does
 *    not declare are stripped by Zod (objects strip unknown keys by default).
 *
 * The schema is the single source of truth for the shape, so `parseRow` returns
 * `z.infer<S>` and throws on a row that does not match — exactly what the
 * hand-written `rowToDomain` functions did.
 *
 * Columns that need a value transform (e.g. SQLite's 0/1 → boolean in
 * meetingRepo) are NOT a snake→camel mapping, so those repos keep their own
 * `rowToDomain`; `parseRow` deliberately does not try to guess coercions.
 */

import type { z } from 'zod'

/** `agenda_item_id` → `agendaItemId`. Leaves already-camel/simple keys untouched. */
function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

export function parseRow<S extends z.ZodType>(row: Record<string, unknown>, schema: S): z.infer<S> {
  const mapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    mapped[snakeToCamel(key)] = value === null ? undefined : value
  }
  return schema.parse(mapped)
}
