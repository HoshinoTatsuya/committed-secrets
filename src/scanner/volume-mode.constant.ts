/** Режим монтирования тома compose в конце значения: `:ro`, `:rw,z`, `:cached`. */
export const VOLUME_MODE =
  /:(?:ro|rw|z|Z|cached|delegated|consistent|nocopy)(?:,(?:ro|rw|z|Z|cached|delegated|consistent|nocopy))*$/u;
