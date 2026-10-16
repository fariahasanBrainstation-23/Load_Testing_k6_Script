export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map((h) => h.trim());

  return lines
    .slice(1)
    .map((line) => {
      const values = line.split(',').map((v) => v.trim());
      const row = {};
      headers.forEach((header, i) => {
        row[header] = values[i];
      });
      return row;
    })
    // Skip rows where every column is empty -- a trailing blank line (or a bare "," in the file) would
    // otherwise become a real row with empty values, e.g. an actual login attempt with "" as the username.
    .filter((row) => Object.values(row).some((v) => v));
}
