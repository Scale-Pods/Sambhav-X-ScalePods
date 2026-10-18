"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Light / dark switch. The choice is remembered on this device; until then it follows the computer's setting. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  const flip = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* private window: the switch still works for this visit */
    }
    setDark(next);
  };

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={"grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface hover:text-ink " + className}
    >
      {dark ? <Sun className="h-[1.1rem] w-[1.1rem]" /> : <Moon className="h-[1.1rem] w-[1.1rem]" />}
    </button>
  );
}
