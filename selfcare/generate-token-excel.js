const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const [, , runLogPath, outputPath] = process.argv;

if (!runLogPath) {
  console.error('Usage: node generate-token-excel.js <k6-run-output.log> [output.xlsx]');
  process.exit(1);
}

const output = outputPath || path.join('reports', 'selfcare-tokens.xlsx');
const csvOutput = path.join(__dirname, 'data', 'CustomerIdToken.csv');

function parseLogs(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const entries = [];
  const pattern = /msg="TOKEN_LOG_JSON:(.*)"(?:\s+source=console)?\s*$/;
  for (const line of lines) {
    let jsonText;
    const match = line.match(pattern);
    if (match) {
      // k6 wraps console.log in logfmt: msg="..." with backslash-escaped quotes
      jsonText = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      const idx = line.indexOf('TOKEN_LOG_JSON:');
      if (idx === -1) continue;
      jsonText = line.slice(idx + 'TOKEN_LOG_JSON:'.length).replace(/"\s*$/, '');
    }
    try {
      entries.push(JSON.parse(jsonText));
    } catch {
      // skip malformed line
    }
  }
  return entries;
}

function escapeCsvField(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCustomerIdTokenCsv(entries) {
  const validTokens = entries.filter((entry) => entry.Token);
  if (validTokens.length === 0) {
    console.warn('No successful logins with tokens found; CustomerIdToken.csv not updated');
    return;
  }

  const lines = ['SID,Token'];
  validTokens.forEach((entry) => {
    lines.push(`${escapeCsvField(entry.SID)},${escapeCsvField(entry.Token)}`);
  });

  fs.writeFileSync(csvOutput, lines.join('\n') + '\n');
  console.log(`Updated ${csvOutput} (${validTokens.length} tokens)`);
}

async function run() {
  const entries = parseLogs(runLogPath);
  if (entries.length === 0) {
    console.warn(`No TOKEN_LOG_JSON entries found in ${runLogPath}`);
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Tokens');

  worksheet.columns = [
    { header: 'SID', key: 'SID', width: 20 },
    { header: 'Token', key: 'Token', width: 80, style: { alignment: { wrapText: true } } },
    { header: 'Status', key: 'Status', width: 10 },
    { header: 'Error Message', key: 'ErrorMessage', width: 40 },
  ];
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  entries.forEach((entry) => worksheet.addRow(entry));

  const outDir = path.dirname(output);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  await workbook.xlsx.writeFile(output);
  console.log(`Generated Excel report: ${output} (${entries.length} rows)`);

  writeCustomerIdTokenCsv(entries);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
