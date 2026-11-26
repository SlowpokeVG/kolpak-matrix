// Kolpak: recognising a room-key export (what Element's "Export E2E room keys" writes, and
// Sable's own "Export Messages Data"). The format is the same everywhere: an ASCII-armoured
// block that starts with this line, encrypted with the passphrase chosen at export.

const HEADER = '-----BEGIN MEGOLM SESSION DATA-----';

/** Whether the start of a file is a room-key export. Looks at the first few hundred bytes. */
export function looksLikeKeyExport(start: ArrayBuffer | Uint8Array): boolean {
  const bytes = start instanceof Uint8Array ? start : new Uint8Array(start);
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 256))
    // A byte-order mark or blank lines before the header are harmless.
    .replace(/^﻿/, '')
    .trimStart();
  return head.startsWith(HEADER);
}
