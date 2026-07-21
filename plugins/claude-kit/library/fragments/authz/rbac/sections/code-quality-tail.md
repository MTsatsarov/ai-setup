## Authorization

Every endpoint has an authorization decision, and that decision is visible at the endpoint —
not buried in a service. Three rules:

- **Deny by default.** Configure a fallback policy requiring an authenticated user, so a controller
  that forgets its attribute fails closed. Opening an endpoint is then explicit and greppable.
- **Never compare role strings inline.** `Roles.Admin`, not `"Admin"` — a typo in a string literal
  is a silent authorization bypass that no compiler will catch.
- **Authorize the record, not just the route.** Role checks answer "may this kind of user do this
  kind of thing". They do not answer "may *this* user touch *this* row". Where ownership matters,
  the service must check it after loading the entity.
