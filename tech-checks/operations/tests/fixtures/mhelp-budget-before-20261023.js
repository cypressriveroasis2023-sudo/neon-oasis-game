function createMhelpRequestBudget(options) {
    const now = options.now || Date.now;
    const wait = options.wait || ((ms, signal) => new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(Error("Request canceled"));
        return;
      }
      const cancel3 = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel3);
        reject(Error("Request canceled"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", cancel3);
        resolve();
      }, ms);
      signal?.addEventListener("abort", cancel3, { once: true });
    }));
    const fetchBudget = async (input, init) => {
      const kind6 = mhelpRequestClass(input);
      if (!kind6) return options.fetch(input, init);
      const signal = init?.signal || (input instanceof Request ? input.signal : void 0) || void 0;
      for (let tries = 0; tries < 80; tries++) {
        if (signal?.aborted) throw Error("Request canceled");
        const gate = checked2(await options.admit(kind6 === "essential"));
        if (signal?.aborted) throw Error("Request canceled");
        if (gate.allowed) return options.fetch(input, init);
        const delay = Date.parse(gate.retryAt) - now();
        if (gate.reason === "pacing" && delay > 0 && delay <= 1e3 && tries < 79) {
          await wait(delay, signal);
          continue;
        }
        return new Response('{"error":"mHelpDesk request is waiting for its automatic retry window"}', { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-COS-Mhelp-Deferred": "1", "X-COS-Mhelp-Budget": "1", "Retry-After": String(Math.max(1, Math.ceil(Math.max(0, delay) / 1e3))) } });
      }
      throw Error("mHelpDesk request allowance unavailable");
    };
    return { fetch: fetchBudget };
  }