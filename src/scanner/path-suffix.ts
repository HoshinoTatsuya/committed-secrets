/** Расширение имени, как `Path.suffix` Python: у `.env` — пусто, у `.env.example` — `.example`. */
export function pathSuffix(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot) : '';
}
