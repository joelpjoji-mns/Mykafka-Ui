export const scheduleIdleTask = (task: () => void) => {
  if (typeof window === 'undefined') return () => undefined;

  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout: 1_500 });
    return () => window.cancelIdleCallback(handle);
  }

  const handle = window.setTimeout(task, 750);
  return () => window.clearTimeout(handle);
};
