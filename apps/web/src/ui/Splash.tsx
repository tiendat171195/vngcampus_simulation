import type { BootstrapResponse, SignInProvider, UserDto } from '@campus/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { type Phase, useSession } from '../game/core/session';
import { loadName, nameProblem, saveName } from '../game/net/identity';
import { loadBootstrap, providerUrl, resume, signIn, signOut } from '../services/auth';

const STEPS: Array<{ phase: Phase; label: string }> = [
  { phase: 'loading', label: 'Tải trò chơi' },
  { phase: 'building', label: 'Dựng campus' },
  { phase: 'ready', label: 'Sẵn sàng' },
];
const ORDER: Phase[] = ['loading', 'building', 'ready', 'playing'];

/** What `?auth_error=` from a provider sign-in means (apps/api/src/routes/oidc.ts). */
const SIGN_IN_FAILURES: Record<string, string> = {
  cancelled: 'Bạn đã huỷ đăng nhập.',
  failed: 'Đăng nhập không thành công, thử lại nhé.',
  expired: 'Lượt đăng nhập đã quá hạn, thử lại nhé.',
  unverified: 'Email của bạn chưa được xác minh.',
  domain: 'Chỉ email công ty mới đăng nhập được.',
  banned: 'Tài khoản này đã bị khoá.',
  unknown: 'Cách đăng nhập này chưa được bật.',
};

/** The sign-in failure the provider round trip came back with, removed from the address bar. */
function takeSignInFailure(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('auth_error');
  if (code === null) return null;
  url.searchParams.delete('auth_error');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return SIGN_IN_FAILURES[code] ?? SIGN_IN_FAILURES.failed ?? null;
}

/** `undefined` while checking; `null` when signed out or the API is unreachable. */
type Account = UserDto | null | undefined;

/**
 * First screen. It paints before the 3D code has downloaded, shows progress while the campus is
 * built behind it, and signs the person in meanwhile: with a company account, or as a guest
 * under a name they choose. Arriving at the gate is the moment of "going to work".
 */
export function Splash() {
  const phase = useSession((state) => state.phase);
  const readyMs = useSession((state) => state.worldReadyMs);
  const setPhase = useSession((state) => state.setPhase);
  const setDisplayName = useSession((state) => state.setDisplayName);
  const [account, setAccount] = useState<Account>(undefined);
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [name, setName] = useState(loadName);
  const [agree, setAgree] = useState(false);
  const [problem, setProblem] = useState<string | null>(takeSignInFailure);
  const [busy, setBusy] = useState(false);
  const ready = phase === 'ready';
  const checking = account === undefined;
  const member = account && !account.isGuest ? account : null;
  const noticeVersion = boot?.privacyNoticeVersion ?? null;
  // Asked again whenever the notice changes; without the API there is nothing to record yet.
  const needsConsent = !account || account.consentVersion !== noticeVersion;
  const guestsAllowed = boot?.guestMode !== 'off';
  const providers = account?.isGuest !== false ? (boot?.providers ?? []) : [];

  useEffect(() => {
    let live = true;
    void Promise.all([loadBootstrap(), resume()]).then(([bootstrap, user]) => {
      if (!live) return;
      setBoot(bootstrap);
      setAccount(user ?? null);
      if (user?.isGuest) setName((typed) => typed || user.displayName);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Signs in (or up, as a guest) and steps in. */
  const enter = async (auto = false) => {
    if (busy || checking) return;
    const trimmed = member ? null : name.trim();
    const issue = trimmed === null ? null : nameProblem(trimmed);
    if (issue) return setProblem(issue);
    if (needsConsent && !agree && !auto)
      return setProblem('Hãy đánh dấu đồng ý với thông báo quyền riêng tư.');
    setBusy(true);
    const result = await signIn(trimmed, needsConsent ? noticeVersion : null);
    setBusy(false);
    if (!result.ok && result.reason === 'refused') return setProblem(result.message);
    // When the API cannot be reached the campus can still be explored alone; the connection
    // banner offers to try again.
    const shown = result.ok ? result.user.displayName : (trimmed ?? 'Khách');
    if (result.ok && result.user.isGuest) saveName(shown);
    setDisplayName(shown);
    setPhase('playing');
  };

  const signInWith = (provider: SignInProvider) => {
    if (needsConsent && !agree)
      return setProblem('Hãy đánh dấu đồng ý với thông báo quyền riêng tư.');
    window.location.assign(providerUrl(provider, needsConsent ? noticeVersion : null));
  };

  // `?enter` steps in on its own once nothing needs asking: a known account that agreed to the
  // current notice.
  useEffect(() => {
    if (!ready || checking || !new URLSearchParams(window.location.search).has('enter')) return;
    if (account && !needsConsent) void enter(true);
    // `enter` is recreated each render; running once when everything is known is what matters.
  }, [ready, checking]);

  if (phase === 'playing') return null;
  const current = ORDER.indexOf(phase);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) void enter();
  };

  return (
    <div className="splash" data-phase={phase}>
      <form className="splash-card" onSubmit={onSubmit} data-account={checking ? 'checking' : ''}>
        <p className="splash-kicker">Campus ảo</p>
        <h1>VNG Campus Online</h1>
        <p className="splash-lead">
          Đi làm bằng avatar, gặp đồng nghiệp đang online và cùng làm nhiệm vụ mỗi ngày.
        </p>

        <ol className="splash-steps" aria-label="Tiến trình tải">
          {STEPS.map((step) => {
            const index = ORDER.indexOf(step.phase);
            const state = index < current ? 'done' : index === current ? 'active' : 'todo';
            return (
              <li key={step.phase} data-state={state === 'active' && ready ? 'done' : state}>
                {step.label}
              </li>
            );
          })}
        </ol>

        {member ? (
          <div className="splash-account" data-testid="splash-account">
            <span>
              Đăng nhập: <strong>{member.displayName}</strong>
              {member.email && <small>{member.email}</small>}
            </span>
            <button
              type="button"
              className="splash-link"
              onClick={() => {
                void signOut().then(() => {
                  setAccount(null);
                  setAgree(false);
                });
              }}
            >
              Đăng xuất
            </button>
          </div>
        ) : (
          guestsAllowed && (
            <label className="splash-name">
              <span>{account?.isGuest ? 'Tên hiển thị (khách)' : 'Tên hiển thị'}</span>
              <input
                className="splash-name-input"
                value={name}
                maxLength={24}
                autoComplete="nickname"
                placeholder="Ví dụ: Minh Anh"
                aria-invalid={problem !== null}
                onChange={(event) => {
                  setName(event.target.value);
                  setProblem(null);
                }}
              />
            </label>
          )
        )}

        {!checking && needsConsent && (
          <label className="splash-consent">
            <input
              type="checkbox"
              className="splash-consent-box"
              checked={agree}
              onChange={(event) => {
                setAgree(event.target.checked);
                setProblem(null);
              }}
            />
            <span>
              Tôi đã đọc và đồng ý với{' '}
              <a href="/privacy" target="_blank" rel="noreferrer">
                thông báo quyền riêng tư
              </a>
              {account ? ' (đã cập nhật)' : ''}.
            </span>
          </label>
        )}
        {problem && (
          <p className="splash-problem" role="alert">
            {problem}
          </p>
        )}

        {(member || guestsAllowed) && (
          <button type="submit" className="splash-enter" disabled={!ready || busy || checking}>
            {!ready ? 'Đang chuẩn bị…' : busy ? 'Đang vào…' : 'Vào campus'}
          </button>
        )}
        {providers.length > 0 && (
          <div className="splash-providers">
            {guestsAllowed && (
              <p>
                {account?.isGuest
                  ? 'Đăng nhập để giữ tiến độ trên mọi thiết bị:'
                  : 'Hoặc đăng nhập bằng tài khoản công ty:'}
              </p>
            )}
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className="splash-provider"
                disabled={checking}
                onClick={() => signInWith(provider.id)}
              >
                Đăng nhập bằng {provider.label}
              </button>
            ))}
          </div>
        )}
        {readyMs !== null && (
          <p className="splash-meta">Sẵn sàng sau {(readyMs / 1000).toFixed(1)} giây</p>
        )}
      </form>
      <p className="splash-credit">
        Bản dựng thử nghiệm · <a href="/privacy">Quyền riêng tư</a> · Dữ liệu bản đồ ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
      </p>
    </div>
  );
}
