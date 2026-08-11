import SubwayGameView from "@/components/SubwayGameView";
import { useAuth } from "@/hooks/use-auth";
import { Home, LogIn, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

const HIGH_SCORE_KEY = "subwayRunnerHighScore";

type Phase = "ready" | "running" | "over";

export default function Play() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("ready");
  const [highScore, setHighScore] = useState(0);

  useEffect(() => {
    const hs = parseInt(localStorage.getItem(HIGH_SCORE_KEY) || "0", 10);
    setHighScore(hs);
  }, []);

  const handlePhaseChange = (p: Phase) => {
    setPhase(p);
    if (p === "over") {
      const hs = parseInt(localStorage.getItem(HIGH_SCORE_KEY) || "0", 10);
      setHighScore(hs);
    }
  };

  return (
    <main className="relative h-screen w-full overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {/* Full-screen 3D game */}
      <SubwayGameView
        className="absolute inset-0"
        onPhaseChange={handlePhaseChange}
      />

      {/* Slim header — hidden while running for full immersion */}
      {phase !== "running" && (
        <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 md:px-6 py-3.5">
          <button
            onClick={() => navigate("/")}
            className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-xs text-white/90 backdrop-blur-sm transition-colors hover:bg-black/45"
          >
            <Home className="w-3.5 h-3.5" />
            Home
          </button>
          <div className="pointer-events-auto flex items-center gap-3">
            {highScore > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-xs text-white/90 backdrop-blur-sm">
                <Trophy className="w-3.5 h-3.5 text-amber-300" />
                Best: <span className="font-bold tabular-nums">{highScore}</span>
              </div>
            )}
            {isAuthenticated ? (
              <button
                onClick={() => navigate("/dashboard")}
                className="cursor-pointer rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-xs text-white/90 backdrop-blur-sm transition-colors hover:bg-black/45"
              >
                Dashboard
              </button>
            ) : (
              <button
                onClick={() => navigate("/auth?returnTo=/play")}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-xs text-white/90 backdrop-blur-sm transition-colors hover:bg-black/45"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign in
              </button>
            )}
          </div>
        </header>
      )}
    </main>
  );
}
