"use client";

import { useSyncExternalStore } from "react";
import { todayIST } from "@/lib/filters";

const never = () => () => {};

/** Today's date in India, read in the browser only. It is null while the page is being prepared on the server, so no clock is read there. */
export function useToday(): string | null {
  return useSyncExternalStore(never, todayIST, () => null);
}
