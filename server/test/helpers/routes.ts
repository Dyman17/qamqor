import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';

/** Lists `METHOD /full/path` for every route handler of a controller class. */
export function routesOf(ctrl: any): string[] {
  const base: string = Reflect.getMetadata('path', ctrl) ?? '';
  const out: string[] = [];
  for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
    if (name === 'constructor') continue;
    const h = ctrl.prototype[name];
    const p = Reflect.getMetadata('path', h);
    const m = Reflect.getMetadata('method', h);
    if (p === undefined || m === undefined) continue;
    const full = `/${base}/${p}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
    out.push(`${RequestMethod[m]} ${full}`);
  }
  return out;
}
