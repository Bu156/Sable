import { revalidateCachedThemeCss, type ThemeCacheRevalidationResult } from './cache';
import { fetchThemeCatalogBundle, type ThemeCatalogBundle } from './catalog';
import { extractFullThemeUrlFromPreview } from './metadata';

export const THEME_CATALOG_AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60_000;
const lastCatalogChecks = new Map<string, number>();

export type CatalogUpdateSummary = {
  checked: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  results: ThemeCacheRevalidationResult[];
};

export type UpdateInstalledCatalogPackagesOptions = {
  catalogBase: string;
  manifestUrl?: string;
  installedThemeUrls: string[];
  installedTweakUrls: string[];
  maxAgeMs?: number;
};

async function resolveCatalogThemeUrls(bundle: ThemeCatalogBundle): Promise<Set<string>> {
  const urls = new Set(bundle.themes.map((theme) => theme.fullUrl));
  await Promise.all(
    bundle.themes.map(async (theme) => {
      try {
        const response = await fetch(theme.previewUrl, { mode: 'cors', cache: 'no-cache' });
        if (!response.ok) return;
        const fullUrl = extractFullThemeUrlFromPreview(await response.text());
        if (fullUrl) urls.add(fullUrl);
      } catch {
        // The catalog pair's full URL remains a valid fallback membership signal.
      }
    })
  );
  return urls;
}

export async function updateInstalledCatalogPackages({
  catalogBase,
  manifestUrl,
  installedThemeUrls,
  installedTweakUrls,
  maxAgeMs = THEME_CATALOG_AUTO_UPDATE_INTERVAL_MS,
}: UpdateInstalledCatalogPackagesOptions): Promise<CatalogUpdateSummary> {
  const catalogCheckKey = `${catalogBase}\n${manifestUrl ?? ''}`;
  const previousCatalogCheck = lastCatalogChecks.get(catalogCheckKey) ?? 0;
  if (maxAgeMs > 0 && Date.now() - previousCatalogCheck < maxAgeMs) {
    return { checked: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, results: [] };
  }
  const bundle = await fetchThemeCatalogBundle(catalogBase, { manifestUrl });
  const catalogThemeUrls = await resolveCatalogThemeUrls(bundle);
  lastCatalogChecks.set(catalogCheckKey, Date.now());
  const catalogTweakUrls = new Set(bundle.tweaks.map((tweak) => tweak.fullUrl));

  const installed = new Set([
    ...installedThemeUrls.filter((url) => catalogThemeUrls.has(url)),
    ...installedTweakUrls.filter((url) => catalogTweakUrls.has(url)),
  ]);
  const results = await Promise.all(
    Array.from(installed, (url) => revalidateCachedThemeCss(url, maxAgeMs))
  );

  return {
    checked: results.filter((result) => result.status !== 'skipped').length,
    updated: results.filter((result) => result.status === 'updated').length,
    unchanged: results.filter((result) => result.status === 'unchanged').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  };
}
