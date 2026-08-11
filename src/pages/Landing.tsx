import { motion } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      className="min-h-screen flex flex-col bg-[var(--background)]"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-[var(--foreground)] flex items-center justify-center">
            <Play className="w-4 h-4 text-[var(--background)] fill-current ml-0.5" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-[var(--foreground)]">
            Subway Runner
          </span>
        </div>
        <nav className="flex items-center gap-3">
          {isAuthenticated ? (
            <button
              onClick={() => navigate("/play")}
              className="text-xs font-medium px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-opacity cursor-pointer"
            >
              Play
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate("/auth")}
                className="text-xs font-medium px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer"
              >
                Sign in
              </button>
              <button
                onClick={() => navigate("/play")}
                className="text-xs font-medium px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-opacity cursor-pointer"
              >
                Play now
              </button>
            </>
          )}
        </nav>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 md:py-24">
        <div className="max-w-3xl mx-auto text-center">
          {/* Overline */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="mb-6"
          >
            <span className="inline-flex items-center gap-2 text-xs font-medium tracking-widest uppercase text-[var(--muted-foreground)] border border-[var(--border)] rounded-full px-4 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Play instantly in your browser
            </span>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-[var(--foreground)] leading-[1.08]"
          >
            Run the rails.
            <br />
            <span className="text-[var(--muted-foreground)]">Break the record.</span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.5 }}
            className="mt-6 text-base md:text-lg text-[var(--muted-foreground)] max-w-xl mx-auto leading-relaxed"
          >
            A colorful 3D endless runner. Dodge trains, leap barriers, slide
            under gates, and collect coins as you chase the highest score.
          </motion.p>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <button
              onClick={() => navigate("/play")}
              className="group inline-flex items-center gap-2.5 px-7 py-3.5 rounded-lg bg-[var(--foreground)] text-[var(--background)] text-sm font-semibold hover:opacity-90 transition-all cursor-pointer"
            >
              Start running
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <span className="text-xs text-[var(--muted-foreground)]">
              Free to play · No sign-up needed
            </span>
          </motion.div>
        </div>

        {/* Feature cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, duration: 0.6 }}
          className="mt-20 max-w-3xl w-full grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          {[
            {
              label: "Three lanes",
              desc: "Switch left and right to dodge oncoming trains and barriers.",
            },
            {
              label: "Collect coins",
              desc: "Grab coins scattered along the track for bonus points.",
            },
            {
              label: "Beat your best",
              desc: "High scores are saved in your browser — keep pushing your limit.",
            },
          ].map((f) => (
            <div
              key={f.label}
              className="p-5 rounded-lg border border-[var(--border)] bg-white/50 text-left"
            >
              <p className="text-sm font-semibold text-[var(--foreground)] mb-1">
                {f.label}
              </p>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                {f.desc}
              </p>
            </div>
          ))}
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-6 px-6 md:px-12 text-center">
        <p className="text-xs text-[var(--muted-foreground)]">
          Subway Runner — A browser-based endless runner
        </p>
      </footer>
    </motion.div>
  );
}
