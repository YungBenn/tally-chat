"use node";

import { lookup } from "node:dns/promises";

// The URL guard's resolver: every address the system's DNS gives for a host.
export const systemResolve = async (host: string) =>
  (await lookup(host, { all: true })).map((a) => a.address);
