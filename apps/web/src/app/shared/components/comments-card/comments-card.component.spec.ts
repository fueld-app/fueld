import { signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { of } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { CommentsCardComponent } from './comments-card.component';

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // Ignore when another test runner has already initialized the Angular test platform.
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('CommentsCardComponent', () => {
  it('initializes follow-up edit fields from the existing comment date', async () => {
    await TestBed.configureTestingModule({
      imports: [CommentsCardComponent],
      providers: [
        {
          provide: AuthService,
          useValue: { user: signal({ id: 'user-1', name: 'Test User' }) },
        },
        {
          provide: HttpClient,
          useValue: {
            get: () => of({ success: true, data: [] }),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommentsCardComponent);
    fixture.componentRef.setInput('entityType', 'company');
    fixture.componentRef.setInput('entityId', 'company-1');
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.startEdit({
      id: 'comment-1',
      entityType: 'company',
      entityId: 'company-1',
      userId: 'user-1',
      userName: 'Test User',
      content: 'Follow up soon',
      followUpDate: '2026-04-25',
      followUpCompleted: false,
      createdAt: '2026-04-20T10:00:00.000Z',
      updatedAt: '2026-04-20T10:00:00.000Z',
    });

    expect(component.editingId()).toBe('comment-1');
    expect(component.editShowFollowUpInput()).toBe(true);
    expect(component.editFollowUpDate).toBe('2026-04-25');
    expect(component.editFollowUpDays).toBeTypeOf('number');
  });

  it('sends the edited follow-up date when saving a comment', async () => {
    const put = vi.fn(() => of({
      success: true,
      data: {
        id: 'comment-1',
        entityType: 'company',
        entityId: 'company-1',
        userId: 'user-1',
        userName: 'Test User',
        content: 'Updated comment',
        followUpDate: '2026-04-24',
        followUpCompleted: false,
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-20T10:05:00.000Z',
      },
    }));

    await TestBed.configureTestingModule({
      imports: [CommentsCardComponent],
      providers: [
        {
          provide: AuthService,
          useValue: { user: signal({ id: 'user-1', name: 'Test User' }) },
        },
        {
          provide: HttpClient,
          useValue: {
            get: () => of({ success: true, data: [] }),
            put,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommentsCardComponent);
    fixture.componentRef.setInput('entityType', 'company');
    fixture.componentRef.setInput('entityId', 'company-1');
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.comments.set([
      {
        id: 'comment-1',
        entityType: 'company',
        entityId: 'company-1',
        userId: 'user-1',
        userName: 'Test User',
        content: 'Original comment',
        followUpDate: '2026-04-22',
        followUpCompleted: false,
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-20T10:00:00.000Z',
      },
    ]);
    component.startEdit(component.comments()[0]!);
    component.editContent = 'Updated comment';
    component.editShowFollowUpInput.set(true);
    component.editFollowUpDate = '2026-04-24';

    await component.saveEdit('comment-1');

    expect(put).toHaveBeenCalledWith(
      expect.stringContaining('/comments/comment-1'),
      { content: 'Updated comment', followUpDate: '2026-04-24' },
    );
    expect(component.comments()[0]?.followUpDate).toBe('2026-04-24');
    expect(component.editingId()).toBeNull();
  });
});