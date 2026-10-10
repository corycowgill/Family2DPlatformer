/**
 * Device / browser detection for mobile-specific behaviour. Pure functions over an
 * injectable environment so they are unit-testable in Node.
 */
export interface DeviceEnv {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** navigator.standalone (iOS home-screen web app). */
  standalone?: boolean;
  /** matchMedia('(display-mode: standalone|fullscreen)').matches */
  displayModeApp?: boolean;
  webdriver?: boolean;
}

export function currentEnv(): DeviceEnv {
  if (typeof navigator === 'undefined') return { userAgent: '', platform: '', maxTouchPoints: 0 };
  const mm = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  return {
    userAgent: navigator.userAgent ?? '',
    platform: navigator.platform ?? '',
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
    displayModeApp: mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)'),
    webdriver: navigator.webdriver === true,
  };
}

/** iPhone / iPod / iPad, including iPadOS 13+ which reports itself as a Mac with touch. */
export function isIOS(env: DeviceEnv = currentEnv()): boolean {
  if (/iPad|iPhone|iPod/.test(env.userAgent)) return true;
  return env.platform === 'MacIntel' && env.maxTouchPoints > 1;
}

export function isAndroid(env: DeviceEnv = currentEnv()): boolean {
  return /Android/i.test(env.userAgent);
}

/** Running as an installed home-screen web app (no browser chrome). */
export function isStandalone(env: DeviceEnv = currentEnv()): boolean {
  return env.standalone === true || env.displayModeApp === true;
}

/** Automated browser (Playwright): skip side effects such as entering fullscreen. */
export function isAutomated(env: DeviceEnv = currentEnv()): boolean {
  return env.webdriver === true;
}

/** Same query the rotate-device overlay uses (touch phone held in portrait). */
export const PORTRAIT_QUERY = '(orientation: portrait) and (pointer: coarse)';
