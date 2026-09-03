// The local auth bypass. Both halves must hold: a dev build AND the flag, so a
// production bundle can never carry it even if the env file leaks into the build.
export const DEV_BYPASS_AUTH =
  import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS_AUTH === "1";
