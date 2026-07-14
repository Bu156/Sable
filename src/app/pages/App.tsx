import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { createStore } from 'jotai/vanilla';
import { OverlayContainerProvider, PopOutContainerProvider, TooltipContainerProvider } from 'folds';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';

import type { ClientConfig } from '$hooks/useClientConfig';
import { ClientConfigProvider } from '$hooks/useClientConfig';
import { setMatrixToBase } from '$plugins/matrix-to';
import type { ScreenSize } from '$hooks/useScreenSize';
import { ScreenSizeProvider, useScreenSize } from '$hooks/useScreenSize';
import { useCompositionEndTracking } from '$hooks/useComposingCheck';
import { ErrorPage } from '$components/DefaultErrorPage';
import { FeatureCheck } from './FeatureCheck';
import { createRouter } from './Router';
import { isReactQueryDevtoolsEnabled } from './reactQueryDevtoolsGate';
import { bootstrapSettingsStore } from '$state/settings';
import { trimTrailingSlash } from '$utils/common';
import { createLogger } from '$utils/debug';

const log = createLogger('App');

const queryClient = new QueryClient();
const ReactQueryDevtools = lazy(async () => {
  const { ReactQueryDevtools: Devtools } = await import('@tanstack/react-query-devtools');

  return { default: Devtools };
});

type BootstrappedAppShellProps = {
  clientConfig: ClientConfig;
  screenSize: ScreenSize;
};

function BootstrappedAppShell({ clientConfig, screenSize }: BootstrappedAppShellProps) {
  const jotaiStoreRef = useRef<ReturnType<typeof createStore>>();
  if (!jotaiStoreRef.current) {
    jotaiStoreRef.current = createStore();
  }
  bootstrapSettingsStore(jotaiStoreRef.current, clientConfig.settingsDefaults);
  const reactQueryDevtoolsEnabled = isReactQueryDevtoolsEnabled();

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={jotaiStoreRef.current}>
        <RouterProvider router={createRouter(clientConfig, screenSize)} />
      </JotaiProvider>
      {reactQueryDevtoolsEnabled && (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}

function renderSentryErrorFallback({ error, eventId }: { error: unknown; eventId: string | null }) {
  return (
    <ErrorPage
      error={error instanceof Error ? error : new Error(String(error))}
      eventId={eventId || undefined}
    />
  );
}

function useClientConfigLoader(): ClientConfig {
  const [config, setConfig] = useState<ClientConfig>({});

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      try {
        const url = `${trimTrailingSlash(import.meta.env.BASE_URL)}/config.json`;
        const res = await fetch(url, { method: 'GET' });
        const data = (await res.json()) as ClientConfig;
        if (cancelled) return;
        setConfig(data);
        setMatrixToBase(data.matrixToBaseUrl);
      } catch (err) {
        log.error('Failed to load config.json, continuing with empty config:', err);
      }
    };

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}

function App() {
  const screenSize = useScreenSize();
  useCompositionEndTracking();
  const portalContainer = document.getElementById('portalContainer') ?? undefined;

  const clientConfig = useClientConfigLoader();

  return (
    <Sentry.ErrorBoundary fallback={renderSentryErrorFallback}>
      <TooltipContainerProvider value={portalContainer}>
        <PopOutContainerProvider value={portalContainer}>
          <OverlayContainerProvider value={portalContainer}>
            <ScreenSizeProvider value={screenSize}>
              <FeatureCheck>
                <ClientConfigProvider value={clientConfig}>
                  <BootstrappedAppShell clientConfig={clientConfig} screenSize={screenSize} />
                </ClientConfigProvider>
              </FeatureCheck>
            </ScreenSizeProvider>
          </OverlayContainerProvider>
        </PopOutContainerProvider>
      </TooltipContainerProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
