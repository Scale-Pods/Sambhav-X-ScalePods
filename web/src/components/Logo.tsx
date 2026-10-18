import Image from "next/image";

/**
 * Sambhav logo on a transparent background.
 * variant "auto" follows light / dark mode; "dark" is for always-dark surfaces (the steel sidebar, the login panel).
 */
export function Logo({ variant = "auto", className = "", priority = false }: { variant?: "auto" | "light" | "dark"; className?: string; priority?: boolean }) {
  const light = <Image src="/brand/sambhav-logo-light.webp" alt="Sambhav Pipes & Fittings" width={1200} height={229} priority={priority} className={"h-auto w-full " + (variant === "auto" ? "block dark:hidden" : "")} />;
  const dark = <Image src="/brand/sambhav-logo-dark.webp" alt="Sambhav Pipes & Fittings" width={1200} height={230} priority={priority} className={"h-auto w-full " + (variant === "auto" ? "hidden dark:block" : "")} />;
  return (
    <span className={"block " + className}>
      {variant === "light" ? light : variant === "dark" ? dark : <>{light}{dark}</>}
    </span>
  );
}
