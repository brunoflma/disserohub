import { describe, expect, it } from 'vitest';
import { parseWindowsProjectRoots } from './roots';

describe('Windows project roots', () => {
  it('lists both local drive letters, normalizes and deduplicates them', () => {
    const values = '\\DosDevices\\D:    REG_BINARY    010203\n\\DosDevices\\c:    REG_BINARY    aabbcc\n\\DosDevices\\C:    REG_BINARY    010203';
    expect(parseWindowsProjectRoots(values)).toEqual([{ name: 'C:', path: 'C:\\' }, { name: 'D:', path: 'D:\\' }]);
    expect(parseWindowsProjectRoots('\\DosDevices\\D:    REG_BINARY    010203')).toEqual([{ name: 'D:', path: 'D:\\' }]);
  });
  it('accepts no paths, URLs, network shares or arbitrary objects as drive letters', () => {
    expect(parseWindowsProjectRoots('\\DosDevices\\https://example.test\n//server/share\nC:/project\n\\DosDevices\\Z: REG_SZ text')).toEqual([]);
    expect(parseWindowsProjectRoots('')).toEqual([]);
  });
});
