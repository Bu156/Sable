import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FileSaver from 'file-saver';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';
import { showToast } from '$state/toast';
import { saveFileToDevice } from './download';

const mocks = vi.hoisted(() => ({
  androidFs: {
    checkPublicFilesPermission: vi.fn<() => Promise<boolean>>(),
    requestPublicFilesPermission: vi.fn<() => Promise<boolean>>(),
    createNewPublicFile: vi.fn<() => Promise<string>>(),
    writeFile: vi.fn<() => Promise<void>>(),
    setPublicFilePending: vi.fn<() => Promise<void>>(),
    scanPublicFile: vi.fn<() => Promise<void>>(),
    removeFile: vi.fn<() => Promise<void>>(),
  },
  save: vi.fn<(options?: { defaultPath?: string }) => Promise<string | null>>(),
  writeFile: vi.fn<(path: string | URL, data: Uint8Array) => Promise<void>>(),
  saveAs: vi.fn<(data: Blob | string, filename?: string) => void>(),
  invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  isTauri: vi.fn<() => boolean>(),
  osType: vi.fn<() => string>(),
  showToast: vi.fn<(text: string, durationMs?: number) => void>(),
}));
const { androidFs, save, writeFile } = mocks;

vi.mock('file-saver', () => ({ default: { saveAs: mocks.saveAs } }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));
vi.mock('@tauri-apps/plugin-os', () => ({ type: mocks.osType }));
vi.mock('$state/toast', () => ({ showToast: mocks.showToast }));
vi.mock('tauri-plugin-android-fs-api', () => ({
  AndroidFs: mocks.androidFs,
  AndroidPublicGeneralPurposeDir: { Download: 'Download' },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: mocks.writeFile }));

describe('saveFileToDevice', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(osType).mockReturnValue('android');
    vi.mocked(invoke).mockResolvedValue(true);
    androidFs.checkPublicFilesPermission.mockResolvedValue(true);
    androidFs.requestPublicFilesPermission.mockResolvedValue(true);
    androidFs.createNewPublicFile.mockResolvedValue('content://download/file');
    androidFs.writeFile.mockResolvedValue(undefined);
    androidFs.setPublicFilePending.mockResolvedValue(undefined);
    androidFs.scanPublicFile.mockResolvedValue(undefined);
    androidFs.removeFile.mockResolvedValue(undefined);
    save.mockResolvedValue(null);
    writeFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('scans an Android Downloads file after making it public', async () => {
    await saveFileToDevice(new Blob(['data'], { type: 'text/plain' }), 'file.txt');

    expect(androidFs.createNewPublicFile).toHaveBeenCalledWith(
      'Download',
      'file.txt',
      'text/plain',
      { isPending: true, requestPermission: true }
    );
    expect(androidFs.setPublicFilePending).toHaveBeenCalledWith('content://download/file', false);
    expect(androidFs.scanPublicFile).toHaveBeenCalledWith('content://download/file');
    expect(showToast).toHaveBeenCalledWith('Saved to Downloads');
  });

  it('cleans up an Android file and shows an error toast when writing fails', async () => {
    const error = new Error('write failed');
    androidFs.writeFile.mockRejectedValue(error);

    await saveFileToDevice(new Blob(['data']), 'file.txt');

    expect(androidFs.removeFile).toHaveBeenCalledWith('content://download/file');
    expect(showToast).toHaveBeenCalledWith('Failed to save file: write failed');
  });

  it('does not write or toast when the iOS save picker is cancelled', async () => {
    vi.mocked(osType).mockReturnValue('ios');

    await saveFileToDevice(new Blob(['data']), 'file.txt');

    expect(save).toHaveBeenCalledWith({ defaultPath: 'file.txt' });
    expect(writeFile).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('writes the selected iOS path and shows the success toast', async () => {
    vi.mocked(osType).mockReturnValue('ios');
    save.mockResolvedValue('file:///exports/file.txt');

    await saveFileToDevice(new Blob(['data']), 'file.txt');

    expect(writeFile).toHaveBeenCalledWith('file:///exports/file.txt', expect.any(Uint8Array));
    expect(showToast).toHaveBeenCalledWith('File saved');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('keeps browser downloads on FileSaver', async () => {
    vi.mocked(isTauri).mockReturnValue(false);

    await saveFileToDevice(new Blob(['data']), 'file.txt');

    expect(FileSaver.saveAs).toHaveBeenCalledWith(expect.any(Blob), 'file.txt');
  });
});
