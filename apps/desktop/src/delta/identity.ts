// T3 Code - Delta builds carry "+delta.<revision>" in their version and install beside the
// official app: their own app id, product name, Electron profile and T3 home.
export const isDeltaBuild = (version: string | undefined): boolean =>
  /\+delta\.\d+$/.test(version ?? "");

/** Also the Windows AppUserModelID, so the Start menu shortcut and taskbar match. */
export const DELTA_APP_ID = "dev.t3code-delta.desktop";
export const DELTA_PRODUCT_NAME = "T3 Code - Delta";
/** Packaged package.json name. Per-user installers name the install folder after it. */
export const DELTA_PACKAGE_NAME = "t3code-delta";
/** Electron profile folder under the OS app data directory (official: t3code-v2). */
export const DELTA_USER_DATA_DIR = "t3code-delta";
/** T3 home under the user's home directory (official: .t3). */
export const DELTA_T3_HOME_DIR = ".t3-delta";
