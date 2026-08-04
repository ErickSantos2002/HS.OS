import { icons } from "lucide-react";
import type { LucideProps } from "lucide-react";

interface TeamIconProps extends LucideProps {
  name: string;
}

/** Renders a Lucide icon by name. Falls back to Users icon. */
export default function TeamIcon({ name, ...props }: TeamIconProps) {
  const LucideIcon = icons[name as keyof typeof icons] || icons["Users"];
  return <LucideIcon {...props} />;
}
