// "Install app": on Android and desktop Chrome the browser offers it through
// beforeinstallprompt; on iPhone and iPad it is Share > Add to Home Screen,
// which the page can only explain.
import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

export function isIos(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /iPhone|iPad|iPod/.test(ua);
}

/**
 * How this browser installs the app, for the /install page:
 * - installed: already opened from the home screen;
 * - on-phone: installed on this phone, but opened in the browser (Android Chrome tells);
 * - prompt: the browser offers its install dialog (Android, desktop Chrome and Edge);
 * - ios: Share > Add to Home Screen (Safari, and Chrome, Edge or Firefox on iOS 16.4 and later);
 * - android-menu: Android without the dialog (Firefox, Samsung Internet, or not offered yet): the browser's menu;
 * - desktop: a computer: open the page on the phone.
 */
export type InstallWay = "installed" | "on-phone" | "prompt" | "ios" | "android-menu" | "desktop";

export function installWay({
  standalone,
  canPrompt,
  ua,
  appInstalled = false,
}: {
  standalone: boolean;
  canPrompt: boolean;
  ua: string;
  /** getInstalledRelatedApps found the app on this device. */
  appInstalled?: boolean;
}): InstallWay {
  if (standalone) return "installed";
  if (appInstalled) return "on-phone";
  if (canPrompt) return "prompt";
  // iPadOS asks for the desktop site: a "Macintosh" with a touch screen.
  if (isIos(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android-menu";
  return "desktop";
}

/** Where Share is in this iOS browser. */
export function iosShareHint(ua: string): string {
  if (/CriOS|EdgiOS/.test(ua)) return "the Share button in the address bar";
  if (/FxiOS/.test(ua)) return "the menu (☰), then Share";
  return "the Share button (a square with an arrow) at the bottom of the screen, or at the top on iPad";
}

/**
 * Whether the app is installed on this device, asked from the browser tab:
 * Chrome on Android answers through getInstalledRelatedApps (the manifest's
 * related_applications names the app itself); other browsers cannot tell.
 */
export async function isAppInstalled(nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator): Promise<boolean> {
  const ask = (nav as (Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> }) | undefined)?.getInstalledRelatedApps;
  if (!nav || typeof ask !== "function") return false;
  try {
    return (await ask.call(nav)).length > 0;
  } catch {
    return false;
  }
}

export function useInstall(): {
  canInstall: boolean;
  install: () => void;
  iosTip: boolean;
  installed: boolean;
  /** Already on this device, though this page is open in the browser. */
  appInstalled: boolean;
} {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [appInstalled, setAppInstalled] = useState(false);
  useEffect(() => {
    let live = true;
    if (!isStandalone()) {
      void isAppInstalled().then((yes) => {
        if (live) setAppInstalled(yes);
      });
    }
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setPrompt(null);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return {
    canInstall: Boolean(prompt),
    install: () => {
      void prompt?.prompt();
      setPrompt(null);
    },
    iosTip: isIos() && !isStandalone(),
    installed,
    appInstalled,
  };
}
