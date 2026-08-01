// category-error.ts — the ways a category draft can be refused.
//
// Mirrors accounts/domain/account-error.ts: a closed union, so a caller that
// forgets a case fails to compile rather than falling through to a generic
// message.

// NO "DuplicateName" KIND, and that is a product decision rather than an omission.
// 20260728143000 declines a unique constraint on (workspace_id, name) on purpose:
// re-bucketing a category is archive-and-replace, which leaves two rows sharing a
// name — one archived under the old bucket, one active under the new one. Rejecting
// a repeated name in the application would forbid exactly the operation the schema
// was shaped to allow.
export type CategoryError =
  | { readonly kind: "NameRequired" }
  | { readonly kind: "NameTooLong" }
  | { readonly kind: "InvalidBucket" }
  | { readonly kind: "NotPermitted" }
  | { readonly kind: "WorkspaceNotFound" }
  | { readonly kind: "Unavailable" };
