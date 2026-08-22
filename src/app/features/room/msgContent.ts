import type { IContent, MatrixClient } from '$types/matrix-sdk';
import { MsgType } from '$types/matrix-sdk';
import to from 'await-to-js';
import type { IGalleryItem } from '$types/matrix/common';
import { GALLERY_MSGTYPE, type IThumbnailContent } from '$types/matrix/common';
import {
  getImageFileUrl,
  getThumbnail,
  getThumbnailDimensions,
  getVideoFileUrl,
  loadImageElement,
  loadVideoElement,
} from '$utils/dom';
import {
  encryptFile,
  getImageInfo,
  getThumbnailContent,
  getVideoInfo,
  uploadContentToServer,
} from '$utils/matrix';
import { isImageMimeType, mimeTypeToExt } from '$utils/mimeTypes';
import type { TUploadItem } from '$state/room/roomInputDrafts';
import type { GifData } from '$components/emoji-board/types';
import { encodeBlurHashAsync } from '$utils/blurHash';
import { scaleYDimension } from '$utils/common';
import { createLogger } from '$utils/debug';
import { isAllowedGifMediaUrl } from '$utils/gifProviders';
import { fetch } from '$utils/fetch';
import {
  MATRIX_UNSTABLE_BLUR_HASH_PROPERTY_NAME,
  MATRIX_UNSTABLE_SPOILER_PROPERTY_NAME,
} from '../../../unstable/prefixes';

const log = createLogger('msgContent');

const generateThumbnailContent = async (
  mx: MatrixClient,
  img: HTMLImageElement | HTMLVideoElement,
  dimensions: [number, number],
  encrypt: boolean
): Promise<IThumbnailContent> => {
  const thumbnail = await getThumbnail(img, ...dimensions);
  if (!thumbnail) throw new Error('Can not create thumbnail!');
  const encThumbData = encrypt ? await encryptFile(thumbnail) : undefined;
  const thumbnailFile = encThumbData?.file ?? thumbnail;
  if (!thumbnailFile) throw new Error('Can not create thumbnail!');

  const data = await uploadContentToServer(mx, thumbnailFile);
  const thumbMxc = data?.content_uri;
  if (!thumbMxc) throw new Error('Failed when uploading thumbnail!');
  const thumbnailContent = getThumbnailContent({
    thumbnail: thumbnailFile,
    encInfo: encThumbData?.encInfo,
    mxc: thumbMxc,
    width: dimensions[0],
    height: dimensions[1],
  });
  return thumbnailContent;
};

export const getImageMsgContent = async (
  mx: MatrixClient,
  item: TUploadItem,
  mxc: string
): Promise<IContent> => {
  const { file, originalFile, encInfo, metadata } = item;
  const imgUrl = getImageFileUrl(originalFile);
  const content: IContent = {
    msgtype: MsgType.Image,
    filename: file.name,
    body: file.name,
    [MATRIX_UNSTABLE_SPOILER_PROPERTY_NAME]: metadata.markedAsSpoiler,
  };
  try {
    const [imgError, imgEl] = await to(loadImageElement(imgUrl));
    if (imgError) log.warn('Failed to load image element:', imgError);

    if (imgEl) {
      const blurHash = await encodeBlurHashAsync(
        imgEl,
        512,
        scaleYDimension(imgEl.width, 512, imgEl.height)
      );

      content.info = {
        ...getImageInfo(imgEl, file),
        [MATRIX_UNSTABLE_BLUR_HASH_PROPERTY_NAME]: blurHash,
      };
    } else {
      content.info = {
        mimetype: originalFile.type,
        size: originalFile.size,
      };
    }
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
  if (encInfo) {
    content.file = {
      ...encInfo,
      url: mxc,
    };
  } else {
    content.url = mxc;
  }
  if (item.body && item.body.length > 0) content.body = item.body;
  if (item.formatted_body && item.formatted_body.length > 0) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = item.formatted_body;
  }
  return content;
};

export const getVideoMsgContent = async (
  mx: MatrixClient,
  item: TUploadItem,
  mxc: string
): Promise<IContent> => {
  const { file, originalFile, encInfo, metadata } = item;

  const videoUrl = getVideoFileUrl(originalFile);

  const content: IContent = {
    msgtype: MsgType.Video,
    filename: file.name,
    body: file.name,
    [MATRIX_UNSTABLE_SPOILER_PROPERTY_NAME]: metadata.markedAsSpoiler,
  };
  try {
    const [videoError, videoEl] = await to(loadVideoElement(videoUrl));
    if (videoError) log.warn('Failed to load video element:', videoError);

    if (videoEl) {
      const [thumbError, thumbContent] = await to(
        generateThumbnailContent(
          mx,
          videoEl,
          getThumbnailDimensions(videoEl.videoWidth, videoEl.videoHeight),
          !!encInfo
        )
      );
      if (thumbContent && thumbContent.thumbnail_info) {
        thumbContent.thumbnail_info[MATRIX_UNSTABLE_BLUR_HASH_PROPERTY_NAME] =
          await encodeBlurHashAsync(
            videoEl,
            512,
            scaleYDimension(videoEl.videoWidth, 512, videoEl.videoHeight)
          );
      }
      if (thumbError) log.warn('Failed to generate video thumbnail:', thumbError);
      content.info = {
        ...getVideoInfo(videoEl, file),
        ...thumbContent,
      };
    }
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
  if (encInfo) {
    content.file = {
      ...encInfo,
      url: mxc,
    };
  } else {
    content.url = mxc;
  }
  if (item.body && item.body.length > 0) content.body = item.body;
  if (item.formatted_body && item.formatted_body.length > 0) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = item.formatted_body;
  }
  return content;
};

export type AudioMsgContent = IContent & {
  waveform?: number[];
  audioLength?: number;
};

export const getAudioMsgContent = (item: TUploadItem, mxc: string): AudioMsgContent => {
  const { file, encInfo, metadata } = item;
  const { waveform, audioDuration, markedAsSpoiler } = metadata;
  const isVoice = waveform !== undefined && waveform.length > 0;
  const fallbackBody = isVoice ? 'a voice message' : file.name;
  let content: IContent = {
    msgtype: MsgType.Audio,
    filename: file.name,
    body: item.body && item.body.length > 0 ? item.body : fallbackBody,
    info: {
      mimetype: file.type,
      size: file.size,
      duration: markedAsSpoiler || !audioDuration ? 0 : audioDuration * 1000,
    },

    // Element-compatible unstable extensible-event keys
    'org.matrix.msc1767.audio': {
      waveform: waveform?.map((v) => Math.round(v * 1024)),
      duration: markedAsSpoiler || !audioDuration ? 0 : audioDuration * 1000,
    },
    'org.matrix.msc1767.text': item.body && item.body.length > 0 ? item.body : fallbackBody,
    'org.matrix.msc3245.voice.v2': {
      duration: markedAsSpoiler || !audioDuration ? 0 : audioDuration,
      waveform: waveform?.map((v) => Math.round(v * 1024)),
    },
    // for element compat
    'org.matrix.msc3245.voice': {},
  };
  if (encInfo) {
    content.file = {
      ...encInfo,
      url: mxc,
    };
    content = {
      ...content,

      // Element-compatible unstable extensible-event keys
      'org.matrix.msc1767.file': {
        name: file.name,
        mimetype: file.type,
        size: file.size,
        file: content.file,
      },
    };
  } else {
    content.url = mxc;
    content = {
      ...content,

      // Element-compatible unstable extensible-event keys
      'org.matrix.msc1767.file': {
        name: file.name,
        mimetype: file.type,
        size: file.size,
        url: content.url,
      },
    };
  }
  if (item.body && item.body.length > 0) content.body = item.body;
  if (item.formatted_body && item.formatted_body.length > 0) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = item.formatted_body;
  }
  return content;
};

export const getFileMsgContent = (item: TUploadItem, mxc: string): IContent => {
  const { file, encInfo } = item;
  const content: IContent = {
    msgtype: MsgType.File,
    filename: file.name,
    body: file.name,
    info: {
      mimetype: file.type,
      size: file.size,
    },
  };
  if (encInfo) {
    content.file = {
      ...encInfo,
      url: mxc,
    };
  } else {
    content.url = mxc;
  }
  if (item.body && item.body.length > 0) content.body = item.body;
  if (item.formatted_body && item.formatted_body.length > 0) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = item.formatted_body;
  }
  return content;
};

export const getGifMsgContent = async (
  mx: MatrixClient,
  gif: GifData,
  options: { encrypt: boolean; spoiler?: boolean }
): Promise<IContent | undefined> => {
  const mimetype = gif.mimetype ?? 'image/gif';
  const ext = mimeTypeToExt(mimetype);
  const body = gif.title.endsWith(`.${ext}`) ? gif.title : `${gif.title}.${ext}`;
  const spoiler = options.spoiler ? { [MATRIX_UNSTABLE_SPOILER_PROPERTY_NAME]: true } : undefined;

  // Favorites saved from a sent message already live on a homeserver.
  if (gif.mediaUrl.startsWith('mxc://')) {
    return {
      msgtype: MsgType.Image,
      body,
      url: gif.mediaUrl,
      info: {
        w: gif.width,
        h: gif.height,
        mimetype,
        ...(gif.size ? { size: gif.size } : {}),
      },
      ...spoiler,
    };
  }

  if (!isAllowedGifMediaUrl(gif.mediaUrl)) return undefined;

  const response = await fetch(gif.mediaUrl);
  if (!response.ok) throw new Error(`Failed to fetch GIF: HTTP ${response.status}`);
  const blob = await response.blob();
  const file = new File([blob], body, { type: mimetype });

  const encData = options.encrypt ? await encryptFile(file) : undefined;
  const uploadData = await uploadContentToServer(mx, encData?.file ?? file);
  const mxc = uploadData?.content_uri;
  if (!mxc) throw new Error('Failed when uploading GIF!');

  const objectUrl = URL.createObjectURL(blob);
  let imgEl: HTMLImageElement | undefined;
  try {
    imgEl = await loadImageElement(objectUrl);
  } catch (e) {
    log.warn('Failed to load GIF for blurhash, falling back to basic metadata:', e);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const blurHash = imgEl
    ? await encodeBlurHashAsync(imgEl, 512, scaleYDimension(imgEl.width, 512, imgEl.height))
    : undefined;

  const content: IContent = {
    msgtype: MsgType.Image,
    body,
    info: {
      w: imgEl?.width ?? gif.width,
      h: imgEl?.height ?? gif.height,
      mimetype,
      size: blob.size,
      ...(blurHash ? { [MATRIX_UNSTABLE_BLUR_HASH_PROPERTY_NAME]: blurHash } : {}),
    },
    ...spoiler,
  };

  if (encData?.encInfo) {
    content.file = { ...encData.encInfo, url: mxc };
  } else {
    content.url = mxc;
  }

  return content;
};

const swapMsgTypeToItemType = (
  content: IContent,
  itemtype: IGalleryItem['itemtype']
): IGalleryItem => {
  const result = { ...content, itemtype };
  delete result.msgtype;
  return result as IGalleryItem;
};

export const getGalleryItemContent = async (
  mx: MatrixClient,
  item: TUploadItem,
  mxc: string
): Promise<IGalleryItem> => {
  if (isImageMimeType(item.file.type)) {
    return swapMsgTypeToItemType(await getImageMsgContent(mx, item, mxc), MsgType.Image);
  }
  if (item.file.type.startsWith('video')) {
    return swapMsgTypeToItemType(await getVideoMsgContent(mx, item, mxc), MsgType.Video);
  }
  if (item.file.type.startsWith('audio')) {
    return swapMsgTypeToItemType(getAudioMsgContent(item, mxc), MsgType.Audio);
  }
  return swapMsgTypeToItemType(getFileMsgContent(item, mxc), MsgType.File);
};

export const buildGalleryContent = (
  items: IGalleryItem[],
  caption?: string,
  formattedCaption?: string
): IContent => {
  const body =
    caption ||
    items.map((item) => `[${item.filename ?? item.itemtype}: ${item.url ?? 'file'}]`).join('\n');

  const content: IContent = {
    msgtype: GALLERY_MSGTYPE,
    body,
    itemtypes: items,
  };

  if (formattedCaption) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = formattedCaption;
  }

  return content;
};
