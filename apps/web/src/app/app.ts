import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppUpdateService } from './core/pwa/app-update.service';
import { PushService } from './core/pwa/push.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly appUpdate = inject(AppUpdateService);
  private readonly push = inject(PushService);

  ngOnInit(): void {
    this.appUpdate.init();
    this.push.init();
  }
}
