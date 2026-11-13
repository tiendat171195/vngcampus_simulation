import { type ChannelInfo, type OnlineEntry, PLAYER_STATUS } from '@campus/shared';
import { useEffect, useState } from 'react';
import { useSession } from '../game/core/session';
import { net } from '../game/net/net';

const REFRESH_MS = 4000;

/**
 * Who is online and where (docs/05-multiplayer.md §7), and the channels to move between.
 * Moving to a colleague's channel keeps one's place in the campus.
 */
export function PeoplePanel({ hidden }: { hidden: boolean }) {
  const setProfileCard = useSession((state) => state.setProfileCard);
  const myChannel = useSession((state) => state.net.channel);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<OnlineEntry[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    const load = async () => {
      const [online, list] = await Promise.all([
        fetch(`/rt/online?q=${encodeURIComponent(query.trim())}`)
          .then((r) => (r.ok ? (r.json() as Promise<OnlineEntry[]>) : []))
          .catch(() => []),
        fetch('/rt/channels')
          .then((r) => (r.ok ? (r.json() as Promise<ChannelInfo[]>) : []))
          .catch(() => []),
      ]);
      if (cancelled) return;
      setPeople(online);
      setChannels(list);
    };
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hidden, query]);

  const go = async (roomId: string) => {
    setBusy(true);
    await net.switchChannel(roomId);
    setBusy(false);
  };

  return (
    <section className="panel people" aria-label="Mọi người" hidden={hidden}>
      <input
        className="people-search"
        type="search"
        value={query}
        placeholder="Tìm đồng nghiệp theo tên…"
        aria-label="Tìm theo tên"
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="people-list" data-testid="people-list">
        {people.length === 0 && <li className="note">Không tìm thấy ai.</li>}
        {people.map((person) => (
          <li key={person.userId}>
            <span className="person">
              <b>{person.name}</b>
              {person.status === PLAYER_STATUS.afk && <span className="tag">vắng mặt</span>}
              <span className="where">
                Campus {person.channel}
                {person.area && ` · ${person.area}`}
              </span>
            </span>
            <span className="person-actions">
              <button
                type="button"
                onClick={() =>
                  setProfileCard({ userId: person.userId, name: person.name, guest: false })
                }
              >
                Hồ sơ
              </button>
              {person.channel !== myChannel && (
                <button type="button" disabled={busy} onClick={() => void go(person.roomId)}>
                  Tới kênh này
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <span className="group-label">Kênh</span>
      <ul className="people-list" data-testid="channel-list">
        {channels.map((channel) => (
          <li key={channel.roomId}>
            <span className="person">
              <b>Campus {channel.channel}</b>
              <span className="where">{channel.players} người</span>
            </span>
            {channel.channel === myChannel ? (
              <span className="tag">đang ở đây</span>
            ) : (
              <button type="button" disabled={busy} onClick={() => void go(channel.roomId)}>
                Vào
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
