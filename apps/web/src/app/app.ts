import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppUpdateService } from './core/pwa/app-update.service';
import { PushService } from './core/pwa/push.service';
import { DateFormatService } from './core/services/date-format.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly appUpdate = inject(AppUpdateService);
  private readonly push = inject(PushService);
  private readonly dateFormatSvc = inject(DateFormatService);

  ngOnInit(): void {
    this.initViewportHeightFix();
    this.appUpdate.init();
    this.push.init();
    this.dateFormatSvc.load();
  }

  private initViewportHeightFix(): void {
    const apply = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
    };

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        apply();
      });
    };

    apply();

    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule, { passive: true });

    // iOS Safari dynamic toolbars affect visual viewport height.
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
  }
}
