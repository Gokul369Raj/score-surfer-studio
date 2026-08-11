import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SubwayGame } from "@/game3d/SubwayGame";
import { AlertTriangle, Play, RotateCcw, Trophy } from "lucide-react";

interface HudState {
  score: number;
  coins: number;
  highScore: number;
  strikes: number; // obstacle hits this run
  heat: number; // 0..1 how close Sir is
  chasing: boolean; // true while Sir is in full pursuit
}

interface SubwayGameViewProps {
  className?: string;
  onPhaseChange?: (phase: "ready" | "running" | "over") => void;
}

const COIN_STYLE = {
  background: "linear-gradient(180deg, #ffe066 0%, #ffb300 55%, #cc8800 100%)",
  border: "1px solid #b27a00",
  boxShadow: "0 0 10px rgba(255,200,0,0.5)",
} as const;

export default function SubwayGameView({
  className,
  onPhaseChange,
}: SubwayGameViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<SubwayGame | null>(null);
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastHudUpdate = useRef(0);
  const lastStrikes = useRef(0);
  const nearMissTimeout = useRef<number | null>(null);

  const [phase, setPhase] = useState<"ready" | "running" | "over">("ready");
  const [hud, setHud] = useState<HudState>({
    score: 0,
    coins: 0,
    highScore: 0,
    strikes: 0,
    heat: 1,
    chasing: true,
  });
  const [newBest, setNewBest] = useState(false);
  const [nearMiss, setNearMiss] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Keep the latest callback in a ref so the game isn't recreated when the
  // parent passes a new inline callback on re-render.
  const onPhaseChangeRef = useRef(onPhaseChange);
  useEffect(() => {
    onPhaseChangeRef.current = onPhaseChange;
  }, [onPhaseChange]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let game: SubwayGame;
    try {
      game = new SubwayGame(mount, {
        onScore: (score, coins, highScore, chase) => {
          // A new strike (the 1st one) means Sir dives in — flash a warning.
          if (chase.strikes > lastStrikes.current) {
            lastStrikes.current = chase.strikes;
            if (chase.strikes < 2) {
              setNearMiss(true);
              if (nearMissTimeout.current) {
                window.clearTimeout(nearMissTimeout.current);
              }
              nearMissTimeout.current = window.setTimeout(
                () => setNearMiss(false),
                1600,
              );
            }
          }
          // Throttle HUD updates to ~7/sec — the engine reports every frame
          const now = performance.now();
          if (now - lastHudUpdate.current < 140) return;
          lastHudUpdate.current = now;
          setHud({
            score,
            coins,
            highScore,
            strikes: chase.strikes,
            heat: chase.heat,
            chasing: chase.chasing,
          });
        },
        onGameOver: (score, coins, highScore) => {
          setHud((h) => ({ ...h, score, coins, highScore }));
          setNewBest(score >= highScore && score > 0);
          setNearMiss(false);
          setPhase("over");
          onPhaseChangeRef.current?.("over");
        },
      });
    } catch (err) {
      console.error("[SubwayGame] Failed to start 3D engine:", err);
      setFatal(err instanceof Error ? err.message : String(err));
      return;
    }
    gameRef.current = game;

    // Load persisted best for the HUD
    const stored = parseInt(
      localStorage.getItem("subwayRunnerHighScore") || "0",
      10,
    );
    if (stored > 0) setHud((h) => ({ ...h, highScore: stored }));

    return () => {
      if (nearMissTimeout.current) {
        window.clearTimeout(nearMissTimeout.current);
      }
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const startGame = useCallback(() => {
    if (!gameRef.current) return;
    gameRef.current.start();
    setNewBest(false);
    setNearMiss(false);
    lastStrikes.current = 0;
    setPhase("running");
    onPhaseChangeRef.current?.("running");
  }, []);

  // Global keyboard: Space/Enter to start or restart
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        if (phaseRef.current !== "running") {
          e.preventDefault();
          startGame();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startGame]);

  // Touch / mouse swipe controls
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const start = touchStart.current;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const game = gameRef.current;
    if (!game) return;

    // Tap = jump
    if (adx < 18 && ady < 18) {
      game.jump();
      return;
    }
    if (adx > ady) {
      if (dx > 24) game.moveRight();
      else if (dx < -24) game.moveLeft();
    } else {
      if (dy < -24) game.jump();
      else if (dy > 24) game.slide();
    }
  }, []);

  return (
    <div className={`relative w-full h-full overflow-hidden select-none ${className ?? ""}`}>
      {/* 3D mount */}
      <div
        ref={mountRef}
        className="absolute inset-0 cursor-pointer"
        style={{ touchAction: "none" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={() => {
          if (phaseRef.current !== "running") startGame();
          else gameRef.current?.jump();
        }}
      />

      {/* ── Fatal fallback (3D failed to start) ── */}
      {fatal && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#081c44] p-6">
          <div className="max-w-md text-center">
            <div className="inline-block rounded-full border border-white/20 bg-white/10 px-4 py-1.5 mb-4 text-[10px] font-black tracking-[0.35em] text-orange-300">
              RENDERER OFFLINE
            </div>
            <h2 className="text-2xl font-black text-white">3D couldn&apos;t start</h2>
            <p className="mt-2 text-xs break-words text-sky-100/80">{fatal}</p>
            <p className="mt-4 text-xs text-sky-100/60">
              The game needs WebGL. Try Chrome, Edge, or Firefox with hardware
              acceleration enabled, then reload this page.
            </p>
          </div>
        </div>
      )}

      {/* ── HUD (running) ── */}
      {phase === "running" && !fatal && (
        <div className="absolute inset-x-0 top-0 pointer-events-none">
          <div className="flex items-start justify-between px-4 md:px-6 pt-4">
            {/* Score */}
            <div className="min-w-[110px]">
              <div className="text-[10px] md:text-xs font-bold tracking-[0.25em] text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                SCORE
              </div>
              <div className="text-3xl md:text-4xl font-black text-white tabular-nums drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)]">
                {hud.score}
              </div>
            </div>

            {/* Coins */}
            <div className="flex items-center gap-2 rounded-full border border-white/20 bg-black/30 px-3 py-1.5 backdrop-blur-sm">
              <span
                className="inline-block w-5 h-5 rounded-full"
                style={COIN_STYLE}
              />
              <span className="text-lg md:text-xl font-black text-white tabular-nums drop-shadow">
                {hud.coins}
              </span>
            </div>

            {/* Best */}
            <div className="min-w-[110px] text-right">
              <div className="text-[10px] md:text-xs font-bold tracking-[0.25em] text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                BEST
              </div>
              <div className="text-xl md:text-2xl font-extrabold text-orange-300 tabular-nums drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)]">
                {hud.highScore}
              </div>
            </div>
          </div>

          {/* Chase meter — how close Sir is + strikes before he catches you */}
          <div className="mt-3 flex flex-col items-center gap-1.5 px-4">
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 py-1.5 backdrop-blur-sm">
              <span className="text-[9px] font-black tracking-[0.2em] text-orange-300">
                SIR
              </span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/20 md:w-32">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.round(hud.heat * 100)}%`,
                    background:
                      hud.heat > 0.55
                        ? "linear-gradient(90deg,#ff8c1a,#ffc107)"
                        : "linear-gradient(90deg,#38bdf8,#7dd3fc)",
                  }}
                />
              </div>
              <span
                className={`text-[10px] font-black ${
                  hud.chasing ? "text-orange-300" : "text-sky-300"
                }`}
              >
                {hud.chasing ? "ON YOUR TAIL" : "FELL BACK"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {[0, 1].map((i) => (
                <span
                  key={i}
                  className={`inline-block h-2 w-2 rounded-full ${
                    i < hud.strikes ? "bg-red-500" : "bg-white/25"
                  }`}
                />
              ))}
              <span className="ml-1 text-[9px] font-bold tracking-widest text-white/70">
                {hud.strikes >= 2
                  ? "CAUGHT!"
                  : `${hud.strikes}/2 hits before Sir catches you`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Near-miss banner (1st obstacle hit) ── */}
      <AnimatePresence>
        {nearMiss && phase === "running" && !fatal && (
          <motion.div
            key="near-miss"
            initial={{ opacity: 0, y: -18, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-x-0 top-32 z-10 flex justify-center pointer-events-none md:top-36"
          >
            <div className="flex items-center gap-2 rounded-full border border-orange-300/50 bg-orange-500/25 px-4 py-2 text-xs font-black tracking-wide text-orange-100 backdrop-blur-sm">
              <AlertTriangle className="h-4 w-4 text-orange-300" />
              CLOSE CALL — SIR IS RIGHT BEHIND YOU!
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Ready screen ── */}
      {phase === "ready" && !fatal && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#081c44]/95 via-[#0e2f6d]/90 to-[#081c44]/95 backdrop-blur-[2px]">
          <div className="max-w-md px-6 text-center">
            <div className="mb-5 inline-block rounded-full border border-orange-300/40 bg-orange-400/10 px-4 py-1.5 text-[10px] font-black tracking-[0.35em] text-orange-300">
              TIT BHOPAL · ENDLESS CHASE
            </div>
            <h1 className="text-4xl leading-tight font-black tracking-tight text-white md:text-5xl">
              GOKUL
              <span className="block bg-gradient-to-r from-orange-300 via-amber-400 to-orange-500 bg-clip-text text-transparent">
                RUNNER
              </span>
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-sky-100/90 md:text-base">
              Gokul skipped class at TIT Bhopal — and Nischay Sir is right
              behind him! Outrun Sir and he loses steam... but hit an obstacle
              and he sprints right back. Two hits and he catches you!
            </p>

            {/* Controls */}
            <div className="mt-6 grid grid-cols-2 gap-2.5 text-left">
              {[
                { k: "← → / A D", v: "Switch lanes" },
                { k: "↑ / W", v: "Jump" },
                { k: "↓ / S", v: "Slide" },
                { k: "Tap / Swipe", v: "Touch controls" },
              ].map((c) => (
                <div
                  key={c.k}
                  className="rounded-xl border border-white/15 bg-white/10 px-3 py-2.5"
                >
                  <div className="text-[11px] font-bold tracking-wide text-orange-300">
                    {c.k}
                  </div>
                  <div className="mt-0.5 text-[11px] text-sky-100/80">
                    {c.v}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={startGame}
              className="mt-7 inline-flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-orange-400 via-orange-500 to-orange-600 px-8 py-4 text-lg font-black text-white transition-all hover:brightness-110 active:scale-[0.98]"
            >
              <Play className="w-5 h-5 fill-white" />
              Start Running
            </button>
            <p className="mt-3 text-[11px] text-sky-200/70">
              or press <kbd className="rounded border border-white/20 bg-white/15 px-1.5 py-0.5 font-mono text-[10px]">Space</kbd> to begin
            </p>
            <p className="mt-5 text-[10px] font-medium tracking-wide text-sky-200/50">
              TECHNOCRATS INSTITUTE OF TECHNOLOGY · BHOPAL
            </p>
          </div>
        </div>
      )}

      {/* ── Game over screen ── */}
      {phase === "over" && !fatal && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#0a1228]/95 via-[#0e2f6d]/90 to-[#0a1228]/95 backdrop-blur-[2px]">
          <div className="w-full max-w-md px-6 text-center">
            <div className="mb-4 inline-block rounded-full border border-orange-300/40 bg-orange-400/10 px-4 py-1.5 text-[10px] font-black tracking-[0.35em] text-orange-300">
              {newBest ? "NEW RECORD" : "CAUGHT!"}
            </div>
            <h2 className="text-4xl font-black text-white md:text-5xl">
              {newBest ? (
                <span className="inline-flex items-center gap-3">
                  <Trophy className="w-9 h-9 text-amber-300" />
                  New Record!
                </span>
              ) : (
                "Caught by Sir!"
              )}
            </h2>
            <p className="mt-2 text-sm text-sky-100/80">
              {newBest
                ? "Gokul smashed his best run — the whole class is cheering."
                : "Second hit was one too many. Nischay Sir finally caught Gokul."}
            </p>

            {/* Score card */}
            <div className="mt-6 rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-sm">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[10px] font-bold tracking-widest text-white/60">
                    SCORE
                  </div>
                  <div className="mt-1 text-2xl font-black text-white tabular-nums md:text-3xl">
                    {hud.score}
                  </div>
                </div>
                <div className="border-x border-white/15">
                  <div className="text-[10px] font-bold tracking-widest text-white/60">
                    COINS
                  </div>
                  <div className="mt-1 text-2xl font-black text-amber-300 tabular-nums md:text-3xl">
                    {hud.coins}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold tracking-widest text-white/60">
                    BEST
                  </div>
                  <div className="mt-1 text-2xl font-black text-orange-300 tabular-nums md:text-3xl">
                    {hud.highScore}
                  </div>
                </div>
              </div>
            </div>

            {newBest && (
              <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-amber-300">
                <Trophy className="w-4 h-4" /> You beat your previous best!
              </div>
            )}

            <button
              onClick={startGame}
              className="mt-7 inline-flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-800 px-8 py-4 text-lg font-black text-white transition-all hover:brightness-110 active:scale-[0.98]"
            >
              <RotateCcw className="w-5 h-5" />
              Run Again
            </button>
            <p className="mt-3 text-[11px] text-sky-200/70">
              or press <kbd className="rounded border border-white/20 bg-white/15 px-1.5 py-0.5 font-mono text-[10px]">Space</kbd>
            </p>
          </div>
        </div>
      )}

      {/* ── Mobile touch buttons ── */}
      {phase === "running" && !fatal && (
        <div className="absolute inset-x-0 bottom-0 flex justify-between px-5 pb-5 md:hidden pointer-events-none">
          <div className="pointer-events-auto flex gap-3">
            <button
              className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-black/35 text-2xl font-black text-white backdrop-blur-sm transition-all active:scale-95 active:bg-black/55"
              onTouchStart={(e) => {
                e.stopPropagation();
                gameRef.current?.moveLeft();
              }}
              onClick={(e) => {
                e.stopPropagation();
                gameRef.current?.moveLeft();
              }}
              aria-label="Move left"
            >
              ◀
            </button>
            <button
              className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-black/35 text-2xl font-black text-white backdrop-blur-sm transition-all active:scale-95 active:bg-black/55"
              onTouchStart={(e) => {
                e.stopPropagation();
                gameRef.current?.moveRight();
              }}
              onClick={(e) => {
                e.stopPropagation();
                gameRef.current?.moveRight();
              }}
              aria-label="Move right"
            >
              ▶
            </button>
          </div>
          <div className="pointer-events-auto flex gap-3">
            <button
              className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-black/35 text-xl font-black text-white backdrop-blur-sm transition-all active:scale-95 active:bg-black/55"
              onTouchStart={(e) => {
                e.stopPropagation();
                gameRef.current?.jump();
              }}
              onClick={(e) => {
                e.stopPropagation();
                gameRef.current?.jump();
              }}
              aria-label="Jump"
            >
              ⬆
            </button>
            <button
              className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-black/35 text-xl font-black text-white backdrop-blur-sm transition-all active:scale-95 active:bg-black/55"
              onTouchStart={(e) => {
                e.stopPropagation();
                gameRef.current?.slide();
              }}
              onClick={(e) => {
                e.stopPropagation();
                gameRef.current?.slide();
              }}
              aria-label="Slide"
            >
              ⬇
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
