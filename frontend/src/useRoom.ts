import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, enterRoom, getRoom, sendAction, type Action, type Room, type Session } from './api';

const sessionKey = 'truco-choma-session';

function savedSession(): Session | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null');
    return typeof value?.code === 'string' && typeof value?.token === 'string' &&
      value.code && value.token ? { code: value.code, token: value.token } : null;
  } catch {
    return null;
  }
}

function remember(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(sessionKey, JSON.stringify(session));
    else sessionStorage.removeItem(sessionKey);
  } catch {
    // The current session still works if the browser blocks storage.
  }
}

function sessionEnded(error: unknown) {
  return error instanceof ApiError && ['INVALID_SESSION', 'ROOM_NOT_FOUND'].includes(error.code);
}

function message(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export function useRoom() {
  const [session, setSession] = useState(savedSession);
  const [room, setRoom] = useState<Room | null>(null);
  const [pending, setPending] = useState(false);
  const [staleVersion, setStaleVersion] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const active = useRef(session);
  const latest = useRef<Room | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const refresh = useRef<(() => void) | null>(null);
  const finished = room?.status === 'FINISHED';
  const awaitingFresh = staleVersion !== null && (room?.version ?? -1) <= staleVersion;

  const leave = useCallback((reason = '') => {
    active.current = null;
    latest.current = null;
    mutation.current?.abort();
    mutation.current = null;
    remember(null);
    setSession(null);
    setRoom(null);
    setPending(false);
    setStaleVersion(null);
    setSyncError('');
    setError(reason);
  }, []);

  const apply = useCallback((source: Session, incoming: Room) => {
    if (active.current !== source) return;
    if (incoming.code !== source.code) {
      throw new ApiError('UNAVAILABLE', 'O servidor devolveu uma sala diferente da solicitada.');
    }
    if (!latest.current || incoming.version > latest.current.version) {
      latest.current = incoming;
      setRoom(incoming);
    }
    setSyncError('');
  }, []);

  useEffect(() => {
    if (!session || finished) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight: AbortController | null = null;
    let refreshAgain = false;

    async function sync() {
      if (!session || disposed || active.current !== session || latest.current?.status === 'FINISHED') return;
      clearTimeout(timer);
      if (inFlight) {
        refreshAgain = true;
        return;
      }

      const controller = new AbortController();
      inFlight = controller;
      const start = performance.now();
      try {
        const view = await getRoom(session, controller.signal);
        if (!disposed) apply(session, view);
      } catch (problem) {
        if (disposed || active.current !== session) return;
        if (sessionEnded(problem)) leave(message(problem, 'A sessão foi encerrada.'));
        else setSyncError('Conexão instável. Tentando atualizar a sala.');
      } finally {
        inFlight = null;
        if (!disposed && active.current === session) {
          const delay = refreshAgain ? 0 : Math.max(0, 1000 - (performance.now() - start));
          refreshAgain = false;
          timer = setTimeout(sync, delay);
        }
      }
    }

    function onFocus() {
      if (!inFlight && document.visibilityState === 'visible') void sync();
    }

    refresh.current = sync;
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    void sync();
    return () => {
      disposed = true;
      refresh.current = null;
      clearTimeout(timer);
      inFlight?.abort();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [session, finished, apply, leave]);

  async function join(nickname: string, code = '') {
    if (mutation.current || active.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setError('');
    setPending(true);
    try {
      const result = await enterRoom(nickname, code, controller.signal);
      if (controller.signal.aborted) return;
      const next = { code: result.room.code, token: result.token };
      active.current = next;
      remember(next);
      apply(next, result.room);
      setSession(next);
    } catch (problem) {
      if (!controller.signal.aborted) setError(message(problem, 'Falha de conexão. Tente novamente.'));
    } finally {
      if (mutation.current === controller) {
        mutation.current = null;
        setPending(false);
      }
    }
  }

  async function act(action: Action) {
    const source = active.current;
    const view = latest.current;
    if (!source || !view || mutation.current || awaitingFresh || !view.allowedActions.includes(action.type)) return;

    const controller = new AbortController();
    mutation.current = controller;
    setError('');
    setPending(true);
    try {
      apply(source, await sendAction(source, action, view.version, controller.signal));
    } catch (problem) {
      if (active.current !== source) return;
      if (sessionEnded(problem)) leave(message(problem, 'A sessão foi encerrada.'));
      else {
        if (problem instanceof ApiError && problem.code === 'STALE_VERSION') setStaleVersion(view.version);
        setError(message(problem, 'Não foi possível confirmar a ação. Confira a mesa antes de tentar novamente.'));
        refresh.current?.();
      }
    } finally {
      if (mutation.current === controller) {
        mutation.current = null;
        setPending(false);
      }
    }
  }

  return { session, room, pending: pending || awaitingFresh, error, syncError, join, act, leave };
}
