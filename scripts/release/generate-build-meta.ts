import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface BuildInfo {
  appVersion: string;
  deployVersion: string;
  gitSha: string;
  gitBranch: string;
  buildTime: string;
  backupFormatVersion: number;
  githubRunNumber: number | null;
}

function readTrimmed(filePath: string): string {
  return readFileSync(filePath, 'utf8').trim();
}

const rootDir = join(import.meta.dir, '../..');
const versionFile = join(rootDir, 'VERSION');

if (!existsSync(versionFile)) {
  throw new Error(`VERSION file not found at ${versionFile}`);
}

const appVersion = process.env['APP_VERSION']?.trim() || readTrimmed(versionFile);
const gitSha = (process.env['GIT_SHA']?.trim() || 'unknown').slice(0, 40);
const gitBranch = process.env['GIT_BRANCH']?.trim() || 'unknown';
const buildTime = process.env['BUILD_TIME']?.trim() || new Date().toISOString();
const githubRunRaw = process.env['GITHUB_RUN_NUMBER']?.trim();
const githubRunNumber = githubRunRaw ? Number(githubRunRaw) : null;
const deployVersion = process.env['DEPLOY_VERSION']?.trim()
  || `${appVersion}+deploy.${githubRunNumber ?? 'local'}.sha.${gitSha.slice(0, 7) || 'unknown'}`;

const buildInfo: BuildInfo = {
  appVersion,
  deployVersion,
  gitSha,
  gitBranch,
  buildTime,
  backupFormatVersion: 1,
  githubRunNumber: Number.isFinite(githubRunNumber) ? githubRunNumber : null,
};

const outDir = join(rootDir, 'dist');
mkdirSync(outDir, { recursive: true });

for (const filePath of [join(rootDir, 'build-info.json'), join(outDir, 'build-info.json')]) {
  writeFileSync(filePath, `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(buildInfo));