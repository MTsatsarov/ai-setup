## Soft deletes

Exclude soft-deleted rows from every read by composing `<% orm.read_filter %>` into the `where`.
Prefer a soft delete — set `isDeleted` to `true` — over a hard `db.delete(...)`. Keep audit/soft-delete
fields out of response DTOs.
