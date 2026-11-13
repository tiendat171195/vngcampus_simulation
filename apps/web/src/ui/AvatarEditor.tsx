import {
  ANIM,
  AVATAR_STYLES,
  type AvatarConfig,
  avatarFromSeed,
  CLOTH_COLOURS,
  DEFAULT_AVATAR,
  formatAvatar,
  HAIR_COLOURS,
  parseAvatar,
  SKIN_TONES,
} from '@campus/shared';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../game/avatars/Avatar';
import { useSession } from '../game/core/session';
import { net } from '../game/net/net';
import { saveProfile } from '../services/auth';

type StyleField = 'hair' | 'top' | 'bottom' | 'shoes';
type ColourField = 'hairColour' | 'topColour' | 'bottomColour' | 'shoesColour';

const ROWS: Array<{
  label: string;
  style?: { field: StyleField | 'body' | 'accessory'; options: readonly string[] };
  colour?: { field: ColourField | 'skin'; palette: readonly string[] };
}> = [
  { label: 'Dáng người', style: { field: 'body', options: AVATAR_STYLES.body } },
  { label: 'Màu da', colour: { field: 'skin', palette: SKIN_TONES } },
  {
    label: 'Tóc',
    style: { field: 'hair', options: AVATAR_STYLES.hair },
    colour: { field: 'hairColour', palette: HAIR_COLOURS },
  },
  {
    label: 'Áo',
    style: { field: 'top', options: AVATAR_STYLES.top },
    colour: { field: 'topColour', palette: CLOTH_COLOURS },
  },
  {
    label: 'Quần, váy',
    style: { field: 'bottom', options: AVATAR_STYLES.bottom },
    colour: { field: 'bottomColour', palette: CLOTH_COLOURS },
  },
  {
    label: 'Giày',
    style: { field: 'shoes', options: AVATAR_STYLES.shoes },
    colour: { field: 'shoesColour', palette: CLOTH_COLOURS },
  },
  { label: 'Phụ kiện', style: { field: 'accessory', options: AVATAR_STYLES.accessory } },
];

/** The avatar turning slowly on a stand, in its own small canvas. */
function Preview({ config }: { config: AvatarConfig }) {
  const avatar = useMemo(() => new Avatar(config), []);
  useEffect(() => () => avatar.dispose(), [avatar]);
  useEffect(() => avatar.setAvatar(config), [avatar, config]);
  useFrame(({ camera, size }, dt) => {
    // Whole figure in view whatever the shape of the box: back off on narrow ones.
    const aspect = size.width / Math.max(1, size.height);
    camera.position.set(0, 0.95, aspect < 0.6 ? 4.6 / Math.max(aspect / 0.6, 0.55) : 4.6);
    camera.lookAt(0, 0.88, 0);
    avatar.object.rotation.y += dt * 0.6;
    avatar.update(Math.min(dt, 0.1), { anim: ANIM.idle, speed: 0 });
  });
  return <primitive object={avatar.object} />;
}

/**
 * Dressing room (docs/03 §7): every part and colour, previewed in 3D, saved to the account and
 * shown to everyone in the channel at once.
 */
export function AvatarEditor({ firstRun = false }: { firstRun?: boolean }) {
  const current = useSession((state) => state.avatar);
  const setAvatar = useSession((state) => state.setAvatar);
  const setModal = useSession((state) => state.setModal);
  const [draft, setDraft] = useState<AvatarConfig>(() => parseAvatar(current) ?? DEFAULT_AVATAR);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => setModal(null);
  const change = (patch: Partial<AvatarConfig>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setProblem(null);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = async () => {
    setSaving(true);
    const avatar = formatAvatar(draft);
    const result = await saveProfile({ avatar });
    setSaving(false);
    if (typeof result === 'string') return setProblem(result);
    setAvatar(avatar);
    void net.sendProfile();
    close();
  };

  return (
    <div className="modal-backdrop">
      <section className="avatar-editor" aria-label="Chỉnh avatar" data-testid="avatar-editor">
        <div className="avatar-preview">
          <Canvas camera={{ position: [0, 0.95, 4.6], fov: 28 }} dpr={[1, 2]}>
            <hemisphereLight args={['#ffffff', '#5a6470', 2.2]} />
            <directionalLight position={[2, 3, 2]} intensity={1.6} />
            <Preview config={draft} />
          </Canvas>
        </div>

        <div className="avatar-options">
          <h1>{firstRun ? 'Chọn ngoại hình của bạn' : 'Avatar của bạn'}</h1>
          {firstRun && <p className="note">Đổi lại lúc nào cũng được, trong mục Hồ sơ.</p>}
          {ROWS.map((row) => (
            <div key={row.label} className="avatar-row">
              <span className="group-label">{row.label}</span>
              {row.style && (
                <div className="buttons">
                  {row.style.options.map((label, value) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={draft[row.style?.field as keyof AvatarConfig] === value}
                      onClick={() => change({ [row.style?.field as string]: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {row.colour && (
                <div className="swatches">
                  {row.colour.palette.map((colour, value) => (
                    <button
                      key={colour}
                      type="button"
                      className="swatch"
                      style={{ background: colour }}
                      aria-label={`${row.label}: màu ${value + 1}`}
                      aria-pressed={draft[row.colour?.field as keyof AvatarConfig] === value}
                      onClick={() => change({ [row.colour?.field as string]: value })}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          {problem && (
            <p className="splash-problem" role="alert">
              {problem}
            </p>
          )}
          <div className="avatar-actions">
            <button
              type="button"
              className="avatar-action"
              onClick={() => change(avatarFromSeed(String(Math.random())))}
            >
              Ngẫu nhiên
            </button>
            <span className="spacer" />
            <button type="button" className="avatar-action" onClick={close}>
              {firstRun ? 'Để sau' : 'Huỷ'}
            </button>
            <button
              type="button"
              className="avatar-action primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
