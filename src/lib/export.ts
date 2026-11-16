/** Guards against spreadsheet formula injection when exporting user-entered text. */
function safeCell(v: unknown): unknown {
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

export async function downloadXlsx(filename: string, sheetName: string, rows: Record<string, unknown>[]) {
  const XLSX = await import("xlsx");
  const safe = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)])));
  const ws = XLSX.utils.json_to_sheet(safe);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}
