import { useCallback, useEffect, useState } from "react";

export type Loaded<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

// Loads data for a key; a new key (or reload) loads again. State changes only in async callbacks.
export function useLoad<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  const requestKey = `${key}#${version}`;

  useEffect(() => {
    let active = true;
    load()
      .then((data) => active && setState({ key: requestKey, data, error: null }))
      .catch((error: unknown) => active && setState({ key: requestKey, data: null, error: error instanceof Error ? error.message : "Could not load" }));
    return () => {
      active = false;
    };
    // load is recreated each render; requestKey decides when to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const current = state?.key === requestKey ? state : null;
  return { data: current?.data ?? (state?.data ?? null), error: current?.error ?? null, loading: current === null, reload };
}
