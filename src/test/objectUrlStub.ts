import { vi } from 'vitest';

// jsdom has no URL.createObjectURL. Subclassing keeps `new URL()` working for code under test.
export const stubObjectUrls = (): void => {
  let counter = 0;
  class StubbedURL extends globalThis.URL {
    static createObjectURL = vi.fn<() => string>(() => {
      counter += 1;
      return `blob:mock-${counter}`;
    });

    static revokeObjectURL = vi.fn<() => void>();
  }

  vi.stubGlobal('URL', StubbedURL);
};
