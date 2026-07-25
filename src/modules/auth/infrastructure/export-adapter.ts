// export-adapter.ts — implements ExportPort: packs the caller's ez_finance
// data into a ZIP (JSON + CSV mirrors) so it can be downloaded before deleting
// the account, per the data-portability requirement.
//
// SCOPE: reads go through the user's own session, so RLS is what limits the
// archive to their data — the adapter never uses a service key and never
// widens visibility. Fase 3+ datasets (accounts, categories, transactions)
// plug in by adding entries to DATASETS.
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
 * Column lists are explicit (not `select *`) so the CSV header and column
 * order stay stable, and an empty dataset still exports a valid header row.
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

const WORKSPACE_COLUMNS = [
  "id",
  "name",
  "type",
  "created_at",
  "archived_at",
  "deleted_at",
] as const;

const MEMBER_COLUMNS = [
  "member_id",
  "workspace_id",
  "user_id",
  "display_name_snapshot",
  "role",
  "joined_at",
] as const;

const README = `Exportación de datos de ez finance
==================================

Este archivo contiene una copia de tus datos en ez finance al momento de la
exportación. Cada conjunto de datos viene en dos formatos:

  perfil.json / perfil.csv           Tu perfil (nombre, idioma, moneda).
  espacios.json / espacios.csv       Los espacios de los que sos parte.
  membresias.json / membresias.csv   Tus membresías en esos espacios.

Los archivos .json conservan los tipos originales; los .csv se pueden abrir
con cualquier planilla de cálculo.
`;

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
  const raw = typeof value === "string" ? value : String(value);
  // A leading apostrophe is the standard neutraliser: spreadsheets read the
  // cell as literal text and do not render the quote. The .json files keep the
  // untouched value, so nothing is lost from the export.
  const text = CSV_FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
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

      const { data: workspaces, error: workspacesError } = await schema
        .from("workspaces")
        .select(WORKSPACE_COLUMNS.join(", "));

      if (workspacesError) return err(mapSupabaseError(workspacesError));

      // Explicitly scoped to the caller. RLS alone is NOT enough here: the
      // workspace_members SELECT policy deliberately exposes every member of a
      // workspace you belong to, so an unfiltered read would ship the other
      // members' fleet-wide auth UUIDs, names and roles inside an archive
      // documented as "Tus membresías".
      const { data: members, error: membersError } = await schema
        .from("workspace_members")
        .select(MEMBER_COLUMNS.join(", "))
        .eq("user_id", userId);

      if (membersError) return err(mapSupabaseError(membersError));

      // The select lists are built from the column arrays, so supabase-js
      // cannot infer a row type from a literal; the rows come back opaque and
      // are treated as plain records for serialization.
      const profileRow = profile as unknown as Row;
      const workspaceRows = (workspaces ?? []) as unknown as Row[];
      const memberRows = (members ?? []) as unknown as Row[];

      const archive = await zipAsync({
        "LEEME.txt": strToU8(README),
        "perfil.json": strToU8(JSON.stringify(profileRow, null, 2)),
        "perfil.csv": strToU8(toCsv(PROFILE_COLUMNS, [profileRow])),
        "espacios.json": strToU8(JSON.stringify(workspaceRows, null, 2)),
        "espacios.csv": strToU8(toCsv(WORKSPACE_COLUMNS, workspaceRows)),
        "membresias.json": strToU8(JSON.stringify(memberRows, null, 2)),
        "membresias.csv": strToU8(toCsv(MEMBER_COLUMNS, memberRows)),
      });

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
