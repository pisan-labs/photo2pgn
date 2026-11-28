// <hw-theme-toggle> in JSX (claude-built-apps platform/src/theme/README.md, "A React app").
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hw-theme-toggle": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
