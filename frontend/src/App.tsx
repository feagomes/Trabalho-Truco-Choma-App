import { useEffect, useState, type FormEvent } from 'react';
import { FinalScore, Lobby, Table } from './Game';
import { useRoom } from './useRoom';

function Entry({
  pending,
  error,
  onSubmit,
}: {
  pending: boolean;
  error: string;
  onSubmit: (nickname: string, code?: string) => void;
}) {
  const [entering, setEntering] = useState(false);
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [validation, setValidation] = useState({ nickname: '', code: '' });
  const [hideError, setHideError] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = nickname.trim();
    const roomCode = code.trim();
    const issues = {
      nickname: name.length < 2 || name.length > 20 ? 'Use de 2 a 20 caracteres.' : '',
      code: entering && !roomCode ? 'Informe o código da sala.' : '',
    };
    setValidation(issues);
    setHideError(false);
    if (issues.nickname || issues.code) {
      document.getElementById(issues.nickname ? 'nickname' : 'room-code')?.focus();
      return;
    }
    onSubmit(name, entering ? roomCode : undefined);
  }

  function switchMode(joining: boolean) {
    setEntering(joining);
    setValidation({ nickname: '', code: '' });
    setHideError(true);
  }

  return (
    <section className="entrance">
      <div className="welcome">
        <div className="welcome-copy">
          <h1 id="screen-title" tabIndex={-1}>Truco em<br /><em>duplas.</em></h1>
          <p>Quatro jogadores. A primeira dupla a chegar a 12 pontos vence.</p>
        </div>
        <div className="card-fan" aria-hidden="true">
          <span className="cover-card cover-left"><small>3<br />♦</small>♦</span>
          <span className="cover-card cover-right"><small>J<br />♣</small>♣</span>
          <span className="cover-card cover-front"><small>A<br />♠</small>♠</span>
        </div>
      </div>

      <div className="entry-panel">
        <h2>Entre na mesa</h2>
        <div className="mode" role="group" aria-label="Acesso à sala">
          <button type="button" aria-pressed={!entering} disabled={pending} onClick={() => switchMode(false)}>
            Criar sala
          </button>
          <button type="button" aria-pressed={entering} disabled={pending} onClick={() => switchMode(true)}>
            Entrar por código
          </button>
        </div>
        <form onSubmit={submit} noValidate>
          <label htmlFor="nickname">Seu apelido</label>
          <input
            id="nickname"
            value={nickname}
            onChange={(event) => {
              setNickname(event.target.value);
              setValidation({ ...validation, nickname: '' });
              setHideError(true);
            }}
            aria-invalid={!!validation.nickname}
            aria-describedby={validation.nickname ? 'nickname-error' : undefined}
            disabled={pending}
            maxLength={20}
            autoComplete="off"
            placeholder="Ex.: Bia"
          />
          {validation.nickname && <span className="field-error" id="nickname-error" role="alert">{validation.nickname}</span>}

          {entering && <>
            <label htmlFor="room-code">Código da sala</label>
            <input
              id="room-code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setValidation({ ...validation, code: '' });
                setHideError(true);
              }}
              aria-invalid={!!validation.code}
              aria-describedby={validation.code ? 'room-code-error' : undefined}
              disabled={pending}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Código do convite"
            />
            {validation.code && <span className="field-error" id="room-code-error" role="alert">{validation.code}</span>}
          </>}
          {!hideError && error && <p className="notice" role="alert">{error}</p>}
          <button type="submit" className="button button-primary" disabled={pending}>
            {pending ? 'Conectando…' : entering ? 'Entrar na sala' : 'Criar minha sala'}
          </button>
        </form>
      </div>
    </section>
  );
}

export function App() {
  const { session, room, pending, error, syncError, join, act, leave } = useRoom();
  const screen = room?.status ?? (session ? 'RECOVERING' : 'ENTRY');

  useEffect(() => {
    document.getElementById('screen-title')?.focus();
  }, [screen]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="wordmark"><span aria-hidden="true">♠</span> Truco Choma</div>
        {session && screen !== 'FINISHED' && (
          <button className="button button-quiet" onClick={() => {
            if (screen !== 'PLAYING' || window.confirm('Voltar à entrada encerra a sessão nesta aba. Sua vaga continuará ocupada. Sair da mesa?')) {
              leave();
            }
          }}>Voltar à entrada</button>
        )}
      </header>

      <main>
        {session && syncError && <div className="connection" role="status">{syncError}</div>}
        {room ? (
          <>
            {room.status !== 'FINISHED' && error && <p className="notice game-error" role="alert">{error}</p>}
            {room.status === 'WAITING' && <Lobby room={room} pending={pending} act={act} />}
            {room.status === 'PLAYING' && <Table room={room} pending={pending} act={act} />}
            {room.status === 'FINISHED' && <FinalScore room={room} onBack={() => leave()} />}
          </>
        ) : session ? (
          <section className="recover">
            <h1 id="screen-title" tabIndex={-1}>Recuperando a sala</h1>
            <p role="status">Buscando a mesa {session.code}…</p>
          </section>
        ) : <Entry pending={pending} error={error} onSubmit={join} />}
      </main>
    </div>
  );
}
