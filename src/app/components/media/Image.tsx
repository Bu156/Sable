import type { ComponentProps, ImgHTMLAttributes } from 'react';
import { forwardRef, useEffect, useState } from 'react';
import classNames from 'classnames';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { useSetting } from '$state/hooks/settings';
import { isPixelatedRendering, settingsAtom } from '$state/settings';
import * as css from './media.css';
import type { IImageInfo } from '$types/matrix/common';

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & { info?: IImageInfo };

type LottieDotProps = Omit<ComponentProps<typeof DotLottieReact>, 'src' | 'alt' | 'loading'>;

/**
 * Gzipped files begin with a fixed byte sequence (1f 8b), which distinguis
 * them from standard image formats (PNG, WebP, JPG). The implementation detects
 * this signature in the file header and automatically decompresses gzipped
 * content before parsing it as Lottie JSON. If parsing succeeds,
 * the decompressed animation is passed to the Lottie player.
 */
async function resolveLottieDataUrl(src: string): Promise<string | null> {
  const dataUrlMatch = src.match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (dataUrlMatch) {
    const [, , encoded] = dataUrlMatch;
    if (typeof encoded !== 'string' || encoded.length === 0) {
      return null;
    }

    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));

    if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
      return null;
    }

    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const decompressed = await new Response(stream).arrayBuffer();
      const jsonText = new TextDecoder().decode(decompressed);
      const json = JSON.parse(jsonText);

      if (json && typeof json === 'object' && 'v' in json) {
        return `data:application/json;charset=utf-8,${encodeURIComponent(jsonText)}`;
      }
    } catch {
      return null;
    }

    return null;
  }

  try {
    const response = await fetch(src, { credentials: 'include' });
    if (!response.ok) {
      return null;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
      return null;
    }

    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const decompressed = await new Response(stream).arrayBuffer();
    const jsonText = new TextDecoder().decode(decompressed);
    const json = JSON.parse(jsonText);

    if (json && typeof json === 'object' && 'v' in json) {
      return `data:application/json;charset=utf-8,${encodeURIComponent(jsonText)}`;
    }
  } catch {
    return null;
  }

  return null;
}

export const Image = forwardRef<HTMLImageElement, ImageProps>(
  (
    {
      className,
      alt,
      info,
      loading = 'lazy',
      onLoad,
      onPointerDown,
      src,
      style,
      onError,
      ...props
    },
    ref
  ) => {
    const [pixelatedImageRendering] = useSetting(settingsAtom, 'pixelatedImageRendering');
    const [resolvedLottieSrc, setResolvedLottieSrc] = useState<string | null | undefined>(
      undefined
    );

    const lottieProps = props as LottieDotProps;

    useEffect(() => {
      let cancelled = false;

      if (typeof src === 'string' && src.length > 0) {
        void resolveLottieDataUrl(src).then((result) => {
          if (!cancelled) {
            setResolvedLottieSrc(result);
            if (onLoad) onLoad({} as React.SyntheticEvent<HTMLImageElement, Event>);
          }
        });
      } else {
        setResolvedLottieSrc(null);
      }

      return () => {
        cancelled = true;
      };
    }, [src, onLoad]);

    const shouldRenderLottie = typeof resolvedLottieSrc === 'string';

    if (shouldRenderLottie) {
      return (
        <DotLottieReact
          {...lottieProps}
          height={lottieProps.height}
          width={lottieProps.height}
          className={classNames(
            css.Image,
            isPixelatedRendering(pixelatedImageRendering, info) && css.ImagePixelated,
            className
          )}
          style={style}
          src={resolvedLottieSrc}
          aria-hidden={props['aria-hidden']}
          loop
          autoplay
        />
      );
    }

    return (
      <img
        className={classNames(
          css.Image,
          isPixelatedRendering(pixelatedImageRendering, info) && css.ImagePixelated,
          className
        )}
        alt={alt}
        loading={loading}
        src={src}
        style={style}
        onLoad={onLoad}
        onPointerDown={onPointerDown}
        onError={(...e) => {
          // Don't send an error until we know whether the image is a Lottie or an ordinary image.
          if (resolvedLottieSrc !== undefined && onError) onError(...e);
        }}
        {...props}
        ref={ref}
      />
    );
  }
);
