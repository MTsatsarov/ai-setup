namespace <% project.pascal %>.Api.Common.Entities;

/// The key contract the CRUD base is generic over.
public interface IEntity<TId>
{
    TId Id { get; set; }
}

/// Marker the DbContext's global query filter keys on. It has to be non-generic:
/// IsAssignableFrom cannot test an open generic like AuditedEntity<>.
public interface ISoftDelete
{
    bool IsDeleted { get; set; }
}

public interface IAudited
{
    DateTimeOffset CreatedAt { get; set; }
    DateTimeOffset UpdatedAt { get; set; }
}

/// Audit + soft-delete columns shared by every domain entity.
public abstract class AuditedEntity<TId> : IEntity<TId>, ISoftDelete, IAudited
{
    public TId Id { get; set; } = default!;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool IsDeleted { get; set; }
}

/// The common case. Derive from this unless the entity genuinely needs a
/// non-Guid key, in which case derive from AuditedEntity<TId> directly.
public abstract class AuditedEntity : AuditedEntity<Guid>
{
    protected AuditedEntity() => Id = Guid.NewGuid();
}
