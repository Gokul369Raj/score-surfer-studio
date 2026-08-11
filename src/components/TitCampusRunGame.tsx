import { useEffect, useRef, useState } from "react";
import { TitCampusRun, type GameStats, type Screen } from "../game3d/TitCampusRun";

const KEYMAP: Record<string, "left" | "right" | "jump" | "slide" | "pause"> = {
  ArrowLeft: "left",
  a: "left",
  A: "left",
  ArrowRight: "right",
  d: "right",
  D: "right",
  ArrowUp: "jump",
  w: "jump",
  W: "jump",
  " ": "jump",
  ArrowDown: "slide",
  s: "slide",
  S: "slide",
  p: "pause",
  P: "pause",
  Escape: "pause",
};

export function TitCampusRunGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<TitCampusRun | null>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [showHow, setShowHow] = useState(false);
  const [muted, setMuted] = useState(false);
  const [finalStats, setFinalStats] = useState<GameStats | null>(null);

  // HUD refs updated directly — no React re-renders during gameplay
  const scoreRef = useRef<HTMLSpanElement>(null);
  const coinsRef = useRef<HTMLSpanElement>(null);
  const distRef = useRef<HTMLSpanElement>(null);
  const hitsRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLSpanElement>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const swipe = useRef({ sx: 0, sy: 0, down: false, locked: false });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const game = new TitCampusRun(mount, {
      onStats: (s) => {
        if (scoreRef.current) scoreRef.current.textContent = String(s.score);
        if (coinsRef.current) coinsRef.current.textContent = String(s.coins);
        if (distRef.current) distRef.current.textContent = `${Math.floor(s.distance / 10)}m`;
      },
      onHits: (h) => {
        if (hitsRef.current) {
          hitsRef.current.textContent = `${h}/3 HITS`;
          hitsRef.current.classList.remove("flash");
          void hitsRef.current.offsetWidth;
          hitsRef.current.classList.add("flash");
        }
      },
      onChase: (bar, onTail) => {
        if (barRef.current) barRef.current.style.width = `${Math.round(bar * 100)}%`;
        if (tailRef.current) {
          tailRef.current.textContent = onTail ? "ON YOUR TAIL!" : "GAINING...";
          tailRef.current.classList.toggle("tail-hot", onTail);
        }
      },
      onGameOver: (s) => {
        setFinalStats(s);
        setScreen("gameover");
      },
    });
    gameRef.current = game;

    const onKey = (e: KeyboardEvent) => {
      const action = KEYMAP[e.key];
      if (!action) return;
      if (action === "pause") {
        if (screenRef.current === "playing") game.pause();
        else if (screenRef.current === "paused") game.resume();
        return;
      }
      e.preventDefault();
      if (action === "left") game.moveLeft();
      else if (action === "right") game.moveRight();
      else if (action === "jump") game.jump();
      else if (action === "slide") game.slide();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  // ---- swipe controls ----------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    swipe.current = { sx: e.clientX, sy: e.clientY, down: true, locked: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = swipe.current;
    if (!s.down || s.locked) return;
    const dx = e.clientX - s.sx;
    const dy = e.clientY - s.sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
    s.locked = true;
    const g = gameRef.current;
    if (!g) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) g.moveRight();
      else g.moveLeft();
    } else {
      if (dy < 0) g.jump();
      else g.slide();
    }
  };
  const onPointerUp = () => {
    swipe.current.down = false;
  };

  const play = () => {
    const g = gameRef.current;
    if (!g) return;
    g.unlockAudio();
    g.start();
    setScreen("playing");
  };
  const resume = () => {
    gameRef.current?.resume();
    setScreen("playing");
  };
  const pause = () => {
    gameRef.current?.pause();
    setScreen("paused");
  };
  const toMenu = () => {
    gameRef.current?.backToMenu();
    setScreen("menu");
  };
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    gameRef.current?.setMuted(m);
  };

  return (
    <div
      className="game-root"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="game-canvas" ref={mountRef} />

      {/* ---------------------------------------------------------- HUD */}
      <div className={`hud ${screen === "playing" ? "hud-visible" : ""}`}>
        <div className="hud-top-row">
          <div className="hud-stats">
            <div className="stat">
              <span className="stat-label">SCORE</span>
              <span className="stat-value mono" ref={scoreRef}>0</span>
            </div>
            <div className="stat">
              <span className="stat-label">COINS</span>
              <span className="stat-value mono coin-stat" ref={coinsRef}>0</span>
            </div>
            <div className="stat">
              <span className="stat-label">DISTANCE</span>
              <span className="stat-value mono" ref={distRef}>0m</span>
            </div>
          </div>
          <button className="icon-btn" onClick={pause} aria-label="Pause">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="5" y="4" width="5" height="16" rx="1.5" />
              <rect x="14" y="4" width="5" height="16" rx="1.5" />
            </svg>
          </button>
        </div>

        {/* Nischay chase meter — compact pill: name + hits */}
        <div className="chase-box">
          <span className="chase-name">NISCHAY KAUSHAL</span>
          <span className="chase-hits" ref={hitsRef}>0/3 HITS</span>
        </div>
      </div>

      {/* touch controls: swipe-only (no on-screen buttons) */}

      {/* ---------------------------------------------------- START SCREEN */}
      {screen === "menu" && (
        <div className="overlay menu-overlay">
          <div className="menu-inner">
            <p className="menu-kicker">TECHNOCRATS INSTITUTE OF TECHNOLOGY · BHOPAL</p>
            <h1 className="menu-title">TIT CAMPUS RUN</h1>
            <p className="menu-subtitle">Gokul vs Nischay Kaushal</p>
            <p className="menu-tag">
              TNP class? No thanks. Gokul slipped out of the placement-cell session — but Nischay
              Kaushal, the TNP Cell Head, is sprinting right behind him. One wrong move and he's
              back in class! Dodge, jump and slide across TIT Bhopal.
            </p>
            <div className="menu-actions">
              <button className="btn btn-primary" onClick={play}>▶&nbsp; PLAY</button>
              <button className="btn btn-ghost" onClick={() => { gameRef.current?.unlockAudio(); setShowHow(true); }}>HOW TO PLAY</button>
            </div>
            <button className="btn btn-ghost btn-mute" onClick={toggleMute}>
              {muted ? "🔇 SOUND OFF" : "🔊 SOUND ON"}
            </button>
            <p className="menu-foot">Original fan-made campus runner · No copyrighted assets</p>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- HOW TO PLAY */}
      {showHow && (
        <div className="overlay how-overlay" onClick={() => setShowHow(false)}>
          <div className="how-card" onClick={(e) => e.stopPropagation()}>
            <h2>HOW TO PLAY</h2>
            <div className="how-grid">
              <div className="how-item"><span className="how-key">←</span><span className="how-key">→</span><b>Move lanes</b><p>Swipe left/right or use arrow keys</p></div>
              <div className="how-item"><span className="how-key">↑</span><b>Jump</b><p>Swipe up, W / Up / Space</p></div>
              <div className="how-item"><span className="how-key">↓</span><b>Slide</b><p>Swipe down, S / Down — slide under gates</p></div>
              <div className="how-item"><span className="how-key">ⓘ</span><b>Watch the meter</b><p>Nischay Kaushal closes in after every hit. 3 hits and you're caught!</p></div>
            </div>
            <button className="btn btn-primary" onClick={() => setShowHow(false)}>GOT IT</button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- PAUSED */}
      {screen === "paused" && (
        <div className="overlay">
          <div className="pause-card">
            <h2>PAUSED</h2>
            <div className="menu-actions">
              <button className="btn btn-primary" onClick={resume}>RESUME</button>
              <button className="btn btn-ghost" onClick={toMenu}>MAIN MENU</button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ GAME OVER */}
      {screen === "gameover" && (
        <div className="overlay gameover-overlay">
          <div className="gameover-card">
            <p className="gameover-kicker">TNP CELL SECURITY</p>
            <h1 className="gameover-title">NISCHAY CAUGHT YOU!</h1>
            <div className="gameover-stats">
              <div className="stat">
                <span className="stat-label">SCORE</span>
                <span className="stat-value mono">{finalStats?.score ?? 0}</span>
              </div>
              <div className="stat">
                <span className="stat-label">COINS</span>
                <span className="stat-value mono coin-stat">{finalStats?.coins ?? 0}</span>
              </div>
              <div className="stat">
                <span className="stat-label">DISTANCE</span>
                <span className="stat-value mono">{Math.floor((finalStats?.distance ?? 0) / 10)}m</span>
              </div>
            </div>
            <div className="menu-actions">
              <button className="btn btn-primary" onClick={play}>PLAY AGAIN</button>
              <button className="btn btn-ghost" onClick={toMenu}>MAIN MENU</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
