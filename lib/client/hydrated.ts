"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

// False during server render and hydration, true once running in the browser.
export function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}
