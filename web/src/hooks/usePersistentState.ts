import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react';

// last updated: 2026-01-15

/**
 * A hook that works like useState but persists the value to localStorage.
 * 
 * @param key The localStorage key to use
 * @param initialValue The initial value if no value exists in localStorage
 */
export function usePersistentState<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  // Get from local storage then
  // parse stored json or return initialValue
  const [state, setState] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that ...
  // ... persists the new value to localStorage.
  const setValue: Dispatch<SetStateAction<T>> = useCallback((value: SetStateAction<T>) => {
    setState(prev => {
      const nextValue = value instanceof Function ? value(prev) : value;
      try {
        window.localStorage.setItem(key, JSON.stringify(nextValue));
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error);
      }
      return nextValue;
    });
  }, [key]);

  // Keep state in sync across different tabs/windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setState(JSON.parse(e.newValue));
        } catch (error) {
          console.error(`Error parsing storage change for key "${key}":`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  // Update state if key changes (e.g. navigation between same component types)
  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      const nextValue = item ? JSON.parse(item) : initialValue;
      setState(nextValue);
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}" on key change:`, error);
      setState(initialValue);
    }
  }, [key, initialValue]);

  return [state, setValue];
}
