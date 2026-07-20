import { randomUUID } from "node:crypto"

// Test-only helper. Assigns a stable identity to the actual resolved
// service object it is called with, keyed by object identity via a
// WeakMap. Calling it again with the same object returns the same id;
// calling it with a different object returns a different id. This is
// never imported by production code and is not reachable through any
// Admin/public API.
const identities = new WeakMap<object, string>()

export function observedServiceInstanceId(service: object): string {
  const existing = identities.get(service)
  if (existing) return existing
  const id = `svc-${process.pid}-${randomUUID()}`
  identities.set(service, id)
  return id
}
