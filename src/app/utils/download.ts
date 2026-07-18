import FileSaver from 'file-saver';
import { isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';
import { fetch } from '$utils/fetch';

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/g;
const CONTROL_CHARS = /\p{Cc}/gu;
const BIDI_CONTROL_CHARS = /[\u202a-\u202e\u2066-\u2069]/g;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_FILENAME_LENGTH = 255;

const nonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const getAttachmentFilename = (
  filename: unknown,
  body: unknown,
  fallback = 'download'
): string => nonEmptyString(filename) ?? nonEmptyString(body) ?? fallback;

export const sanitizeDownloadFilename = (filename: string, fallback = 'download'): string => {
  let safeName = filename
    .replace(INVALID_FILENAME_CHARS, '_')
    .replace(CONTROL_CHARS, '_')
    .replace(BIDI_CONTROL_CHARS, '')
    .trim()
    .replace(/[. ]+$/g, '');

  if (!safeName || safeName === '.' || safeName === '..') safeName = fallback;
  if (WINDOWS_RESERVED_NAME.test(safeName)) safeName = `_${safeName}`;

  if (safeName.length > MAX_FILENAME_LENGTH) {
    const extensionStart = safeName.lastIndexOf('.');
    const extension = extensionStart > 0 ? safeName.slice(extensionStart) : '';
    const extensionLength = Math.min(extension.length, 32);
    safeName = `${safeName.slice(0, MAX_FILENAME_LENGTH - extensionLength)}${extension.slice(
      -extensionLength
    )}`;
  }

  return safeName;
};

export const getDownloadFilename = (
  filename: unknown,
  body?: unknown,
  fallback = 'download'
): string => sanitizeDownloadFilename(getAttachmentFilename(filename, body, fallback), fallback);

async function resolveBlob(input: Blob | string): Promise<Blob> {
  if (typeof input !== 'string') return input;
  const response = await fetch(input);
  return response.blob();
}

// On Android the browser anchor download is a no-op (the WebView has no download
// handler), so route through the native file system plugin; elsewhere file-saver works.
export async function saveFileToDevice(
  input: Blob | string,
  filename: string,
  mimeType?: string
): Promise<void> {
  if (isTauri() && osType() === 'android') {
    const blob = await resolveBlob(input);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { AndroidFs, AndroidPublicGeneralPurposeDir } =
      await import('tauri-plugin-android-fs-api');
    const uri = await AndroidFs.createNewPublicFile(
      AndroidPublicGeneralPurposeDir.Download,
      filename,
      mimeType || blob.type || null
    );
    await AndroidFs.writeFile(uri, bytes);
    return;
  }

  FileSaver.saveAs(input, filename);
}
