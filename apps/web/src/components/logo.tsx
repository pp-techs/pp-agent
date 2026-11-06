import blue from "@/assets/logo-mark-blue.png";
import smallBlue from "@/assets/logo-mark-small-blue.png";

/**
 * The PP Agent mark in its brand blue, which reads on light and dark themes alike.
 * `small` is the bolder cut for sizes under about 32 px, where the fine leaves would blur.
 */
export function Logo({ className, small }: { className?: string; small?: boolean }) {
  return <img src={small ? smallBlue : blue} alt="" aria-hidden className={className} />;
}
