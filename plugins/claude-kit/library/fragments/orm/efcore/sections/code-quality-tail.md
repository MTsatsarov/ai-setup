## Soft deletes

Soft delete is enforced globally by the `AppDbContext` query filter, so reads need no explicit
condition. Two failure modes to watch for:

- **`IgnoreQueryFilters()` without a reason.** It disables the filter for the whole query, including
  joined entities. If you need it (an admin audit view, a restore feature), say why in a comment.
- **Orphaned children.** Soft-deleting a parent leaves its children visible, because the filter is
  per-entity and does not cascade. Cascade it explicitly in the service when the domain requires it.

Never call `Remove(entity)`. Set `IsDeleted = true` and save.
