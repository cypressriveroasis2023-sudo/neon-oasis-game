// RECOVERED ORPHAN - not original source.
// Extracted verbatim from the deployed cos-operations-pages v134 bundle
// (productTcpRuntime.ts), which is the ONLY known copy of this file. It exists
// in no commit on any branch of this repository.
// Original path: tech-checks/supabase/functions/_shared/exact-product-producer/cancellableIo.ts
// This is post-esbuild output: types are stripped and some identifiers are
// renamed (value2, rows2). Treat it as evidence of what production runs, not as
// a drop-in replacement for the lost source.
function cancellableIo(deadline, now, parent) {
  const started = now();
  const check = () => {
    if (parent?.aborted) throw Error("Request cancelled");
    if (now() < started || now() >= deadline) throw Error("Request deadline");
  };
  const request = async (fn, timeout = 4e3) => {
    check();
    return boundedRequest(async (timeoutSignal) => {
      const controller = new AbortController();
      let cancel;
      const aborted = new Promise((_, reject2) => {
        cancel = () => {
          controller.abort();
          reject2(Error("Request cancelled"));
        };
      });
      parent?.addEventListener("abort", cancel, { once: true });
      timeoutSignal.addEventListener("abort", cancel, { once: true });
      try {
        check();
        if (timeoutSignal.aborted) throw Error("Request deadline");
        const value2 = await Promise.race([Promise.resolve(fn(controller.signal)), aborted]);
        check();
        return value2;
      } finally {
        parent?.removeEventListener("abort", cancel);
        timeoutSignal.removeEventListener("abort", cancel);
        controller.abort();
      }
    }, deadline, now, timeout);
  };
  return { check, request };
}
