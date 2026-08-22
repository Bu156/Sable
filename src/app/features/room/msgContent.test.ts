import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MatrixUtils from '$utils/matrix';
import { MsgType, type MatrixClient } from '$types/matrix-sdk';
import type { TUploadItem } from '$state/room/roomInputDrafts';
import { TGS_MIMETYPE } from '$utils/mimeTypes';
import { MATRIX_UNSTABLE_SPOILER_PROPERTY_NAME } from '$unstable/prefixes';
import { getGalleryItemContent, getGifMsgContent, getImageMsgContent } from './msgContent';

const { fetchMock, uploadMock, encryptFileMock } = vi.hoisted(() => ({
  fetchMock: vi.fn<(url: string) => Promise<Response>>(),
  uploadMock: vi.fn<(mx: unknown, file: File) => Promise<{ content_uri?: string }>>(),
  encryptFileMock: vi.fn<(file: File) => Promise<{ file: File; encInfo: object }>>(),
}));

vi.mock('$utils/fetch', () => ({ fetch: fetchMock }));
vi.mock('$utils/matrix', async (importOriginal) => ({
  ...(await importOriginal<typeof MatrixUtils>()),
  uploadContentToServer: uploadMock,
  encryptFile: encryptFileMock,
}));

beforeEach(() => {
  fetchMock.mockReset();
  uploadMock.mockReset();
  encryptFileMock.mockReset();
});

vi.mock('$utils/dom', () => ({
  getImageFileUrl: vi.fn<(file: File | Blob) => string>(() => 'blob:test'),
  loadImageElement: vi
    .fn<(url: string) => Promise<HTMLImageElement>>()
    .mockRejectedValue(new Error('TGS is not a native image')),
}));

const createTgsItem = (): TUploadItem => {
  const file = new File(['tgs'], 'sticker.tgs', { type: TGS_MIMETYPE });
  return {
    file,
    originalFile: file,
    encInfo: undefined,
    metadata: { markedAsSpoiler: false },
  };
};

describe('object URL cleanup', () => {
  it('revokes the object URL after loading the image fails', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    await getImageMsgContent({} as MatrixClient, createTgsItem(), 'mxc://revoke');
    expect(revokeSpy).toHaveBeenCalledWith('blob:test');
    revokeSpy.mockRestore();
  });
});

describe('TGS message content', () => {
  it('sends TGS uploads as images with their MIME metadata', async () => {
    const content = await getImageMsgContent({} as MatrixClient, createTgsItem(), 'mxc://sticker');

    expect(content).toMatchObject({
      msgtype: MsgType.Image,
      body: 'sticker.tgs',
      url: 'mxc://sticker',
      info: {
        mimetype: TGS_MIMETYPE,
        size: 3,
      },
    });
  });

  it('classifies TGS gallery uploads as images', async () => {
    const content = await getGalleryItemContent(
      {} as MatrixClient,
      createTgsItem(),
      'mxc://sticker'
    );

    expect(content.itemtype).toBe(MsgType.Image);
  });
});

describe('GIF message content', () => {
  const searchResult = {
    id: 'gif-id',
    title: 'Reaction',
    shareUrl: 'https://tenor.com/view/gif-id',
    mediaUrl: 'https://media.tenor.com/gif-id/reaction.gif',
    width: 480,
    height: 270,
    mimetype: 'image/gif',
  };

  it('uploads the gif and sends it as an image event', async () => {
    fetchMock.mockResolvedValue(new Response('gif-bytes', { status: 200 }));
    uploadMock.mockResolvedValue({ content_uri: 'mxc://server/uploaded' });

    const content = await getGifMsgContent({} as MatrixClient, searchResult, { encrypt: false });

    expect(fetchMock).toHaveBeenCalledWith(searchResult.mediaUrl);
    expect(encryptFileMock).not.toHaveBeenCalled();
    expect(content).toEqual({
      msgtype: MsgType.Image,
      body: 'Reaction.gif',
      url: 'mxc://server/uploaded',
      info: { w: 480, h: 270, mimetype: 'image/gif', size: 9 },
    });
  });

  it('encrypts the upload for encrypted rooms', async () => {
    fetchMock.mockResolvedValue(new Response('gif-bytes', { status: 200 }));
    uploadMock.mockResolvedValue({ content_uri: 'mxc://server/encrypted' });
    encryptFileMock.mockImplementation(async (file: File) => ({
      file,
      encInfo: { key: { k: 'secret' } },
    }));

    const content = await getGifMsgContent({} as MatrixClient, searchResult, {
      encrypt: true,
      spoiler: true,
    });

    expect(content?.url).toBeUndefined();
    expect(content?.file).toEqual({ key: { k: 'secret' }, url: 'mxc://server/encrypted' });
    expect(content?.[MATRIX_UNSTABLE_SPOILER_PROPERTY_NAME]).toBe(true);
  });

  it('sends favorited homeserver gifs without re-uploading', async () => {
    const content = await getGifMsgContent(
      {} as MatrixClient,
      { ...searchResult, mediaUrl: 'mxc://matrix.example/media-id' },
      { encrypt: false }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(content).toMatchObject({
      msgtype: MsgType.Image,
      body: 'Reaction.gif',
      url: 'mxc://matrix.example/media-id',
      info: { w: 480, h: 270, mimetype: 'image/gif' },
    });
  });

  it('refuses media URLs outside the configured providers', async () => {
    await expect(
      getGifMsgContent(
        {} as MatrixClient,
        { ...searchResult, mediaUrl: 'https://media.tenor.com.attacker.example/a.gif' },
        { encrypt: false }
      )
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
