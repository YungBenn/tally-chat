// Tests never touch the real network: fakeFetch installs fixtures and restores this.
globalThis.fetch = async (input) => {
  throw new Error(`Real network disabled in tests: ${String(input instanceof Request ? input.url : input)}`);
};
