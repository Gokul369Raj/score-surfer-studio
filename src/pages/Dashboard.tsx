import SubwayGameView from "@/components/SubwayGameView";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, Play, Trophy } from "lucide-react";
import { useNavigate } from "react-router";
import { useEffect, useState } from "react";

const HIGH_SCORE_KEY = "subwayRunnerHighScore";

type Phase = "ready" | "running" | "over";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("ready");
  const [highScore, setHighScore] = useState(0);

  useEffect(() => {
    const hs = parseInt(localStorage.getItem(HIGH_SCORE_KEY) || "0", 10);
    setHighScore(hs);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

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
      <SubwayGameView className="absolute inset-0" onPhaseChange={handlePhaseChange} />

      {/* Slim header — hidden while running for full immersion */}
      {phase !== "running" && (
        <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 md:px-6 py-3.5">
          <div className="pointer-events-auto flex items-center gap-2.5">
            <div className="flex w-8 h-8 items-center justify-center rounded-md border border-white/20 bg-white/15 backdrop-blur-sm">
              <Play className="w-4 h-4 ml-0.5 fill-white text-white" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
              Subway Runner
            </span>
          </div>
          <div className="pointer-events-auto flex items-center gap-3">
            {highScore > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-xs text-white/90 backdrop-blur-sm">
                <Trophy className="w-3.5 h-3.5 text-amber-300" />
                Best:{" "}
                <span className="font-bold tabular-nums">{highScore}</span>
              </div>
            )}
            <span className="text-xs text-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
              {user?.name || "Player"}
            </span>
            <button
              onClick={handleSignOut}
              className="cursor-pointer rounded-lg border border-white/15 bg-black/25 p-2 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/45"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>
      )}
    </main>
  );
}
