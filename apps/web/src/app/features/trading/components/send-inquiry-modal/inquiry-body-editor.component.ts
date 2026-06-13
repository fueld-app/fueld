import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  viewChild,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-inquiry-body-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="border border-gray-300 rounded-lg overflow-hidden">
      <!-- Toolbar -->
      <div class="flex items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
        <button type="button" (click)="execCommand('bold')" class="toolbar-btn" title="Bold">
          <strong>B</strong>
        </button>
        <button type="button" (click)="execCommand('italic')" class="toolbar-btn" title="Italic">
          <em>I</em>
        </button>
        <button type="button" (click)="execCommand('underline')" class="toolbar-btn" title="Underline">
          <u>U</u>
        </button>
        <div class="w-px h-4 bg-gray-300 mx-1"></div>
        <button type="button" (click)="execCommand('insertUnorderedList')" class="toolbar-btn" title="Bullet list">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M6 4.75A.75.75 0 016.75 4h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 4.75zM6 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 10zm0 5.25a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75a.75.75 0 01-.75-.75zM1.99 4.75a1 1 0 011-1h.01a1 1 0 010 2h-.01a1 1 0 01-1-1zm0 5.25a1 1 0 011-1h.01a1 1 0 010 2h-.01a1 1 0 01-1-1zm0 5.25a1 1 0 011-1h.01a1 1 0 010 2h-.01a1 1 0 01-1-1z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>
      <!-- Content editable area -->
      <div
        #bodyEditor
        contenteditable="true"
        class="inquiry-email-canvas min-h-[200px] max-h-[300px] overflow-y-auto px-4 py-3 text-sm text-gray-900 focus:outline-none"
        (input)="onBodyInput()"
      ></div>
    </div>
  `,
  styles: [`
    .toolbar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      padding: 4px;
      font-size: 14px;
      color: #4b5563;
      min-width: 28px;
      text-align: center;
      cursor: pointer;
      border: none;
      background: transparent;
      transition: background-color 0.15s, color 0.15s;
    }
    .toolbar-btn:hover {
      background-color: #e5e7eb;
      color: #111827;
    }
    .inquiry-email-canvas {
      word-break: break-word;
    }
    .inquiry-email-canvas :where(img) {
      max-width: 100%;
      height: auto;
    }
    .inquiry-email-canvas :where(table) {
      max-width: 100%;
    }
    .inquiry-email-canvas :where(p) {
      margin: 0 0 16px;
      line-height: 1.65;
    }
    .inquiry-email-canvas :where(li) {
      margin: 0;
    }
  `],
})
export class InquiryBodyEditorComponent {
  /** Optional initial HTML to load into the editor. */
  readonly htmlBody = input<string>('');

  readonly htmlBodyChange = output<string>();

  readonly bodyEditor = viewChild<ElementRef<HTMLDivElement>>('bodyEditor');

  /** Set the editor content from outside (e.g. after defaults load). */
  setContent(html: string): void {
    const editor = this.bodyEditor()?.nativeElement;
    if (editor) {
      editor.innerHTML = html;
    }
  }

  execCommand(command: string): void {
    document.execCommand(command, false);
    this.emitChange();
  }

  onBodyInput(): void {
    this.emitChange();
  }

  private emitChange(): void {
    const editor = this.bodyEditor()?.nativeElement;
    if (editor) {
      this.htmlBodyChange.emit(editor.innerHTML);
    }
  }
}
