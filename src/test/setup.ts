import '@testing-library/jest-dom';

// jsdom does not implement ResizeObserver; components that observe element
// size in layout effects (e.g. MobileNavDrawer) would crash under test without
// a minimal polyfill.
class ResizeObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverPolyfill;
