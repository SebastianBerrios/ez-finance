// export-adapter.ts — implements ExportPort: packs the caller's ez_finance
// data into a ZIP (JSON + CSV mirrors) so it can be downloaded before deleting
// the account, per the data-portability requirement.
//
// SCOPE: reads go through the user's own session, so RLS is what limits the
// archive to their data — the adapter never uses a service key and never widens
// visibility.
//
// It now contains the FINANCIAL data too. For a long time it did not: the header here
// said "Fase 3+ datasets (accounts, categories, transactions) plug in by adding entries
// to DATASETS", and there was no DATASETS and nothing plugged in. So an archive
// described to the person as "una copia de tus datos" held a profile, a list of spaces
// and a list of memberships — no accounts, no categories, no movements — while spec
// §3.1 promises they can export "toda su información", and this is the file someone
// downloads immediately before erasing the original.
import { type Zippable, strToU8, zip } from "fflate";

import {
  type ExportArtifact,
  type ExportPort,
} from "@/modules/auth/application/ports/export-port";
import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result, err, ok } from "@/shared/domain/result";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

import { mapSupabaseError } from "./error-map";

type Row = Record<string, unknown>;

/**
 * The profile is not in DATASETS: it is ONE row, keyed by the caller's id rather than
 * scoped by a column, so it reads differently from every other set.
 */
const PROFILE_COLUMNS = [
  "id",
  "display_name",
  "photo_url",
  "language",
  "default_currency",
  "created_at",
  "updated_at",
] as const;

interface Dataset {
  /** Base filename, without extension. */
  readonly file: string;
  readonly table: string;
  readonly columns: readonly string[];
  /** Present when the table is about people and must be narrowed to the caller. */
  readonly scopeToUser?: string;
  /** One line for LEEME.txt. */
  readonly describe: string;
}

/**
 * What goes in the archive.
 *
 * A TABLE, because the previous shape was three hand-written blocks and the header of
 * this file promised that "Fase 3+ datasets plug in by adding entries to DATASETS" — a
 * DATASETS that did not exist. What actually happened is what usually happens: the
 * financial data never got added, so an archive documented as "una copia de tus datos"
 * contained a profile, a list of spaces and a list of memberships, and NOT a single
 * movement. That is the file someone downloads before deleting their account.
 *
 * Column lists stay EXPLICIT rather than `select *`: the CSV header and column order
 * have to be stable, and an empty dataset still has to export a valid header row.
 *
 * SCOPING. Two different rules, and the difference matters:
 *
 *  - `scopeToUser` reads only the caller's own rows. Used where the table is about
 *    PEOPLE: workspace_members' SELECT policy deliberately exposes every member of a
 *    space you belong to, so an unfiltered read would ship other members' fleet-wide
 *    auth UUIDs, names and roles inside an archive titled "Tus membresías".
 *  - Everything else is scoped by RLS to the workspaces the caller belongs to, which
 *    is the correct answer for financial data: it belongs to the WORKSPACE (spec §2),
 *    the person can already see all of it in the app, and an export of "their" months
 *    that omitted a shared space's movements would not reconcile with the dashboard
 *    they exported it from.
 */
const DATASETS: readonly Dataset[] = [
  {
    file: "espacios",
    table: "workspaces",
    columns: ["id", "name", "type", "created_at", "archived_at", "deleted_at"],
    describe: "Los espacios de los que sos parte.",
  },
  {
    file: "membresias",
    table: "workspace_members",
    columns: [
      "member_id",
      "workspace_id",
      "user_id",
      "display_name_snapshot",
      "role",
      "joined_at",
    ],
    scopeToUser: "user_id",
    describe: "Tus membresías en esos espacios.",
  },
  {
    file: "cuentas",
    table: "accounts",
    columns: [
      "id",
      "workspace_id",
      "name",
      "type",
      "currency",
      "initial_balance",
      "archived_at",
      "created_at",
    ],
    describe: "Tus cuentas y su saldo inicial.",
  },
  {
    file: "categorias",
    table: "categories",
    columns: [
      "id",
      "workspace_id",
      "name",
      "bucket",
      "parent_id",
      "archived_at",
      "created_at",
    ],
    describe: "Tus categorías y a qué cubo del 50/30/20 pertenecen.",
  },
  {
    file: "presupuestos",
    table: "budget_configs",
    columns: [
      "id",
      "workspace_id",
      "effective_from",
      "income_mode",
      "expected_income",
      "pct_need",
      "pct_want",
      "pct_save",
      "near_limit_pct",
    ],
    describe:
      "Tu presupuesto: ingreso esperado y los porcentajes de cada cubo.",
  },
  {
    // THE ONE THAT WAS MISSING AND MATTERS MOST. Everything else can be rebuilt from
    // memory; a year of movements cannot.
    file: "movimientos",
    table: "transactions",
    columns: [
      "id",
      "workspace_id",
      "account_id",
      "kind",
      "base_amount",
      "entered_amount",
      "entered_currency",
      "exchange_rate",
      "occurred_on",
      "category_id",
      "note",
      "transfer_id",
      "transfer_leg",
      "counter_account_id",
      // created_by is deliberately ABSENT: it is another person's fleet-wide auth
      // UUID in a shared space. It is replaced by `registrado_por` below.
      "created_at",
    ],
    describe: "Todos tus movimientos: ingresos, gastos y transferencias.",
  },
  {
    file: "metas",
    table: "goals",
    columns: [
      "id",
      "workspace_id",
      "account_id",
      "name",
      "target_amount",
      "target_date",
      "achieved_at",
      "archived_at",
      "created_at",
    ],
    describe: "Tus metas de ahorro.",
  },
  {
    file: "programados",
    table: "scheduled_transactions",
    columns: [
      "id",
      "workspace_id",
      "account_id",
      "category_id",
      "kind",
      "base_amount",
      "name",
      "note",
      "day_of_month",
      "materialised_through",
      "paused_at",
      "created_at",
    ],
    describe: "Tus movimientos programados.",
  },
];

/** Added to every movement in place of the raw created_by UUID. */
const AUTHOR_COLUMN = "registrado_por";

/**
 * LEEME.txt, built FROM the dataset table rather than written beside it.
 *
 * The old version listed three files by hand. A hand-written index of a
 * machine-generated archive is an index that goes stale the first time someone adds a
 * dataset and forgets — and the person reading it has no way to know it lied.
 */
function readme(): string {
  const lines = [
    "  perfil.json / perfil.csv".padEnd(38) +
      "Tu perfil (nombre, idioma, moneda).",
    ...DATASETS.map(
      (dataset) =>
        `  ${dataset.file}.json / ${dataset.file}.csv`.padEnd(38) +
        dataset.describe,
    ),
  ];

  return `Exportación de datos de ez finance
==================================

Este archivo contiene una copia de tus datos en ez finance al momento de la
exportación. Cada conjunto de datos viene en dos formatos:

${lines.join("\n")}

Los archivos .json conservan los tipos originales; los .csv se pueden abrir
con cualquier planilla de cálculo.

Sobre los espacios compartidos
------------------------------
La información financiera pertenece al espacio, no a una persona. Si compartís
un espacio con alguien, este archivo incluye los movimientos de ese espacio
—los tuyos y los de las otras personas—, que es lo mismo que ves en la app.
La columna "${AUTHOR_COLUMN}" dice si un movimiento lo registraste vos.

Sobre los montos
----------------
Los montos están en la unidad mínima de la moneda: 150000 son S/ 1500.00.
Así quedan exactos, sin decimales que se redondeen.
`;
}

/**
 * Excel, LibreOffice and Google Sheets evaluate a cell whose FIRST character is
 * one of these as a formula — and LEEME.txt tells the user to open these files
 * in a spreadsheet. A display_name of `=HYPERLINK(...)` or `@SUM(...)` coming
 * from another workspace member would then execute on open. RFC 4180 quoting
 * does not help: the quotes are stripped before the value is interpreted.
 */
const CSV_FORMULA_LEAD = /^[=+\-@\t\r]/;

/** RFC 4180 quoting: only when needed, doubling embedded quotes. */
function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  // ONLY strings are neutralised. Stringifying first turned a numeric -1234
  // into the text '-1234, which a spreadsheet then refuses to sum, sort or
  // chart — every exported amount silently became text. The injection risk
  // only exists for values a person can type; a number cannot carry a formula.
  const isText = typeof value === "string";
  const raw = isText ? value : String(value);
  // A leading apostrophe is the standard neutraliser: spreadsheets read the
  // cell as literal text and do not render the quote. The .json files keep the
  // untouched value, so nothing is lost from the export.
  const text = isText && CSV_FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(columns: readonly string[], rows: readonly Row[]): string {
  const header = columns.join(",");
  const body = rows.map((row) =>
    columns.map((column) => toCsvValue(row[column])).join(","),
  );
  return [header, ...body].join("\n") + "\n";
}

/** YYYY-MM-DD in UTC — stable regardless of the server's timezone. */
function exportDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * fflate's async zip, promisified. NOT zipSync: this runs inside a request
 * handler, and deflating the whole archive on the main thread blocks the event
 * loop for every other in-flight request on the instance.
 */
function zipAsync(files: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

export class ExportAdapter implements ExportPort {
  async exportUserData(
    userId: string,
  ): Promise<Result<ExportArtifact, AuthError>> {
    try {
      const supabase = await createServerClient();
      const schema = supabase.schema("ez_finance");

      const { data: profile, error: profileError } = await schema
        .from("profiles")
        .select(PROFILE_COLUMNS.join(", "))
        .eq("id", userId)
        .single();

      if (profileError) return err(mapSupabaseError(profileError));
      if (!profile) return err({ kind: "Unavailable" });

      // The select lists are built from the column arrays, so supabase-js cannot infer
      // a row type from a literal; the rows come back opaque and are treated as plain
      // records for serialization.
      const profileRow = profile as unknown as Row;

      // Every dataset, read in ONE pass over the table that declares them. Sequential
      // rather than Promise.all on purpose: this runs on a shared free-tier project,
      // and eight concurrent reads from one request is a burst every other app in the
      // fleet pays for. The archive is not on a latency budget — the person is waiting
      // for a download, once.
      const files: Zippable = {
        "perfil.json": strToU8(JSON.stringify(profileRow, null, 2)),
        "perfil.csv": strToU8(toCsv(PROFILE_COLUMNS, [profileRow])),
      };

      for (const dataset of DATASETS) {
        let query = schema
          .from(dataset.table)
          .select(dataset.columns.join(", "));

        if (dataset.scopeToUser !== undefined) {
          query = query.eq(dataset.scopeToUser, userId);
        }

        const { data, error } = await query;

        // A dataset that cannot be read ABORTS the export. A zip that quietly omits
        // the movements is the exact failure this change exists to fix, and it is
        // worse than no zip: the person keeps it and deletes their account.
        if (error) return err(mapSupabaseError(error));

        const returned = (data ?? []) as unknown as Row[];
        const columns = [...dataset.columns];

        // PROJECTED ONTO THE DECLARED COLUMNS, not trusted from the response.
        //
        // Two reasons, and the second is the one that matters. First, LEEME promises the
        // .json and the .csv are the same data in two formats, and the CSV is already
        // built from this list — so anything extra in the response would make the JSON
        // silently wider than its mirror.
        //
        // Second: `created_by` is excluded from the movements by NOT ASKING for it, and
        // "we did not ask" is a guarantee that lasts exactly until someone adds the
        // column to the list for an unrelated reason. Projecting makes the shape of the
        // archive a property of this file rather than of a query string. A test caught
        // the raw UUID reaching movimientos.json for precisely this reason.
        const rows = returned.map((row) => {
          const projected: Row = {};
          for (const column of dataset.columns) projected[column] = row[column];
          return projected;
        });

        // Movements carry WHO recorded them, and in a shared space that is another
        // person's fleet-wide auth UUID. Replaced by a word rather than shipped: the
        // information a person needs is "was this mine", not a UUID they cannot use.
        // The raw column is not in dataset.columns, so it is fetched separately here.
        if (dataset.table === "transactions") {
          columns.push(AUTHOR_COLUMN);

          const { data: authors, error: authorsError } = await schema
            .from("transactions")
            .select("id, created_by");

          if (authorsError) return err(mapSupabaseError(authorsError));

          const authorOf = new Map(
            ((authors ?? []) as unknown as Row[]).map((row) => [
              String(row["id"]),
              row["created_by"],
            ]),
          );

          // The authorship read is a SECOND query on purpose: created_by must not be in
          // the projected columns, or it would land in the archive.

          for (const row of rows) {
            const author = authorOf.get(String(row["id"]));
            row[AUTHOR_COLUMN] =
              author === null || author === undefined
                ? "usuario eliminado"
                : author === userId
                  ? "vos"
                  : "otra persona del espacio";
          }
        }

        files[`${dataset.file}.json`] = strToU8(JSON.stringify(rows, null, 2));
        files[`${dataset.file}.csv`] = strToU8(toCsv(columns, rows));
      }

      files["LEEME.txt"] = strToU8(readme());

      const archive = await zipAsync(files);

      return ok({
        filename: `ez-finance-datos-${exportDate(new Date())}.zip`,
        bytes: archive,
        contentType: "application/zip",
      });
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }
}
