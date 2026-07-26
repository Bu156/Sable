import type { ComponentProps, ImgHTMLAttributes } from 'react';
import { forwardRef, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import type { DotLottieReact as DotLottieReactComponent } from '@lottiefiles/dotlottie-react';
import { useSetting } from '$state/hooks/settings';
import { isPixelatedRendering, settingsAtom } from '$state/settings';
import * as css from './media.css';
import type { IImageInfo } from '$types/matrix/common';

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  info?: IImageInfo;
  mimeType?: string;
  disablePixelation?: boolean;
  pixelated?: boolean;
  onLottieLoad?: (canvas?: HTMLCanvasElement) => void;
  onLottieError?: () => void;
};

type LottieDotProps = Omit<
  ComponentProps<typeof DotLottieReactComponent>,
  'src' | 'alt' | 'loading'
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

async function loadBytes(src: string): Promise<Uint8Array | null> {
  const encoded = src.match(/^data:[^;,]*;base64,(.+)$/i)?.[1];
  if (encoded) {
    return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  }

  const response = await fetch(src, { credentials: 'include' });
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
}

async function resolveLottieDataUrl(src: string): Promise<string | null> {
  try {
    const bytes = await loadBytes(src);
    if (!bytes || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return null;

    const stream = new Blob([bytes.buffer as ArrayBuffer])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const jsonText = await new Response(stream).text();
    const json = sanitizeLottieJson(JSON.parse(jsonText));
    const safeJsonText = JSON.stringify(json);
    return json && typeof json === 'object' && 'v' in json && safeJsonText
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
};

function LottieImage({
  alt,
  className,
  style,
  onLottieLoad,
  onLottieError,
  pixelated,
  ...props
}: Readonly<LottieImageProps>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onLottieLoad, onLottieError });
  const pixelation = useRef(pixelated);
  callbacks.current = { onLottieLoad, onLottieError };
  pixelation.current = pixelated;
  useEffect(() => {
    const canvas = wrapperRef.current?.querySelector('canvas');
    if (canvas) canvas.style.imageRendering = pixelated ? 'pixelated' : 'auto';
  }, [pixelated]);
  const handlePlayer = useCallback((player: DotLottieInstance) => {
    if (!player) return;
    let didLoad = false;
    const handleLoad = () => {
      if (didLoad) return;
      didLoad = true;
      (player.canvas as HTMLCanvasElement).style.imageRendering = pixelation.current
        ? 'pixelated'
        : 'auto';
      callbacks.current.onLottieLoad?.(player.canvas as HTMLCanvasElement);
    };
    const handleError = () => callbacks.current.onLottieError?.();

    player.addEventListener('load', handleLoad);
    player.addEventListener('loadError', handleError);
    if (player.isLoaded) handleLoad();
  }, []);

  return (
    <Suspense fallback={null}>
      <div
        ref={wrapperRef}
        className={className}
        style={{ width: '100%', height: '100%', ...style }}
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

export const Image = forwardRef<HTMLImageElement, ImageProps>(
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

    const lottieProps = props as LottieDotProps;
    const isLottieCandidate = isGzippedLottieCandidate(
      src,
      mimeType ?? info?.mimetype,
      typeof props.title === 'string' ? props.title : alt
    );
    const resolvedLottieSrc =
      isLottieCandidate && lottieResolution?.source === src
        ? lottieResolution.resolved
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
      let cancelled = false;

      if (isLottieCandidate) {
        void resolveLottieDataUrl(src).then((result) => {
          if (!cancelled) {
            setLottieResolution({ source: src, resolved: result });
          }
        });
      }

      return () => {
        cancelled = true;
      };
    }, [isLottieCandidate, src]);

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
        onError={onError}
        {...props}
        ref={ref}
      />
    );
  }
);
