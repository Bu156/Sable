import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebugLogger, getDebugLogger } from './debugLogger';

vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn<(...args: unknown[]) => void>(),
  captureException: vi.fn<(...args: unknown[]) => void>(),
  captureMessage: vi.fn<(...args: unknown[]) => void>(),
  logger: {
    debug: vi.fn<(...args: unknown[]) => void>(),
    info: vi.fn<(...args: unknown[]) => void>(),
    warn: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  },
  metrics: { count: vi.fn<(...args: unknown[]) => void>() },
}));

describe('DebugLoggerService', () => {
  beforeEach(() => {
    const debugLogger = getDebugLogger();
    debugLogger.clear();
    debugLogger.setEnabled(false);
  });

  it('includes normal events in exports when debug mode is disabled', () => {
    createDebugLogger('test').info('general', 'normal event');

    const exported = JSON.parse(getDebugLogger().exportLogs()) as {
      logsCount: number;
      logs: { level: string; message: string }[];
    };

    expect(exported.logsCount).toBe(1);
    expect(exported.logs).toEqual([
      expect.objectContaining({ level: 'info', message: 'normal event' }),
    ]);
  });
});
