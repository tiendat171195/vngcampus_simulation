import type { CommunityGoalDto, MissionView } from '@campus/shared';
import { useEffect, useRef, useState } from 'react';
import { playerPose } from '../game/core/pose';
import { useSession } from '../game/core/session';
import { waypointSink } from '../game/missions/MissionEntities';
import { useMissions } from '../game/missions/missionStore';
import { net } from '../game/net/net';
import { loadCommunity } from '../services/directory';

const KIND_LABEL: Record<string, string> = {
  daily: 'Nhiệm vụ hôm nay',
  weekly: 'Nhiệm vụ tuần',
  event: 'Sự kiện',
  onboarding: 'Làm quen',
};

/** "còn 3 giờ 20 phút" until the mission ends. */
function timeLeft(endsAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((Date.parse(endsAt) - now) / 60_000));
  if (minutes < 60) return `còn ${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `còn ${hours} giờ ${minutes % 60} phút` : `còn ${hours} giờ`;
}

const rewardText = (mission: MissionView) =>
  [
    mission.rewards.points && `+${mission.rewards.points} điểm`,
    mission.rewards.xp && `+${mission.rewards.xp} KN`,
  ]
    .filter(Boolean)
    .join(' · ');

/** The mission banner: shown on arrival and when a new mission starts (docs/06 §8). */
export function MissionBanner() {
  const bannerId = useMissions((state) => state.banner);
  const mission = useMissions((state) => state.missions.find((m) => m.id === state.banner));
  const setBanner = useMissions((state) => state.setBanner);
  if (!bannerId || !mission) return null;
  return (
    <div className="modal-backdrop">
      <section className="mission-banner" aria-label="Nhiệm vụ" data-testid="mission-banner">
        <p className="mission-kicker">{KIND_LABEL[mission.kind] ?? 'Nhiệm vụ'}</p>
        <h1>{mission.title.vi}</h1>
        <p className="mission-lead">{mission.description.vi}</p>
        <ul className="mission-goals">
          {mission.objectives.map((objective) => (
            <li key={objective.id} data-done={objective.done}>
              {objective.title.vi}
              {objective.optional && <span className="mission-optional"> (không bắt buộc)</span>}
            </li>
          ))}
        </ul>
        <p className="mission-meta">
          {rewardText(mission)} · {timeLeft(mission.endsAt, Date.now())}
        </p>
        <button type="button" className="mission-go" onClick={() => setBanner(null)}>
          Bắt đầu
        </button>
      </section>
    </div>
  );
}

/** "Cả công ty: 120/300" for missions with a community goal, refreshed every half minute. */
function CommunityLine({ missionId }: { missionId: string }) {
  const [goal, setGoal] = useState<CommunityGoalDto | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void loadCommunity(missionId).then((result) => {
        if (live && typeof result !== 'string') setGoal(result);
      });
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [missionId]);
  if (!goal?.target) return null;
  return (
    <p className="mission-community" data-testid="community-goal">
      Cả công ty: {Math.min(goal.completions, goal.target)}/{goal.target} lượt hoàn thành
    </p>
  );
}

/** The compact list on the HUD: every objective with its count; tap one to be guided to it. */
export function MissionTracker() {
  const missions = useMissions((state) => state.missions);
  const tracked = useMissions((state) => state.tracked);
  const track = useMissions((state) => state.track);
  const setBanner = useMissions((state) => state.setBanner);
  const [folded, setFolded] = useState(false);
  const open = missions.filter((mission) => !mission.completed);
  if (missions.length === 0) return null;
  return (
    <section
      className="mission-tracker"
      aria-label="Theo dõi nhiệm vụ"
      data-testid="mission-tracker"
    >
      <button
        type="button"
        className="mission-tracker-head"
        onClick={() => setFolded(!folded)}
        aria-expanded={!folded}
      >
        {open.length === 0 ? '✓ Đã xong nhiệm vụ' : `Nhiệm vụ (${open.length})`}
      </button>
      {!folded &&
        missions.map((mission) => (
          <div key={mission.id} className="mission-block" data-done={mission.completed}>
            <button type="button" className="mission-title" onClick={() => setBanner(mission.id)}>
              {mission.completed ? '✓ ' : ''}
              {mission.title.vi}
            </button>
            <CommunityLine missionId={mission.id} />
            {!mission.completed && (
              <ol>
                {mission.objectives.map((objective) => {
                  const active =
                    tracked?.missionId === mission.id && tracked.objectiveId === objective.id;
                  return (
                    <li key={objective.id}>
                      <button
                        type="button"
                        className="mission-step"
                        data-done={objective.done}
                        data-active={active}
                        disabled={objective.done}
                        onClick={() => track({ missionId: mission.id, objectiveId: objective.id })}
                      >
                        <span>{objective.title.vi}</span>
                        <b className="mission-count" data-testid={`objective-${objective.id}`}>
                          {objective.done ? '✓' : `${objective.current}/${objective.target}`}
                        </b>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        ))}
    </section>
  );
}

/**
 * Compass to the tracked target (docs/06 §8): an arrow turned with the camera, the distance and
 * what is there. Moved by a rAF loop outside React; the beam in the world marks the spot.
 */
export function WaypointCompass() {
  const box = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    let shown = '';
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const target = waypointSink.target;
      if (!box.current || !arrow.current || !text.current) return;
      if (!target || !playerPose.ready) {
        box.current.hidden = true;
        return;
      }
      box.current.hidden = false;
      const dx = target.x - playerPose.x;
      const dz = target.z - playerPose.z;
      const distance = Math.hypot(dx, dz);
      // Forward on screen is the camera heading; the arrow turns by the angle off it.
      const relative = Math.atan2(dx, dz) - playerPose.heading;
      arrow.current.style.transform = `rotate(${-relative}rad)`;
      const label = `${distance < 3 ? 'Ngay đây' : `${Math.round(distance)} m`} · ${target.label}`;
      if (label !== shown) {
        shown = label;
        text.current.textContent = label;
      }
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="waypoint" ref={box} hidden data-testid="waypoint">
      <span className="waypoint-arrow" ref={arrow} aria-hidden="true">
        ▲
      </span>
      <span ref={text} />
    </div>
  );
}

/** Questions at a kiosk; the answer is checked by the server (docs/06 §9). */
export function QuizDialog() {
  const quiz = useMissions((state) => state.quiz);
  const result = useMissions((state) => state.quizResult);
  const setQuiz = useMissions((state) => state.setQuiz);
  const setQuizResult = useMissions((state) => state.setQuizResult);
  const setModal = useSession((state) => state.setModal);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (quiz) setModal('quiz');
  }, [quiz, setModal]);

  if (!quiz) return null;
  const answered = result?.questionId === quiz.questionId;
  const close = () => {
    setQuiz(null);
    setModal(null);
  };
  return (
    <div className="modal-backdrop">
      <section className="quiz" aria-label="Câu hỏi" data-testid="quiz">
        <p className="mission-kicker">
          Câu {quiz.index}/{quiz.total}
        </p>
        {result && (
          <p className="quiz-feedback" data-correct={result.correct} role="status">
            {result.correct ? 'Chính xác!' : answered ? 'Chưa đúng, thử lại nhé.' : 'Chưa đúng.'}
            {result.explanation && ` ${result.explanation.vi}`}
          </p>
        )}
        {result?.finished ? (
          <p className="quiz-text">Hết câu hỏi của lượt này.</p>
        ) : (
          <>
            <h2 className="quiz-text">{quiz.text.vi}</h2>
            <div className="quiz-choices">
              {quiz.choices.map((choice, index) => (
                <button
                  key={choice.vi}
                  type="button"
                  className="quiz-choice"
                  disabled={sent === `${quiz.questionId}:${index}` && !result}
                  onClick={() => {
                    setSent(`${quiz.questionId}:${index}`);
                    setQuizResult(null);
                    net.answerQuiz({
                      missionId: quiz.missionId,
                      objectiveId: quiz.objectiveId,
                      questionId: quiz.questionId,
                      choice: index,
                    });
                  }}
                >
                  {choice.vi}
                </button>
              ))}
            </div>
          </>
        )}
        <button type="button" className="quiz-close" onClick={close}>
          {result?.finished ? 'Đóng' : 'Để sau'}
        </button>
      </section>
    </div>
  );
}

/** Celebration when a mission is done: what it earned, the streak, the level (docs/06 §8). */
export function MissionComplete() {
  const completed = useMissions((state) => state.completed);
  const dismiss = useMissions((state) => state.complete);
  if (!completed) return null;
  const minutes = Math.max(1, Math.round(completed.durationMs / 60_000));
  return (
    <div className="modal-backdrop">
      <section
        className="mission-complete"
        aria-label="Hoàn thành nhiệm vụ"
        data-testid="mission-complete"
      >
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} style={{ '--i': i } as React.CSSProperties} />
          ))}
        </div>
        <p className="mission-kicker">Hoàn thành!</p>
        <h1>{completed.title.vi}</h1>
        <p className="mission-reward">
          +{completed.points} điểm · +{completed.xp} KN
          {completed.multiplier > 1 && <span> (giờ vàng ×{completed.multiplier})</span>}
        </p>
        {completed.streak !== null && (
          <p className="mission-streak">
            🔥 Chuỗi {completed.streak} ngày
            {completed.streakBonus > 0 && ` · thưởng +${completed.streakBonus} điểm`}
          </p>
        )}
        <p className="mission-meta">
          Cấp {completed.level} · xong trong {minutes} phút
        </p>
        <button type="button" className="mission-go" onClick={() => dismiss(null)}>
          Tuyệt!
        </button>
      </section>
    </div>
  );
}
