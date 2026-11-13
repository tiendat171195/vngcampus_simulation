import { describe, expect, it } from 'vitest';
import { parseDepartmentsCsv } from './departments';

describe('department CSV', () => {
  it('reads names and parents, quotes, a byte-order mark and Windows line ends', () => {
    const text =
      '﻿name,parent\r\nKhối Công nghệ,\r\n"Phòng Nền tảng, Hạ tầng",Khối Công nghệ\r\n\r\nNhân sự\r\n';
    expect(parseDepartmentsCsv(text)).toEqual([
      { name: 'Khối Công nghệ', parent: null },
      { name: 'Phòng Nền tảng, Hạ tầng', parent: 'Khối Công nghệ' },
      { name: 'Nhân sự', parent: null },
    ]);
  });

  it('accepts a file with only names', () => {
    expect(parseDepartmentsCsv('Name\nA\nB')).toEqual([
      { name: 'A', parent: null },
      { name: 'B', parent: null },
    ]);
  });

  it('says what is wrong, with the row number', () => {
    expect(() => parseDepartmentsCsv('title\nA')).toThrow(/name/);
    expect(() => parseDepartmentsCsv('name\nA\nA')).toThrow(/Row 3/);
    expect(() => parseDepartmentsCsv('name,parent\nA,B')).toThrow(/parent "B"/);
    expect(() => parseDepartmentsCsv('name\n,')).toThrow(/Row 2: the name is empty/);
  });
});
