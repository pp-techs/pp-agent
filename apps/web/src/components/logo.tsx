import blue from "@/assets/logo-mark-blue.png";
import white from "@/assets/logo-mark-white.png";
import { cn } from "@workspace/ui/lib/utils";

/** The PP Agent mark: blue on light themes, white on dark ones. */
export function Logo({ className }: { className?: string }) {
  return (
    <>
      <img src={blue} alt="" aria-hidden className={cn("dark:hidden", className)} />
      <img src={white} alt="" aria-hidden className={cn("hidden dark:block", className)} />
    </>
  );
}
