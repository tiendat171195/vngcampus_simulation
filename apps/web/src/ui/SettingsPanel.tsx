import { QUALITY_PRESETS, type QualitySetting } from '../game/core/quality';
import { useSession } from '../game/core/session';
import { useSettings } from '../game/core/settings';

const OPTIONS: Array<{ value: QualitySetting; label: string }> = [
  { value: 'auto', label: 'Tự động' },
  { value: 'low', label: 'Thấp' },
  { value: 'medium', label: 'Trung bình' },
  { value: 'high', label: 'Cao' },
];

export function SettingsPanel({ hidden }: { hidden: boolean }) {
  const settings = useSettings();
  const quality = useSession((state) => state.quality);

  return (
    <section className="panel" aria-label="Cài đặt" hidden={hidden}>
      <div className="group">
        <span className="group-label">Chất lượng hình ảnh</span>
        <div className="buttons">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={settings.quality === option.value}
              onClick={() => settings.update({ quality: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="note" data-testid="quality-now">
          Đang dùng: {QUALITY_PRESETS[quality.level].label}, độ phân giải ×{quality.dpr}
        </p>
      </div>

      <label className="group slider">
        <span className="group-label">
          Độ nhạy xoay camera: ×{settings.lookSensitivity.toFixed(1)}
        </span>
        <input
          type="range"
          min={0.4}
          max={2}
          step={0.1}
          value={settings.lookSensitivity}
          onChange={(event) => settings.update({ lookSensitivity: Number(event.target.value) })}
        />
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={settings.showHints}
          onChange={(event) => settings.update({ showHints: event.target.checked })}
        />
        Hiện hướng dẫn điều khiển
      </label>
    </section>
  );
}
