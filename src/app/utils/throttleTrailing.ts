export type Throttled = (() => void) & { cancel: () => void };

/** Runs immediately when idle, otherwise once more at the end of the window. */
export const throttleTrailing = (fn: () => void, waitMs: number): Throttled => {
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let lastRun = 0;

  const run = () => {
    lastRun = Date.now();
    fn();
  };

  const throttled = () => {
    const elapsed = Date.now() - lastRun;
    if (elapsed >= waitMs) {
      run();
      return;
    }
    if (trailing !== undefined) return;
    trailing = setTimeout(() => {
      trailing = undefined;
      run();
    }, waitMs - elapsed);
  };

  throttled.cancel = () => {
    clearTimeout(trailing);
    trailing = undefined;
  };

  return throttled;
};
