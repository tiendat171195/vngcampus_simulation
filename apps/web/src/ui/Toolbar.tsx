import { useState } from 'react';
import { DebugPanel } from '../game/debug/DebugPanel';
import { ChannelBadge } from './ConnectionBanner';
import { PeoplePanel } from './PeoplePanel';
import { SettingsPanel } from './SettingsPanel';

type Open = 'people' | 'settings' | 'debug' | null;

/** Buttons in the top-right corner, each opening its panel underneath. */
export function Toolbar() {
  const [open, setOpen] = useState<Open>(null);
  const toggle = (panel: Exclude<Open, null>) => setOpen(open === panel ? null : panel);

  return (
    <div className="toolbar">
      <div className="toolbar-buttons">
        <button
          type="button"
          className="pill"
          aria-expanded={open === 'people'}
          onClick={() => toggle('people')}
        >
          Mọi người
        </button>
        <button
          type="button"
          className="pill"
          aria-expanded={open === 'settings'}
          onClick={() => toggle('settings')}
        >
          Cài đặt
        </button>
        <button
          type="button"
          className="pill"
          aria-expanded={open === 'debug'}
          onClick={() => toggle('debug')}
        >
          Debug
        </button>
      </div>
      <ChannelBadge />
      <PeoplePanel hidden={open !== 'people'} />
      <SettingsPanel hidden={open !== 'settings'} />
      <DebugPanel hidden={open !== 'debug'} />
    </div>
  );
}
