import { describe, expect, it } from 'vitest';
import { looksLikeKeyExport } from './keyExport';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('looksLikeKeyExport', () => {
  it('accepts an Element or Sable key export', () => {
    expect(
      looksLikeKeyExport(bytes('-----BEGIN MEGOLM SESSION DATA-----\nAXxx\n-----END MEGOLM'))
    ).toBe(true);
  });

  it('tolerates a byte-order mark and leading blank lines', () => {
    expect(looksLikeKeyExport(bytes('﻿\r\n\n-----BEGIN MEGOLM SESSION DATA-----\n'))).toBe(true);
  });

  it('rejects other files', () => {
    expect(looksLikeKeyExport(bytes('just some notes'))).toBe(false);
    expect(looksLikeKeyExport(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(looksLikeKeyExport(new Uint8Array())).toBe(false);
  });
});
