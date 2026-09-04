import type { ArchiveEntry } from "@romdeck/core";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const UINT32_MAX = 0xffffffff;

export interface ZipCentralDirectory {
  entries: ArchiveEntry[];
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  zip64: boolean;
}

export function parseZipCentralDirectory(buffer: Uint8Array, archiveSize: number, bufferStartOffset = 0): ZipCentralDirectory {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) {
    throw new Error("ZIP central directory was not found.");
  }

  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const zip64 = centralDirectorySize === UINT32_MAX || centralDirectoryOffset === UINT32_MAX;
  if (zip64) {
    return { entries: [], centralDirectoryOffset, centralDirectorySize, zip64 };
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  const bufferEndOffset = bufferStartOffset + buffer.byteLength;
  if (centralDirectoryOffset < bufferStartOffset || centralDirectoryEnd > bufferEndOffset || centralDirectoryEnd > archiveSize) {
    throw new Error("ZIP central directory bytes are incomplete.");
  }

  const relativeStart = centralDirectoryOffset - bufferStartOffset;
  return {
    entries: parseCentralDirectoryEntries(buffer.subarray(relativeStart, relativeStart + centralDirectorySize)),
    centralDirectoryOffset,
    centralDirectorySize,
    zip64: false
  };
}

export function parseCentralDirectoryEntries(buffer: Uint8Array): ArchiveEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const decoder = new TextDecoder("utf-8");
  const entries: ArchiveEntry[] = [];
  let offset = 0;

  while (offset + 46 <= buffer.byteLength) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      break;
    }

    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.byteLength) {
      break;
    }

    const name = decoder.decode(buffer.subarray(nameStart, nameEnd));
    if (!name.endsWith("/")) {
      entries.push({
        name,
        size: uncompressedSize === UINT32_MAX ? undefined : uncompressedSize
      });
    }

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}
