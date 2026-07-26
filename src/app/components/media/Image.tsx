import type { ComponentProps, ForwardedRef, ImgHTMLAttributes, PointerEventHandler } from 'react';
import { forwardRef, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import type { DotLottieReact as DotLottieReactComponent } from '@lottiefiles/dotlottie-react';
import { useSetting } from '$state/hooks/settings';
import { isPixelatedRendering, settingsAtom } from '$state/settings';
import * as css from './media.css';
import type { IImageInfo } from '$types/matrix/common';

type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'onPointerDown'> & {
  info?: IImageInfo;
  mimeType?: string;
  disablePixelation?: boolean;
  pixelated?: boolean;
  onLottieLoad?: (canvas?: HTMLCanvasElement) => void;
  onLottieError?: () => void;
  onPointerDown?: PointerEventHandler<HTMLElement>;
};

type LottieDotProps = Omit<
  ComponentProps<typeof DotLottieReactComponent>,
  'src' | 'alt' | 'loading' | 'onPointerDown'
>;
type DotLottieInstance = Parameters<
  NonNullable<ComponentProps<typeof DotLottieReactComponent>['dotLottieRefCallback']>
>[0];

const DotLottieReact = lazy(() =>
  import('@lottiefiles/dotlottie-react').then((module) => ({
    default: module.DotLottieReact,
  }))
) as typeof DotLottieReactComponent;

const GZIPPED_LOTTIE_MIME = /^application\/(?:(?:x-)?gzip|x-tgsticker)(?:;|$)/i;
const MAX_COMPRESSED_LOTTIE_BYTES = 1024 * 1024;
const MAX_DECOMPRESSED_LOTTIE_BYTES = 8 * 1024 * 1024;
const MAX_LOTTIE_DIMENSION = 4096;
const MAX_LOTTIE_FRAMES = 10_000;
const MAX_LOTTIE_LAYERS = 1_000;
const UNSAFE_LOTTIE_KEYS = new Set([
  'expression',
  'expressions',
  'script',
  'scripts',
  'javascript',
  'onload',
  'onclick',
]);

export function sanitizeLottieJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeLottieJson);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (UNSAFE_LOTTIE_KEYS.has(key) || (key === 'x' && typeof child === 'string')) return [];
      return [[key, sanitizeLottieJson(child)]];
    })
  );
}

function isGzippedLottieCandidate(
  src: string | undefined,
  mimeType: string | undefined,
  name: string | undefined
): src is string {
  if (!src) return false;
  return (
    GZIPPED_LOTTIE_MIME.test(mimeType ?? '') ||
    /^data:application\/(?:(?:x-)?gzip|x-tgsticker);base64,/i.test(src) ||
    [name, src].some((value) => value?.toLowerCase().split(/[?#]/, 1)[0]?.endsWith('.tgs'))
  );
}

async function readBytes(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let completed = false;

  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // Stream chunks must be consumed sequentially to enforce the running byte limit.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      size += value.byteLength;
      if (size > limit) throw new Error('Lottie data exceeds the size limit');
      chunks.push(value);
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

async function loadBytes(src: string, signal: AbortSignal): Promise<Uint8Array | null> {
  const encoded = src.match(/^data:[^;,]*;base64,(.+)$/i)?.[1];
  if (encoded) {
    if (encoded.length > Math.ceil((MAX_COMPRESSED_LOTTIE_BYTES * 4) / 3) + 4) return null;
    return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  }

  const response = await fetch(src, { credentials: 'include', signal });
  if (!response.ok || !response.body) return null;
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_COMPRESSED_LOTTIE_BYTES) return null;
  return readBytes(response.body, MAX_COMPRESSED_LOTTIE_BYTES, signal);
}

function hasSafeLottieComplexity(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || !('v' in value)) return false;
  const lottie = value as Record<string, unknown>;
  const width = Number(lottie.w);
  const height = Number(lottie.h);
  const firstFrame = Number(lottie.ip);
  const lastFrame = Number(lottie.op);
  if (
    (Number.isFinite(width) && (width <= 0 || width > MAX_LOTTIE_DIMENSION)) ||
    (Number.isFinite(height) && (height <= 0 || height > MAX_LOTTIE_DIMENSION)) ||
    (Number.isFinite(firstFrame) &&
      Number.isFinite(lastFrame) &&
      (lastFrame <= firstFrame || lastFrame - firstFrame > MAX_LOTTIE_FRAMES))
  ) {
    return false;
  }

  let layerCount = 0;
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    Object.entries(current).forEach(([key, child]) => {
      if (key === 'layers' && Array.isArray(child)) {
        layerCount += child.length;
      }
      pending.push(child);
    });
    if (layerCount > MAX_LOTTIE_LAYERS) return false;
  }
  return true;
}

async function resolveLottieDataUrl(src: string, signal: AbortSignal): Promise<string | null> {
  try {
    const bytes = await loadBytes(src, signal);
    if (!bytes || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return null;

    const stream = new Blob([bytes.buffer as ArrayBuffer])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const decompressed = await readBytes(stream, MAX_DECOMPRESSED_LOTTIE_BYTES, signal);
    const parsed = JSON.parse(new TextDecoder().decode(decompressed));
    if (!hasSafeLottieComplexity(parsed)) return null;
    const json = sanitizeLottieJson(parsed);
    const safeJsonText = JSON.stringify(json);
    return safeJsonText
      ? `data:application/json;charset=utf-8,${encodeURIComponent(safeJsonText)}`
      : null;
  } catch {
    return null;
  }
}

type LottieImageProps = LottieDotProps & {
  src: string;
  alt?: string;
  onLottieLoad?: (canvas?: HTMLCanvasElement) => void;
  onLottieError?: () => void;
  pixelated?: boolean;
  forwardedRef?: ForwardedRef<HTMLImageElement | HTMLCanvasElement>;
  onPointerDown?: PointerEventHandler<HTMLElement>;
};

function LottieImage({
  alt,
  className,
  style,
  onLottieLoad,
  onLottieError,
  pixelated,
  forwardedRef,
  onPointerDown,
  ...props
}: Readonly<LottieImageProps>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onLottieLoad, onLottieError });
  const pixelation = useRef(pixelated);
  callbacks.current = { onLottieLoad, onLottieError };
  pixelation.current = pixelated;
  const setForwardedRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (typeof forwardedRef === 'function') forwardedRef(canvas);
      else if (forwardedRef) forwardedRef.current = canvas;
    },
    [forwardedRef]
  );
  useEffect(() => {
    const updateRef = () => {
      const canvas = wrapperRef.current?.querySelector('canvas') ?? null;
      if (canvas) setForwardedRef(canvas);
    };
    updateRef();
    const observer = new MutationObserver(updateRef);
    if (wrapperRef.current)
      observer.observe(wrapperRef.current, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      setForwardedRef(null);
    };
  }, [setForwardedRef]);
  useEffect(() => {
    const canvas = wrapperRef.current?.querySelector('canvas');
    if (canvas) canvas.style.imageRendering = pixelated ? 'pixelated' : 'auto';
  }, [pixelated]);
  const handlePlayer = useCallback(
    (player: DotLottieInstance) => {
      if (!player) return;
      let didLoad = false;
      const handleLoad = () => {
        if (didLoad) return;
        didLoad = true;
        (player.canvas as HTMLCanvasElement).style.imageRendering = pixelation.current
          ? 'pixelated'
          : 'auto';
        callbacks.current.onLottieLoad?.(player.canvas as HTMLCanvasElement);
        setForwardedRef(player.canvas as HTMLCanvasElement);
      };
      const handleError = () => callbacks.current.onLottieError?.();

      player.addEventListener('load', handleLoad);
      player.addEventListener('loadError', handleError);
      if (player.isLoaded) handleLoad();
    },
    [setForwardedRef]
  );

  return (
    <Suspense fallback={null}>
      <div
        ref={wrapperRef}
        className={className}
        style={{ width: '100%', height: '100%', ...style }}
        onPointerDown={onPointerDown}
      >
        <DotLottieReact
          {...props}
          aria-label={props['aria-label'] ?? alt}
          backgroundColor="#00000000"
          dotLottieRefCallback={handlePlayer}
        />
      </div>
    </Suspense>
  );
}

export const Image = forwardRef<HTMLImageElement | HTMLCanvasElement, ImageProps>(
  (
    {
      className,
      alt,
      info,
      mimeType,
      disablePixelation,
      loading = 'lazy',
      onLoad,
      onPointerDown,
      src,
      style,
      onError,
      onLottieLoad,
      onLottieError,
      pixelated,
      ...props
    },
    ref
  ) => {
    const [pixelatedImageRendering] = useSetting(settingsAtom, 'pixelatedImageRendering');
    const [lottieResolution, setLottieResolution] = useState<{
      source: string;
      resolved: string | null;
    }>();
    const [fallbackSource, setFallbackSource] = useState<string>();

    const lottieProps = props as LottieDotProps;
    const declaredLottieCandidate = isGzippedLottieCandidate(
      src,
      mimeType ?? info?.mimetype,
      typeof props.title === 'string' ? props.title : alt
    );
    const isLottieCandidate = declaredLottieCandidate || fallbackSource === src;
    const resolvedLottieSrc =
      isLottieCandidate && lottieResolution?.source === src
        ? (lottieResolution?.resolved ?? null)
        : isLottieCandidate
          ? undefined
          : null;
    const imageClass = classNames(
      css.Image,
      !disablePixelation &&
        (pixelated ?? isPixelatedRendering(pixelatedImageRendering, info)) &&
        css.ImagePixelated,
      className
    );

    useEffect(() => {
      const controller = new AbortController();

      if (isLottieCandidate && src) {
        void resolveLottieDataUrl(src, controller.signal).then((result) => {
          if (!controller.signal.aborted) {
            setLottieResolution({ source: src, resolved: result });
          }
        });
      }

      return () => controller.abort();
    }, [isLottieCandidate, src]);

    useEffect(() => {
      setFallbackSource(undefined);
    }, [src]);

    const shouldRenderLottie = typeof resolvedLottieSrc === 'string';

    if (shouldRenderLottie) {
      return (
        <LottieImage
          {...lottieProps}
          className={imageClass}
          style={style}
          src={resolvedLottieSrc}
          alt={alt}
          onLottieLoad={onLottieLoad}
          onLottieError={onLottieError}
          forwardedRef={ref}
          onPointerDown={onPointerDown}
          pixelated={
            !disablePixelation && (pixelated ?? isPixelatedRendering(pixelatedImageRendering, info))
          }
          loop
          autoplay
        />
      );
    }

    return (
      <img
        className={imageClass}
        alt={alt}
        loading={loading}
        src={resolvedLottieSrc === undefined ? undefined : src}
        aria-busy={resolvedLottieSrc === undefined ? true : undefined}
        style={style}
        onLoad={onLoad}
        onPointerDown={onPointerDown}
        onError={(event) => {
          if (!declaredLottieCandidate && fallbackSource !== src) {
            setFallbackSource(src);
            return;
          }
          onError?.(event);
        }}
        {...props}
        ref={ref as ForwardedRef<HTMLImageElement>}
      />
    );
  }
);
