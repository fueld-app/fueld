import { Service, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

/**
 * Custom TitleStrategy that prepends "Fueld | " to every route title.
 *
 * Route data examples:
 *   data: { title: 'Dashboard' }           →  "Fueld | Dashboard"
 *   data: { title: 'Admin > Users' }       →  "Fueld | Admin > Users"
 *   data: { title: 'Trading > Orders' }    →  "Fueld | Trading > Orders"
 *
 * Detail pages can override dynamically via Title.setTitle():
 *   this.title.setTitle('Fueld | Vessels > MSC Oscar')
 */
@Service()
export class FueldTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const routeTitle = this.buildTitle(snapshot);
    if (routeTitle) {
      this.title.setTitle(`Fueld | ${routeTitle}`);
    } else {
      this.title.setTitle('Fueld');
    }
  }
}
