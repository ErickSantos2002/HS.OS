import * as React from "react";

interface AiLoaderProps {
  size?: number;
  text?: string;
}

export function AiLoader({ size = 180, text = "Generating" }: AiLoaderProps) {
  const letters = text.split("");

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div
        className="relative rounded-full animate-loaderCircle"
        style={{
          width: size,
          height: size,
          filter: "blur(12px)",
        }}
      />

      <div className="flex items-center gap-0.5">
        {letters.map((letter, index) => (
          <span
            key={index}
            className="text-sm font-display font-semibold text-foreground animate-loaderLetter"
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            {letter === " " ? "\u00A0" : letter}
          </span>
        ))}
      </div>

      <style>{`
        @keyframes loaderCircle {
          0% {
            transform: rotate(90deg);
            box-shadow:
              0 6px 12px 0 hsl(var(--primary) / 0.6) inset,
              0 12px 18px 0 hsl(var(--primary) / 0.8) inset,
              0 36px 36px 0 hsl(var(--primary)) inset,
              0 0 3px 1.2px hsl(var(--primary) / 0.3),
              0 0 6px 1.8px hsl(var(--accent) / 0.2);
          }
          50% {
            transform: rotate(270deg);
            box-shadow:
              0 6px 12px 0 hsl(var(--accent) / 0.6) inset,
              0 12px 6px 0 hsl(var(--primary) / 0.7) inset,
              0 24px 36px 0 hsl(var(--primary) / 0.9) inset,
              0 0 3px 1.2px hsl(var(--primary) / 0.3),
              0 0 6px 1.8px hsl(var(--accent) / 0.2);
          }
          100% {
            transform: rotate(450deg);
            box-shadow:
              0 6px 12px 0 hsl(var(--primary) / 0.5) inset,
              0 12px 18px 0 hsl(var(--primary) / 0.8) inset,
              0 36px 36px 0 hsl(var(--primary)) inset,
              0 0 3px 1.2px hsl(var(--primary) / 0.3),
              0 0 6px 1.8px hsl(var(--accent) / 0.2);
          }
        }

        @keyframes loaderLetter {
          0%, 100% {
            opacity: 0.4;
            transform: translateY(0);
          }
          20% {
            opacity: 1;
            transform: scale(1.15);
          }
          40% {
            opacity: 0.7;
            transform: translateY(0);
          }
        }

        .animate-loaderCircle {
          animation: loaderCircle 5s linear infinite;
        }

        .animate-loaderLetter {
          animation: loaderLetter 3s infinite;
        }
      `}</style>
    </div>
  );
}
