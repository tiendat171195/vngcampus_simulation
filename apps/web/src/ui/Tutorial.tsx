import { useEffect, useState } from 'react';
import { markTutorialDone, resetTutorialSink, tutorialSink } from '../game/core/tutorial';

const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const STEPS = [
  {
    title: 'Đi lại',
    text: touch
      ? 'Đặt ngón tay ở nửa trái màn hình rồi kéo để đi.'
      : 'Dùng W A S D hoặc phím mũi tên. Giữ Shift để chạy.',
    done: () => tutorialSink.walked > 4,
  },
  {
    title: 'Nhìn quanh',
    text: touch ? 'Vuốt ở nửa phải màn hình để xoay camera.' : 'Kéo chuột để xoay camera.',
    done: () => tutorialSink.turned > Math.PI / 3,
  },
  {
    title: 'Chào mọi người',
    text: touch ? 'Bấm nút 👋 để vẫy tay.' : 'Bấm phím 1 hoặc nút 👋 để vẫy tay.',
    done: () => tutorialSink.waved,
  },
];

/** A small card that walks a first-time visitor through moving, looking and waving. */
export function Tutorial({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => resetTutorialSink(), []);

  useEffect(() => {
    if (step >= STEPS.length) {
      markTutorialDone();
      const timer = window.setTimeout(onFinish, 2500);
      return () => window.clearTimeout(timer);
    }
    // Per-frame progress stays out of React; look at it a few times a second.
    const timer = window.setInterval(() => {
      // The interval can fire again before React re-renders; advance from this step only once.
      if (STEPS[step]?.done()) setStep((current) => (current === step ? step + 1 : current));
    }, 250);
    return () => window.clearInterval(timer);
  }, [step, onFinish]);

  const current = STEPS[step];
  return (
    <section className="tutorial" aria-live="polite" data-testid="tutorial">
      {current ? (
        <>
          <p className="tutorial-step">
            Bước {step + 1}/{STEPS.length}
          </p>
          <h2>{current.title}</h2>
          <p>{current.text}</p>
          <div className="tutorial-dots" aria-hidden="true">
            {STEPS.map((item, index) => (
              <span
                key={item.title}
                data-state={index < step ? 'done' : index === step ? 'now' : ''}
              />
            ))}
          </div>
          <button
            type="button"
            className="tutorial-skip"
            onClick={() => {
              markTutorialDone();
              onFinish();
            }}
          >
            Bỏ qua
          </button>
        </>
      ) : (
        <h2>Xong rồi! Chúc một ngày làm việc vui vẻ.</h2>
      )}
    </section>
  );
}
