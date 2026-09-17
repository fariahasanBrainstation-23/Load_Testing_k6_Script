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
  { header: 'Request Payload', key: 'RequestPayload' },
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

const summaryColumns = [
  { header: 'API Name', key: 'APIName' },
  { header: 'Count', key: 'Count' },
  { header: 'Error Count', key: 'ErrorCount' },
  { header: 'Error Rate (%)', key: 'ErrorRate' },
  { header: 'Avg (ms)', key: 'Avg' },
  { header: 'p95 (ms)', key: 'P95' },
  { header: 'p99 (ms)', key: 'P99' },
  { header: 'Max (ms)', key: 'Max' },
  { header: '% of Total Flow Time', key: 'FlowTimeShare' },
];

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(Math.max(idx, 0), sortedValues.length - 1)];
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function buildApiSummary(entries) {
  const byApi = new Map();

  for (const entry of entries) {
    const name = entry.APIName || '(unknown)';
    if (!byApi.has(name)) byApi.set(name, { times: [], errorCount: 0 });
    const bucket = byApi.get(name);
    const time = Number(entry.ResponseTime);
    if (!Number.isNaN(time)) bucket.times.push(time);
    const status = Number(entry.StatusCode);
    if (!status || status < 200 || status >= 300) bucket.errorCount++;
  }

  const totalFlowTime = entries.reduce((sum, e) => sum + (Number(e.ResponseTime) || 0), 0) || 1;

  const rows = [];
  for (const [name, bucket] of byApi.entries()) {
    const sorted = [...bucket.times].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((s, v) => s + v, 0);
    rows.push({
      APIName: name,
      Count: count,
      ErrorCount: bucket.errorCount,
      ErrorRate: count ? round1((bucket.errorCount / count) * 100) : 0,
      Avg: count ? round1(sum / count) : null,
      P95: percentile(sorted, 95) !== null ? round1(percentile(sorted, 95)) : null,
      P99: percentile(sorted, 99) !== null ? round1(percentile(sorted, 99)) : null,
      Max: count ? round1(sorted[count - 1]) : null,
      FlowTimeShare: round1((sum / totalFlowTime) * 100),
    });
  }

  // Highest error rate first, then highest p95 -- worst offenders surface at the top.
  rows.sort((a, b) => b.ErrorRate - a.ErrorRate || (b.P95 || 0) - (a.P95 || 0));
  return rows;
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

  const summaryWorksheet = workbook.addWorksheet('API Summary');
  summaryWorksheet.columns = summaryColumns.map((col) => ({
    header: col.header,
    key: col.key,
    width: 20,
    alignment: { wrapText: true, vertical: 'top' },
  }));
  summaryWorksheet.getRow(1).font = { bold: true };
  summaryWorksheet.views = [{ state: 'frozen', ySplit: 1 }];

  buildApiSummary(entries).forEach((row) => summaryWorksheet.addRow(row));
  autoFitColumns(summaryWorksheet);

  const outDir = path.dirname(output);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  await workbook.xlsx.writeFile(output);
  console.log(`Generated Excel report: ${output} (${entries.length} requests)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
