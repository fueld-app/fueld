import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const rawDir = process.env['PW_COVERAGE_DIR'] ?? 'coverage/e2e/raw';
const reportDir = 'coverage/e2e';
const summaryFile = join(reportDir, 'summary.json');

function walkJsonFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsonFiles(absolute));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(absolute);
    }
  }
  return out;
}

function mergeRanges(ranges) {
  if (!ranges.length) return [];
  const sorted = ranges.slice().sort((left, right) => left[0] - right[0]);
  const merged = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    const [start, end] = sorted[index];
    const current = merged[merged.length - 1];
    if (start <= current[1]) {
      current[1] = Math.max(current[1], end);
      continue;
    }
    merged.push([start, end]);
  }
  return merged;
}

function bytesFromRanges(ranges) {
  let total = 0;
  for (const [start, end] of ranges) {
    total += Math.max(0, end - start);
  }
  return total;
}

function isAppScriptUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http://localhost:4200/')) return false;
  if (!url.endsWith('.js')) return false;
  if (url.includes('/node_modules/')) return false;
  if (url.includes('/@vite/client')) return false;
  if (url.includes('/@react-refresh')) return false;
  if (url.includes('playwright')) return false;
  return true;
}

if (!existsSync(rawDir)) {
  console.error(`No E2E coverage artifacts found at ${rawDir}.`);
  console.error('Run with PW_COVERAGE=1 to collect browser coverage first.');
  process.exit(1);
}

const files = walkJsonFiles(rawDir);
if (!files.length) {
  console.error(`No coverage JSON files found in ${rawDir}.`);
  process.exit(1);
}

const byUrl = new Map();
let testArtifactCount = 0;

for (const filePath of files) {
  const raw = readFileSync(filePath, 'utf8');
  const payload = JSON.parse(raw);
  const jsEntries = Array.isArray(payload?.js) ? payload.js : [];
  testArtifactCount += 1;

  for (const entry of jsEntries) {
    const url = entry?.url;
    const text = typeof entry?.text === 'string'
      ? entry.text
      : typeof entry?.source === 'string'
        ? entry.source
        : '';
    if (!isAppScriptUrl(url) || !text.length) continue;

    const fileTotalBytes = text.length;
    const coveredRanges = [];
    for (const fn of entry.functions ?? []) {
      for (const range of fn.ranges ?? []) {
        if ((range.count ?? 0) > 0) {
          coveredRanges.push([range.startOffset, range.endOffset]);
        }
      }
    }

    const merged = mergeRanges(coveredRanges);
    const existing = byUrl.get(url);
    if (!existing) {
      byUrl.set(url, { totalBytes: fileTotalBytes, ranges: merged });
      continue;
    }
    existing.totalBytes = Math.max(existing.totalBytes, fileTotalBytes);
    existing.ranges.push(...merged);
  }
}

const filesSummary = [...byUrl.entries()]
  .map(([url, values]) => {
    const merged = mergeRanges(values.ranges);
    const coveredBytes = bytesFromRanges(merged);
    const percent = values.totalBytes ? (coveredBytes / values.totalBytes) * 100 : 0;
    return {
      url,
      totalBytes: values.totalBytes,
      coveredBytes,
      coveragePercent: Number(percent.toFixed(2)),
    };
  })
  .sort((left, right) => right.totalBytes - left.totalBytes);

const totalBytes = filesSummary.reduce((sum, file) => sum + file.totalBytes, 0);
const coveredBytes = filesSummary.reduce((sum, file) => sum + file.coveredBytes, 0);
const coveragePercent = totalBytes ? Number(((coveredBytes / totalBytes) * 100).toFixed(2)) : 0;

const summary = {
  generatedAt: new Date().toISOString(),
  testArtifactCount,
  scriptFileCount: filesSummary.length,
  totalBytes,
  coveredBytes,
  coveragePercent,
  files: filesSummary,
};

mkdirSync(reportDir, { recursive: true });
writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8');

console.log('E2E browser coverage summary');
console.log(`- Test artifacts: ${testArtifactCount}`);
console.log(`- Script files: ${filesSummary.length}`);
console.log(`- JS bytes covered: ${coveredBytes}/${totalBytes} (${coveragePercent}%)`);
console.log(`- Summary JSON: ${summaryFile}`);
