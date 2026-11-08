import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../services/api';

/** Loads data on mount and on every screen focus (pass navigation); exposes loading/error/reload. */
export function useLoad<T>(fn: () => Promise<T>, navigation?: any) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    if (!navigation?.addListener) return;
    return navigation.addListener('focus', reload);
  }, [reload, navigation]);

  return { data, error, loading, reload };
}
