const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const [, , runLogPath, outputPath] = process.argv;

if (!runLogPath) {
  console.error('Usage: node generate-excel-report.js <k6-run-output.log> [output.xlsx]');
  process.exit(1);
}

const output = outputPath || path.join('reports', 'request-report.xlsx');

const columns = [
  { header: 'Timestamp', key: 'Timestamp' },
  { header: 'Script Name', key: 'ScriptName' },
  { header: 'VU Number', key: 'VUNumber' },
  { header: 'Iteration Number', key: 'IterationNumber' },
  { header: 'API Name', key: 'APIName' },
  { header: 'Request Method', key: 'RequestMethod' },
  { header: 'URL', key: 'URL' },
  { header: 'Status Code', key: 'StatusCode' },
  { header: 'Error Message', key: 'ErrorMessage' },
  { header: 'Response Time (ms)', key: 'ResponseTime' },
  { header: 'Response Body', key: 'ResponseBody' },
];

function parseLogs(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const entries = [];
  const pattern = /msg="REQ_LOG_JSON:(.*)"(?:\s+source=console)?\s*$/;
  for (const line of lines) {
    let jsonText;
    const match = line.match(pattern);
    if (match) {
      // k6 wraps console.log in logfmt: msg="..." with backslash-escaped quotes
      jsonText = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      const idx = line.indexOf('REQ_LOG_JSON:');
      if (idx === -1) continue;
      jsonText = line.slice(idx + 'REQ_LOG_JSON:'.length).replace(/"\s*$/, '');
    }
    try {
      entries.push(JSON.parse(jsonText));
    } catch {
      // skip malformed line
    }
  }
  return entries;
}

function autoFitColumns(worksheet) {
  worksheet.columns.forEach((column) => {
    let maxLength = 10;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const text = cell.value === null || cell.value === undefined ? '' : cell.value.toString();
      maxLength = Math.max(maxLength, Math.min(80, text.length));
    });
    column.width = maxLength + 2;
  });
}

async function run() {
  const entries = parseLogs(runLogPath);
  if (entries.length === 0) {
    console.warn(`No REQ_LOG_JSON entries found in ${runLogPath}`);
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Request Log');

  worksheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: 20,
    alignment: { wrapText: true, vertical: 'top' },
  }));
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  entries.forEach((entry) => worksheet.addRow(entry));
  autoFitColumns(worksheet);

  const outDir = path.dirname(output);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  await workbook.xlsx.writeFile(output);
  console.log(`Generated Excel report: ${output} (${entries.length} requests)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
