/** Minimal logger matching the ZCode desktop logger surface used by the ported modules. */
const emit =
  () =>
  (...args: unknown[]) => {
    console.log(...args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))));
  };
export const logger = {
  debug: emit(),
  info: emit(),
  warn: emit(),
  error: emit(),
  child: () => logger,
};
