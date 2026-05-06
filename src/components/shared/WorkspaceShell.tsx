import React from "react";
import WorkspaceSidebar from "@/components/shared/WorkspaceSidebar";
import { FadeUpLarge } from "@/components/shared/Animations";

const TEXTURE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp";

interface WorkspaceShellProps {
  children: React.ReactNode;
  /**
   * Set when the page renders its own scrollable layout (e.g. the
   * library chat thread). Suppresses the default `overflow-y-auto`
   * on the main slot so nested `h-full` panes can claim the height
   * without double-scrolling.
   */
  fullHeight?: boolean;
}

/**
 * Workspace-level shell — the same parchment book container the
 * project layout uses, but with the workspace nav (My Books / Library
 * / Library Chat / Writing Twin / Account) instead of project nav.
 * Use it for top-level pages so home, library chat etc. inherit the
 * same visual identity as project dashboards.
 */
export default function WorkspaceShell({ children, fullHeight }: WorkspaceShellProps) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundImage: `url(${TEXTURE_URL})`,
        backgroundSize: "cover",
        backgroundAttachment: "scroll",
      }}
    >
      <div className="flex-1 flex items-start justify-center p-4 md:p-6 lg:p-8">
        <FadeUpLarge className="w-full max-w-[1400px] relative">
          {/* Book shadow */}
          <div className="absolute -inset-4 bg-[#3C2415]/8 rounded-sm blur-2xl" />

          {/* Book container */}
          <div className="relative bg-[#FAF7F0] rounded-sm shadow-[0_4px_40px_rgba(60,36,21,0.15)] overflow-hidden">
            {/* Top decorative edge */}
            <div className="h-[3px] bg-gradient-to-r from-transparent via-[#C9A84C]/40 to-transparent" />

            <div className="flex flex-col lg:flex-row h-[93vh] overflow-hidden">
              <WorkspaceSidebar />
              <main
                className={
                  fullHeight
                    ? "flex-1 flex flex-col min-h-0 overflow-hidden"
                    : "flex-1 flex flex-col overflow-y-auto min-h-0"
                }
              >
                <div className="md:hidden h-16" />{/* spacer for mobile menu button */}
                {children}
              </main>
            </div>

            {/* Bottom decorative edge */}
            <div className="h-[3px] bg-gradient-to-r from-transparent via-[#C9A84C]/40 to-transparent" />
          </div>
        </FadeUpLarge>
      </div>
    </div>
  );
}
