import type { ReactNode } from "react";

/** Full-viewport centered container for the sign-in, onboarding and gate
 *  screens. */
export default function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}
