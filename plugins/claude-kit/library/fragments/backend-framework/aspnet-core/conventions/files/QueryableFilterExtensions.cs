using System.Collections;
using System.Globalization;
using System.Linq.Expressions;
using System.Reflection;

namespace <% project.pascal %>.Api.Common.Models;

/// Turns client-supplied FilterDescriptor/SortDescriptor into IQueryable clauses.
///
/// Every field name is checked against an allowlist the service declares, so a
/// client can only query what the feature deliberately exposed. An unknown field
/// or an unparseable value throws InvalidOperationException, which the exception
/// middleware maps to 400 — the same way any other bad request is signalled.
///
/// Contains/StartsWith lower both sides so matching is case-insensitive on any
/// provider. That defeats a plain B-tree index; a hot search column wants a
/// functional index on lower(column), or a provider-specific clause written in
/// the service's ApplyCustomFilters override.
public static class QueryableFilterExtensions
{
    private const BindingFlags Lookup =
        BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase;

    private static readonly MethodInfo StringContains =
        typeof(string).GetMethod(nameof(string.Contains), [typeof(string)])!;

    private static readonly MethodInfo StringStartsWith =
        typeof(string).GetMethod(nameof(string.StartsWith), [typeof(string)])!;

    private static readonly MethodInfo StringToLower =
        typeof(string).GetMethod(nameof(string.ToLower), Type.EmptyTypes)!;

    public static IQueryable<T> ApplyFilters<T>(
        this IQueryable<T> source,
        IEnumerable<FilterDescriptor>? filters,
        ISet<string> allowed)
    {
        foreach (var filter in filters ?? [])
        {
            var property = Resolve<T>(filter.Field, allowed);
            var parameter = Expression.Parameter(typeof(T), "e");
            var member = Expression.Property(parameter, property);
            var body = BuildPredicate(member, property.PropertyType, filter);

            source = source.Where(Expression.Lambda<Func<T, bool>>(body, parameter));
        }

        return source;
    }

    /// User sorters first, then CreatedAt desc when none were supplied, then Id as
    /// a final tiebreaker. That last clause is not decoration: without a total
    /// order, two rows with equal sort keys can swap between pages and the client
    /// sees a row twice while never seeing another.
    public static IQueryable<T> ApplySorting<T>(
        this IQueryable<T> source,
        IEnumerable<SortDescriptor>? sorters,
        ISet<string> allowed)
    {
        IOrderedQueryable<T>? ordered = null;

        foreach (var sorter in sorters ?? [])
        {
            var property = Resolve<T>(sorter.Field, allowed);
            ordered = Order(ordered ?? source, property, sorter.Descending, first: ordered is null);
        }

        if (ordered is null && typeof(T).GetProperty("CreatedAt", Lookup) is { } createdAt)
        {
            ordered = Order(source, createdAt, descending: true, first: true);
        }

        if (typeof(T).GetProperty("Id", Lookup) is { } id)
        {
            ordered = Order(ordered ?? source, id, descending: false, first: ordered is null);
        }

        return ordered ?? source;
    }

    private static PropertyInfo Resolve<T>(string field, ISet<string> allowed)
    {
        if (string.IsNullOrWhiteSpace(field) || !allowed.Contains(field))
        {
            throw new InvalidOperationException(
                $"'{field}' is not queryable on {typeof(T).Name}. Allowed: {string.Join(", ", allowed)}");
        }

        return typeof(T).GetProperty(field, Lookup)
            ?? throw new InvalidOperationException(
                $"'{field}' is allowlisted on {typeof(T).Name} but no such property exists.");
    }

    private static IOrderedQueryable<T> Order<T>(
        IQueryable<T> source,
        PropertyInfo property,
        bool descending,
        bool first)
    {
        var parameter = Expression.Parameter(typeof(T), "e");
        var lambda = Expression.Lambda(Expression.Property(parameter, property), parameter);

        var method = (first, descending) switch
        {
            (true, false) => nameof(Queryable.OrderBy),
            (true, true) => nameof(Queryable.OrderByDescending),
            (false, false) => nameof(Queryable.ThenBy),
            (false, true) => nameof(Queryable.ThenByDescending),
        };

        var call = Expression.Call(
            typeof(Queryable),
            method,
            [typeof(T), property.PropertyType],
            source.Expression,
            Expression.Quote(lambda));

        return (IOrderedQueryable<T>)source.Provider.CreateQuery<T>(call);
    }

    private static Expression BuildPredicate(MemberExpression member, Type type, FilterDescriptor filter)
    {
        var underlying = Nullable.GetUnderlyingType(type) ?? type;
        var nullable = !type.IsValueType || Nullable.GetUnderlyingType(type) is not null;

        if (filter.Operator is FilterOperator.IsNull or FilterOperator.IsNotNull)
        {
            if (!nullable)
            {
                throw new InvalidOperationException($"'{filter.Field}' is not nullable.");
            }

            var isNull = Expression.Equal(member, Expression.Constant(null, type));
            return filter.Operator == FilterOperator.IsNull ? isNull : Expression.Not(isNull);
        }

        if (filter.Operator is FilterOperator.Contains or FilterOperator.StartsWith)
        {
            if (underlying != typeof(string))
            {
                throw new InvalidOperationException(
                    $"'{filter.Field}' is {underlying.Name}, so {filter.Operator} does not apply.");
            }

            var needle = Lift(
                ((string)Coerce(filter.Value, typeof(string), filter.Field)).ToLowerInvariant(),
                typeof(string));

            var method = filter.Operator == FilterOperator.Contains ? StringContains : StringStartsWith;
            var match = Expression.Call(Expression.Call(member, StringToLower), method, needle);

            return Expression.AndAlso(Expression.NotEqual(member, Expression.Constant(null, type)), match);
        }

        if (filter.Operator == FilterOperator.In)
        {
            var listType = typeof(List<>).MakeGenericType(type);
            var list = (IList)Activator.CreateInstance(listType)!;

            foreach (var raw in (filter.Value ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                list.Add(Coerce(raw, underlying, filter.Field));
            }

            if (list.Count == 0)
            {
                throw new InvalidOperationException($"Filter 'In' on '{filter.Field}' has no values.");
            }

            return Expression.Call(
                typeof(Enumerable),
                nameof(Enumerable.Contains),
                [type],
                Lift(list, listType),
                member);
        }

        // Build the value at the underlying type, then widen — a boxed Guid cannot
        // be handed straight to a Guid? because IsAssignableFrom says no.
        var constant = Lift(Coerce(filter.Value, underlying, filter.Field), underlying);
        if (underlying != type)
        {
            constant = Expression.Convert(constant, type);
        }

        return filter.Operator switch
        {
            FilterOperator.Equals => Expression.Equal(member, constant),
            FilterOperator.NotEquals => Expression.NotEqual(member, constant),
            FilterOperator.GreaterThan => Expression.GreaterThan(member, constant),
            FilterOperator.GreaterThanOrEqual => Expression.GreaterThanOrEqual(member, constant),
            FilterOperator.LessThan => Expression.LessThan(member, constant),
            FilterOperator.LessThanOrEqual => Expression.LessThanOrEqual(member, constant),
            _ => throw new InvalidOperationException($"Unsupported operator: {filter.Operator}"),
        };
    }

    /// Wraps a value in a member access so EF Core parameterises it instead of
    /// inlining a literal. Expression.Constant on its own produces `= 'abc'` in the
    /// SQL, which is safe but gives every distinct filter value its own query plan.
    /// This is the same shape the compiler emits for a captured closure variable,
    /// which is what EF's parameter extraction looks for.
    private static Expression Lift(object? value, Type type)
    {
        var boxType = typeof(Box<>).MakeGenericType(type);
        var box = Activator.CreateInstance(boxType)!;
        boxType.GetField(nameof(Box<object>.Value))!.SetValue(box, value);

        return Expression.Field(Expression.Constant(box, boxType), nameof(Box<object>.Value));
    }

    private sealed class Box<T>
    {
        public T Value = default!;
    }

    private static object Coerce(string? raw, Type target, string field)
    {
        if (raw is null)
        {
            throw new InvalidOperationException($"Filter on '{field}' requires a value.");
        }

        try
        {
            if (target == typeof(string)) return raw;
            if (target.IsEnum) return Enum.Parse(target, raw, ignoreCase: true);
            if (target == typeof(Guid)) return Guid.Parse(raw);
            if (target == typeof(DateTimeOffset)) return DateTimeOffset.Parse(raw, CultureInfo.InvariantCulture);
            if (target == typeof(DateTime))
            {
                return DateTime.Parse(
                    raw,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
            }

            return Convert.ChangeType(raw, target, CultureInfo.InvariantCulture);
        }
        catch (Exception ex) when (ex is FormatException or InvalidCastException or OverflowException or ArgumentException)
        {
            throw new InvalidOperationException($"Cannot read '{raw}' as {target.Name} for filter '{field}'.");
        }
    }
}
