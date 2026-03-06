export interface RestoreState {
  active: boolean;
  startedAt: string | null;
  message: string | null;
}

const restoreState: RestoreState = {
  active: false,
  startedAt: null,
  message: null,
};

export function beginRestoreMode(message = 'Backup restore in progress'): void {
  restoreState.active = true;
  restoreState.startedAt = new Date().toISOString();
  restoreState.message = message;
}

export function endRestoreMode(): void {
  restoreState.active = false;
  restoreState.startedAt = null;
  restoreState.message = null;
}

export function getRestoreState(): RestoreState {
  return { ...restoreState };
}

export function isRestoreModeActive(): boolean {
  return restoreState.active;
}