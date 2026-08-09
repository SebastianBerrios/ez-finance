import { describe, expect, it } from "vitest";

import { toCsv, toCsvValue } from "./csv";

describe("toCsvValue", () => {
  it("leaves a plain value alone", () => {
    expect(toCsvValue("Supermercado")).toBe("Supermercado");
    expect(toCsvValue(1500)).toBe("1500");
  });

  it("writes an empty cell for null and undefined", () => {
    // Distinct from the string "null", which is what String() would produce and
    // what a spreadsheet would then show as a category name.
    expect(toCsvValue(null)).toBe("");
    expect(toCsvValue(undefined)).toBe("");
  });

  it("quotes a value containing a comma, a quote or a newline", () => {
    expect(toCsvValue("Ropa, calzado")).toBe('"Ropa, calzado"');
    expect(toCsvValue('Dijo "hola"')).toBe('"Dijo ""hola"""');
    expect(toCsvValue("dos\nlíneas")).toBe('"dos\nlíneas"');
  });

  it("neutralises a value a spreadsheet would RUN", () => {
    // The reason this module exists. A category named =HYPERLINK(...) is a
    // clickable payload in every major spreadsheet, and quoting does not stop it:
    // the quotes are removed before the cell is interpreted.
    expect(toCsvValue("=1+1")).toBe("'=1+1");
    expect(toCsvValue("@SUM(1+1)")).toBe("'@SUM(1+1)");
    expect(toCsvValue("+49 351 0000")).toBe("'+49 351 0000");
    expect(toCsvValue("-cmd")).toBe("'-cmd");
  });

  it("does NOT neutralise a negative NUMBER", () => {
    // The bug this rule was written around: stringifying first turned -1234 into
    // the text '-1234, and a spreadsheet then refuses to sum, sort or chart the
    // column. Every exported amount silently became text. A number cannot carry a
    // formula, so only strings are touched.
    expect(toCsvValue(-1234)).toBe("-1234");
    expect(toCsvValue(-0.5)).toBe("-0.5");
  });
});

describe("toCsv", () => {
  it("writes a header and one line per row, in the column order given", () => {
    const csv = toCsv(
      ["categoria", "cubo", "total"],
      [
        { categoria: "Supermercado", cubo: "need", total: 31000 },
        { total: 4500, cubo: "want", categoria: "Salidas" },
      ],
    );

    expect(csv).toBe(
      "categoria,cubo,total\n" +
        "Supermercado,need,31000\n" +
        "Salidas,want,4500\n",
    );
  });

  it("still writes the header when there are no rows", () => {
    // A month with no movements is a valid report. A file with no header is a file
    // a spreadsheet cannot label, and an empty file looks like a failed export.
    expect(toCsv(["categoria", "total"], [])).toBe("categoria,total\n");
  });

  it("writes an empty cell for a column a row does not carry", () => {
    expect(toCsv(["a", "b"], [{ a: 1 }])).toBe("a,b\n1,\n");
  });
});
