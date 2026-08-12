// The offline module's seam for the delivery layer.
//
// WHY THIS FILE EXISTS AND IS NOT A POINTLESS RE-EXPORT. eslint-plugin-boundaries
// forbids `app` from importing any module's DOMAIN — a route handler that imported
// sync-outcome.ts directly would be reaching past the module's contract into its
// innards, and every future change to that file would be a change to the delivery
// layer's API whether it meant to be or not.
//
// So the two things a caller genuinely needs — the outcome vocabulary and the
// last-write-wins verdict — are published HERE, and the domain stays free to be
// reorganised behind them.
export {
  resolveEdit,
  syncOutcome,
  type EditVersions,
  type SyncOutcome,
} from "@/modules/offline/domain/sync-outcome";

export {
  MAX_ATTEMPTS,
  type PendingKind,
  type PendingWrite,
} from "@/modules/offline/domain/pending-write";
