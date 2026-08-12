"use client";

/**
 * What the person is told about their connection and their queue.
 *
 * PRESENTATIONAL ONLY — every value arrives as a prop and nothing here reads IndexedDB,
 * fetches, or registers a worker. That is not ceremony: the queue's adapters are
 * infrastructure, the delivery layer is the only place allowed to wire those, and
 * keeping this file free of them is what makes the wording testable and the behaviour
 * replaceable. The container lives in src/app/(app)/offline-sync.tsx.
 */
interface OfflineBannerProps {
  readonly online: boolean;
  readonly pending: number;
  readonly notice: string | null;
  readonly onDismissNotice: () => void;
}

export function OfflineBanner({
  online,
  pending,
  notice,
  onDismissNotice,
}: OfflineBannerProps) {
  // NOTHING is the right answer when online with an empty queue, which is almost always.
  // A permanent "conectado" strip would be a badge nobody reads occupying the top of
  // every screen.
  if (online && pending === 0 && notice === null) return null;

  const movements = pending === 1 ? "movimiento" : "movimientos";

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-border bg-muted/60 text-foreground border-b px-4 py-2 text-xs"
    >
      {!online && (
        <p>
          <span className="font-medium">Sin conexión.</span> Podés seguir
          registrando: se guarda en este dispositivo y se sincroniza cuando
          vuelvas.
          {pending > 0 && (
            <>
              {" "}
              <span className="font-medium">
                {pending} {movements} esperando.
              </span>
            </>
          )}
        </p>
      )}

      {online && pending > 0 && (
        <p>
          Sincronizando {pending} {movements}…
        </p>
      )}

      {notice !== null && (
        <p className="mt-1 flex items-start justify-between gap-3">
          <span>{notice}</span>
          {/*
            DISMISSED BY HAND, never on a timer. The notice can be the only place someone
            learns a movement was refused or replaced, and a message that disappears on
            its own is one they may never have read.
          */}
          <button
            type="button"
            onClick={onDismissNotice}
            className="text-muted-foreground hover:text-foreground shrink-0 underline"
          >
            Entendido
          </button>
        </p>
      )}
    </div>
  );
}
