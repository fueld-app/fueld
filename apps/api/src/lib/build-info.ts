import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BuildInfo {
  appVersion: string;
  deployVersion: string;
  gitSha: string;
  gitBranch: string;
  buildTime: string;
  backupFormatVersion: number;
  githubRunNumber: number | null;
}

const DEFAULT_BUILD_INFO: BuildInfo = {
  appVersion: '0.1.0',
  deployVersion: '0.1.0+local',
  gitSha: 'unknown',
  gitBranch: 'unknown',
  buildTime: new Date(0).toISOString(),
  backupFormatVersion: 1,
  githubRunNumber: null,
};

let cachedBuildInfo: BuildInfo | null = null;

function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    process.env['BUILD_INFO_PATH'] ?? '',
    join(cwd, 'build-info.json'),
    join(cwd, 'dist', 'build-info.json'),
    join(import.meta.dir, '../../../build-info.json'),
    join(import.meta.dir, '../../../../build-info.json'),
    '/opt/fueld/build-info.json',
  ].filter(Boolean);
}

function loadBuildInfo(): BuildInfo {
  for (const filePath of candidatePaths()) {
    try {
      if (!existsSync(filePath)) continue;
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<BuildInfo>;
      if (!parsed.appVersion || !parsed.deployVersion) continue;
      return {
        appVersion: parsed.appVersion,
        deployVersion: parsed.deployVersion,
        gitSha: parsed.gitSha ?? DEFAULT_BUILD_INFO.gitSha,
        gitBranch: parsed.gitBranch ?? DEFAULT_BUILD_INFO.gitBranch,
        buildTime: parsed.buildTime ?? DEFAULT_BUILD_INFO.buildTime,
        backupFormatVersion: parsed.backupFormatVersion ?? DEFAULT_BUILD_INFO.backupFormatVersion,
        githubRunNumber: parsed.githubRunNumber ?? DEFAULT_BUILD_INFO.githubRunNumber,
      };
    } catch {
      // ignore invalid build info and continue to the next path
    }
  }

  return DEFAULT_BUILD_INFO;
}

export function getBuildInfo(): BuildInfo {
  if (!cachedBuildInfo) {
    cachedBuildInfo = loadBuildInfo();
  }
  return cachedBuildInfo;
}

export function resetBuildInfoCacheForTests(): void {
  cachedBuildInfo = null;
}