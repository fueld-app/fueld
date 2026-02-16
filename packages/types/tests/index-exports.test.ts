import { describe, expect, test } from 'bun:test';
import * as Barrel from '../src/index';
import * as Enums from '../src/enums';

describe('index exports', () => {
  test('re-exports all runtime enum symbols', () => {
    const enumKeys = Object.keys(Enums).sort();
    const barrelKeys = Object.keys(Barrel).sort();

    for (const key of enumKeys) {
      expect(barrelKeys).toContain(key);
      expect((Barrel as Record<string, unknown>)[key]).toBe(
        (Enums as Record<string, unknown>)[key],
      );
    }
  });
});
