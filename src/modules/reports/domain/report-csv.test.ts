import { describe, expect, it } from "vitest";

import { toCsv } from "@shared/domain/csv";
import { fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";

import type { MonthlyReport } from "./monthly-report";
import { REPORT_CSV_COLUMNS, reportCsvRows } from "./report-csv";

const pen = (minorUnits: bigint) => expectOk(fromMinorUnits("PEN", minorUnits));

function makeReport(overrides: Partial<MonthlyReport> = {}): MonthlyReport {
  return {
    income: pen(500000n),
    expense: pen(315000n),
    byBucket: { need: pen(200000n), want: pen(100000n), save: pen(10000n) },
    unbucketed: pen(5000n),
    byCategory: [
      { categoryId: "cat-1", bucket: "need", total: pen(200000n) },
      { categoryId: "cat-2", bucket: "want", total: pen(100000n) },
      { categoryId: null, bucket: null, total: pen(5000n) },
    ],
    ...overrides,
  };
}

const BUCKETS = {
  need: "Necesidades",
  want: "Deseos",
  save: "Ahorro",
} as const;

const NAMES = {
  categories: new Map([
    ["cat-1", "Supermercado"],
    ["cat-2", "Salidas"],
  ]),
  buckets: BUCKETS,
};

describe("reportCsvRows", () => {
  it("writes the summary, the buckets and the categories as ONE table", () => {
    const rows = reportCsvRows(makeReport(), NAMES, "2026-08");

    // 2 summary + 3 buckets + 1 "Sin cubo" + 3 categories.
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r["seccion"])).toEqual([
      "resumen",
      "resumen",
      "cubo",
      "cubo",
      "cubo",
      "cubo",
      "categoria",
      "categoria",
      "categoria",
    ]);
  });

  it("writes amounts as decimal text, sliced rather than divided", () => {
    // 500000 minor units is 5000.00, and this is the artefact people sum in a
    // spreadsheet — a float division here would be the one place a rounding error
    // is guaranteed to be noticed.
    const rows = reportCsvRows(makeReport(), NAMES, "2026-08");

    expect(rows[0]).toMatchObject({
      concepto: "Ingreso",
      monto: "5000.00",
      moneda: "PEN",
    });
    expect(rows[1]).toMatchObject({ concepto: "Gasto", monto: "3150.00" });
  });

  it("pads an amount below one unit instead of dropping the zero", () => {
    const rows = reportCsvRows(
      makeReport({ unbucketed: pen(5n) }),
      NAMES,
      "2026-08",
    );

    const sinCubo = rows.find((r) => r["concepto"] === "Sin cubo");
    expect(sinCubo?.["monto"]).toBe("0.05");
  });

  it("names uncategorised spending rather than leaving the cell blank", () => {
    const rows = reportCsvRows(makeReport(), NAMES, "2026-08");

    const last = rows[rows.length - 1];
    expect(last).toMatchObject({ concepto: "Sin categoría", cubo: "" });
  });

  it("falls back to the id for a category it cannot name", () => {
    // A category removed out from under a historical month still spent the money.
    // Dropping the row would make the detail stop adding up to the total, which is
    // worse than showing an id.
    const rows = reportCsvRows(
      makeReport(),
      { categories: new Map(), buckets: BUCKETS },
      "2026-08",
    );

    expect(rows.map((r) => r["concepto"])).toContain("cat-1");
  });

  it("keeps the month on every row so several can be concatenated", () => {
    const august = reportCsvRows(makeReport(), NAMES, "2026-08");
    const july = reportCsvRows(makeReport(), NAMES, "2026-07");

    expect(august.every((r) => r["mes"] === "2026-08")).toBe(true);
    expect(july.every((r) => r["mes"] === "2026-07")).toBe(true);
  });

  it("includes Sin cubo even at zero", () => {
    // A row that appears only sometimes is a row no formula can rely on.
    const rows = reportCsvRows(
      makeReport({ unbucketed: pen(0n) }),
      NAMES,
      "2026-08",
    );

    expect(rows.find((r) => r["concepto"] === "Sin cubo")?.["monto"]).toBe(
      "0.00",
    );
  });

  it("produces a file whose header is the declared column order", () => {
    const csv = toCsv(
      REPORT_CSV_COLUMNS,
      reportCsvRows(makeReport(), NAMES, "2026-08"),
    );

    expect(csv.split("\n")[0]).toBe("mes,seccion,concepto,cubo,monto,moneda");
    expect(csv.split("\n")[1]).toBe("2026-08,resumen,Ingreso,,5000.00,PEN");
  });

  it("quotes a category name containing a comma", () => {
    // Through toCsv, which is the shared writer — asserted here because this is the
    // export people actually open, and a broken column shift is silent.
    const csv = toCsv(
      REPORT_CSV_COLUMNS,
      reportCsvRows(
        makeReport(),
        {
          categories: new Map([
            ["cat-1", "Ropa, calzado"],
            ["cat-2", "Salidas"],
          ]),
          buckets: BUCKETS,
        },
        "2026-08",
      ),
    );

    expect(csv).toContain('"Ropa, calzado"');
  });
});
