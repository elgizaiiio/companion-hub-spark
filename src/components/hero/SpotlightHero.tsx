import { ReactNode } from "react";

type Props = {
  title: string;
  center?: boolean;
  children?: ReactNode;
};

const SpotlightHero = ({ title, center = false, children }: Props) => (
  <section
    className={`hero-dark relative flex w-full flex-col overflow-hidden ${
      center ? "min-h-[100dvh] justify-center" : ""
    }`}
  >
    {/* Static soft mint/pink wash — no animation */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        background:
          "radial-gradient(ellipse 70% 45% at 20% 0%, hsl(var(--primary) / 0.10), transparent 70%), radial-gradient(ellipse 60% 40% at 90% 12%, hsl(var(--accent) / 0.12), transparent 70%)",
      }}
    />

    <h1
      className={`hero-title pointer-events-none relative z-20 px-6 mb-2 text-center text-[3rem] leading-[0.95] sm:text-[4rem] ${
        center ? "" : "pt-safe"
      }`}
    >
      {title}
    </h1>

    <div className="relative z-40 flex w-full flex-col">{children}</div>
  </section>
);

export default SpotlightHero;
